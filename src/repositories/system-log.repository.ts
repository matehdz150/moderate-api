import { createHash, createHmac } from "node:crypto";
import { request } from "node:https";

import type { AdminSystemError } from "../types/admin.types.js";

const DEFAULT_LOG_GROUPS = [
  "/aws/lambda/moderate-api-auth-lambda",
  "/aws/lambda/moderate-api-dashboard-lambda",
  "/aws/lambda/moderate-api-lambda",
  "/aws/lambda/moderate-api-webhook-lambda",
];

interface FilterLogEventsResponse {
  events?: Array<{
    logStreamName?: string;
    timestamp?: number;
    message?: string;
  }>;
}

function getRegion() {
  return process.env.AWS_REGION ?? "us-east-1";
}

function getLogGroups() {
  return (process.env.ADMIN_LOG_GROUPS ?? DEFAULT_LOG_GROUPS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmac("AWS4" + secretAccessKey, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "logs");
  return hmac(serviceKey, "aws4_request");
}

function getAmzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function getCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Lambda credentials are not available");
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

function postCloudWatchLogs<T>(target: string, payload: Record<string, unknown>): Promise<T> {
  const region = getRegion();
  const host = "logs." + region + ".amazonaws.com";
  const body = JSON.stringify(payload);
  const now = new Date();
  const amzDate = getAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentials = getCredentials();
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };

  if (credentials.sessionToken) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => name + ":" + headers[name].trim() + "\n")
    .join("");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(body),
  ].join("\n");
  const credentialScope = dateStamp + "/" + region + "/logs/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(
    getSigningKey(credentials.secretAccessKey, dateStamp, region),
    stringToSign
  );
  const authorization =
    "AWS4-HMAC-SHA256 Credential=" +
    credentials.accessKeyId +
    "/" +
    credentialScope +
    ", SignedHeaders=" +
    signedHeaders +
    ", Signature=" +
    signature;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: host,
        method: "POST",
        path: "/",
        headers: {
          ...headers,
          authorization,
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");

          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(text || "CloudWatch Logs request failed"));
            return;
          }

          resolve(text ? (JSON.parse(text) as T) : ({} as T));
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getErrorMessage(payload: Record<string, unknown>, fallback: string) {
  const error = payload.error;

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? fallback);
  }

  return fallback;
}

function parseStructuredLog(params: {
  logGroupName: string;
  logStreamName?: string;
  timestamp?: number;
  message?: string;
}): AdminSystemError | null {
  const message = params.message ?? "";

  try {
    const payload = JSON.parse(message) as Record<string, unknown>;

    if (payload.level !== "error") {
      return null;
    }

    return {
      timestamp:
        getString(payload.timestamp) ??
        new Date(params.timestamp ?? Date.now()).toISOString(),
      logGroupName: params.logGroupName,
      logStreamName: params.logStreamName,
      event: getString(payload.event),
      route: getString(payload.route),
      requestId: getString(payload.requestId),
      accountId: getString(payload.accountId),
      projectId: getString(payload.projectId),
      message: getErrorMessage(payload, message),
    };
  } catch {
    return null;
  }
}

export async function listRecentStructuredErrors(params?: {
  hours?: number;
  limit?: number;
}): Promise<AdminSystemError[]> {
  const hours = params?.hours ?? 24;
  const limit = params?.limit ?? 30;
  const startTime = Date.now() - hours * 60 * 60 * 1000;
  const logGroups = getLogGroups();
  const errors: AdminSystemError[] = [];

  await Promise.all(
    logGroups.map(async (logGroupName) => {
      const result = await postCloudWatchLogs<FilterLogEventsResponse>(
        "Logs_20140328.FilterLogEvents",
        {
          logGroupName,
          startTime,
          limit,
          filterPattern: '{ $.level = "error" }',
        }
      );

      for (const event of result.events ?? []) {
        const parsed = parseStructuredLog({
          logGroupName,
          logStreamName: event.logStreamName,
          timestamp: event.timestamp,
          message: event.message,
        });

        if (parsed) {
          errors.push(parsed);
        }
      }
    })
  );

  return errors
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
