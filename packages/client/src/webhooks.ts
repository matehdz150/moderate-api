import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  BrandSafetyResult,
  ComplianceResult,
  ModerationAction,
  ModerationDecisionExplanation,
  ModerationLabel,
  ModerationResponse,
} from "./types.js";

export type VisoraWebhookEventType =
  | "moderation.completed"
  | "moderation.review_required"
  | "review.approved"
  | "review.rejected";

export interface VisoraModerationCompletedData extends ModerationResponse {
  imageKey: string;
  createdAt: string;
}

export interface VisoraReviewRequiredData {
  reviewId: string;
  moderationId: string;
  imageKey: string;
  action: Extract<ModerationAction, "review">;
  riskScore?: number;
  category?: string | null;
  labels: ModerationLabel[];
  explanation?: ModerationDecisionExplanation;
  brandSafety?: BrandSafetyResult;
  compliance?: ComplianceResult | null;
  createdAt: string;
}

export interface VisoraReviewDecisionData {
  reviewId: string;
  moderationId: string;
  imageKey: string;
  status: "approved" | "rejected";
  reviewedAt?: string;
  reviewedBy?: string;
  decisionReason?: string;
  riskScore?: number;
  category?: string | null;
  labels: ModerationLabel[];
  explanation?: ModerationDecisionExplanation;
  brandSafety?: BrandSafetyResult;
  compliance?: ComplianceResult | null;
}

export interface VisoraWebhookEventMap {
  "moderation.completed": VisoraModerationCompletedData;
  "moderation.review_required": VisoraReviewRequiredData;
  "review.approved": VisoraReviewDecisionData;
  "review.rejected": VisoraReviewDecisionData;
}

export type VisoraWebhookEvent<
  TType extends VisoraWebhookEventType = VisoraWebhookEventType,
> = {
  [K in TType]: {
    id: string;
    type: K;
    createdAt: string;
    accountId: string;
    projectId: string;
    data: VisoraWebhookEventMap[K];
  };
}[TType];

export interface VerifyWebhookSignatureParams {
  secret: string | string[];
  payload: string | Buffer | Uint8Array;
  timestamp: string;
  signature: string;
  toleranceSeconds?: number;
}

export interface ConstructWebhookEventParams
  extends VerifyWebhookSignatureParams {
  payload: string | Buffer | Uint8Array;
}

export interface VisoraWebhookHeaders {
  "visora-event-id"?: string | string[] | undefined;
  "visora-event-type"?: string | string[] | undefined;
  "visora-timestamp"?: string | string[] | undefined;
  "visora-signature"?: string | string[] | undefined;
}

export interface NextWebhookHandlerOptions {
  secret: string | string[];
  toleranceSeconds?: number;
  onEvent: (event: VisoraWebhookEvent) => void | Promise<void>;
}

export interface ExpressWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: string | Buffer | Uint8Array | Record<string, unknown>;
  rawBody?: string | Buffer | Uint8Array;
}

export interface ExpressWebhookResponse {
  status: (statusCode: number) => ExpressWebhookResponse;
  json: (body: unknown) => unknown;
}

export type ExpressWebhookNext = (error?: unknown) => void;

export interface ExpressWebhookHandlerOptions
  extends NextWebhookHandlerOptions {
  invalidSignatureStatusCode?: number;
}

export class VisoraWebhookSignatureError extends Error {
  constructor(message = "Invalid Visora webhook signature") {
    super(message);
    this.name = "VisoraWebhookSignatureError";
  }
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function toRawBody(payload: string | Buffer | Uint8Array): string {
  if (typeof payload === "string") {
    return payload;
  }

  return Buffer.from(payload).toString("utf8");
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getRequestHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string
): string {
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }

  return getHeaderValue(headers[name] ?? headers[name.toLowerCase()]);
}

function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function isTimestampWithinTolerance(
  timestamp: string,
  toleranceSeconds: number
): boolean {
  const timestampSeconds = Number(timestamp);

  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  return Math.abs(nowSeconds - timestampSeconds) <= toleranceSeconds;
}

function compareSignatures(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function verifyWebhookSignature(
  params: VerifyWebhookSignatureParams
): boolean {
  const toleranceSeconds =
    params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (
    !params.timestamp ||
    !params.signature ||
    !isTimestampWithinTolerance(params.timestamp, toleranceSeconds)
  ) {
    return false;
  }

  const rawBody = toRawBody(params.payload);
  const secrets = Array.isArray(params.secret) ? params.secret : [params.secret];

  return secrets.some((secret) => {
    const expected = `v1=${signPayload(secret, params.timestamp, rawBody)}`;

    return compareSignatures(expected, params.signature);
  });
}

export function constructWebhookEvent(
  params: ConstructWebhookEventParams
): VisoraWebhookEvent {
  if (!verifyWebhookSignature(params)) {
    throw new VisoraWebhookSignatureError();
  }

  return JSON.parse(toRawBody(params.payload)) as VisoraWebhookEvent;
}

export function createNextWebhookHandler(options: NextWebhookHandlerOptions) {
  return async function handleVisoraWebhook(request: Request): Promise<Response> {
    const payload = await request.text();
    const timestamp = getRequestHeader(request.headers, "visora-timestamp");
    const signature = getRequestHeader(request.headers, "visora-signature");
    let event: VisoraWebhookEvent;

    try {
      event = constructWebhookEvent({
        secret: options.secret,
        payload,
        timestamp,
        signature,
        toleranceSeconds: options.toleranceSeconds,
      });
    } catch (error) {
      if (error instanceof VisoraWebhookSignatureError) {
        return Response.json(
          { error: "Invalid Visora webhook signature" },
          { status: 401 }
        );
      }

      throw error;
    }

    await options.onEvent(event);

    return Response.json({ received: true });
  };
}

export function createExpressWebhookHandler(
  options: ExpressWebhookHandlerOptions
) {
  return async function handleVisoraWebhook(
    request: ExpressWebhookRequest,
    response: ExpressWebhookResponse,
    next?: ExpressWebhookNext
  ) {
    try {
      const payload = request.rawBody ?? request.body;

      if (
        typeof payload !== "string" &&
        !Buffer.isBuffer(payload) &&
        !(payload instanceof Uint8Array)
      ) {
        throw new Error(
          "Visora webhook handlers require the raw request body"
        );
      }

      const event = constructWebhookEvent({
        secret: options.secret,
        payload,
        timestamp: getRequestHeader(request.headers, "visora-timestamp"),
        signature: getRequestHeader(request.headers, "visora-signature"),
        toleranceSeconds: options.toleranceSeconds,
      });

      await options.onEvent(event);

      return response.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof VisoraWebhookSignatureError) {
        return response
          .status(options.invalidSignatureStatusCode ?? 401)
          .json({ error: "Invalid Visora webhook signature" });
      }

      if (next) {
        return next(error);
      }

      return response.status(500).json({ error: "Webhook handler failed" });
    }
  };
}
