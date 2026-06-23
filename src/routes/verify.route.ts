import type { APIGatewayProxyEvent } from "aws-lambda";
import { ulid } from "ulid";

import { getCurrentMonthUsage } from "../auth/usage.repository.js";
import { getProjectById } from "../repositories/project.repository.js";
import { saveVerifyLog } from "../repositories/verify-log.repository.js";
import { getPlanRetentionDays, getVerifyAllowance } from "../services/plan.service.js";
import { uploadImageObject } from "../services/s3.service.js";
import { verifyIdentity } from "../services/verify.service.js";
import { recordVerificationUsage } from "../services/verify-usage.service.js";
import { publishWebhookEvent } from "../services/webhook-event.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { VerifyImageRequest, VerifyResponse } from "../types/verify.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseMultipartFiles } from "../utils/multipart-form-data.js";
import { assertImageKeyBelongsToProject, buildUploadImageKey } from "../utils/s3-key-scope.js";

const IMAGES_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
]);

interface VerifyImageSource {
  documentImageKey: string;
  selfieImageKey: string;
}

function getHeader(event: APIGatewayProxyEvent, headerName: string) {
  const normalizedHeaderName = headerName.toLowerCase();

  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }

  return undefined;
}

function isMultipartRequest(event: APIGatewayProxyEvent) {
  return getHeader(event, "content-type")
    ?.toLowerCase()
    .startsWith("multipart/form-data");
}

async function assertVerifyQuota(authContext: AuthContext) {
  const { included, overageCents } = getVerifyAllowance(authContext.planId);

  // Paid plans bill overage beyond the included amount — no hard cap.
  if (overageCents > 0) return;

  // Free (or unknown) plans are hard-capped at the included monthly allotment.
  const usage = await getCurrentMonthUsage(authContext.accountId);
  const used = usage?.verificationsUsed ?? 0;

  if (used >= included) {
    throw new HttpError(
      403,
      `Free plan is limited to ${included} verifications per month. Upgrade to a paid plan for more.`
    );
  }
}

function parseVerifyImageRequest(body: string | null): VerifyImageRequest {
  if (!body) {
    throw new HttpError(400, "Request body is required");
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  const { documentImageKey, selfieImageKey } = parsedBody as Partial<VerifyImageRequest>;

  if (typeof documentImageKey !== "string" || documentImageKey.trim().length === 0) {
    throw new HttpError(400, "documentImageKey is required");
  }
  if (typeof selfieImageKey !== "string" || selfieImageKey.trim().length === 0) {
    throw new HttpError(400, "selfieImageKey is required");
  }

  return {
    documentImageKey: documentImageKey.trim(),
    selfieImageKey: selfieImageKey.trim(),
  };
}

async function uploadVerifyImage(
  authContext: AuthContext,
  file: { contentType: string; content: Buffer },
  label: string
): Promise<string> {
  if (!IMAGES_BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  const normalizedContentType = file.contentType.toLowerCase();
  const extension = SUPPORTED_UPLOAD_TYPES.get(normalizedContentType);

  if (!extension) {
    throw new HttpError(400, `Only JPEG and PNG images are supported (${label})`);
  }
  if (file.content.length === 0) {
    throw new HttpError(400, `${label} file must not be empty`);
  }
  if (file.content.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `${label} file must be 8 MB or smaller`);
  }

  const imageKey = buildUploadImageKey(
    authContext.accountId,
    authContext.projectId,
    extension
  );

  await uploadImageObject({
    bucketName: IMAGES_BUCKET_NAME,
    imageKey,
    contentType: normalizedContentType,
    body: file.content,
    retentionTags: {
      planId: authContext.planId,
      retentionDays: getPlanRetentionDays(authContext.planId),
    },
  });

  return imageKey;
}

async function getVerifyImageSource(
  event: APIGatewayProxyEvent,
  authContext: AuthContext
): Promise<VerifyImageSource> {
  if (isMultipartRequest(event)) {
    const files = parseMultipartFiles(event);
    const document = files.find((item) => item.fieldName === "document");
    const selfie = files.find((item) => item.fieldName === "selfie");

    if (!document) throw new HttpError(400, "document file is required");
    if (!selfie) throw new HttpError(400, "selfie file is required");

    const [documentImageKey, selfieImageKey] = await Promise.all([
      uploadVerifyImage(authContext, document, "document"),
      uploadVerifyImage(authContext, selfie, "selfie"),
    ]);

    return { documentImageKey, selfieImageKey };
  }

  const request = parseVerifyImageRequest(event.body);
  assertImageKeyBelongsToProject(request.documentImageKey, authContext);
  assertImageKeyBelongsToProject(request.selfieImageKey, authContext);

  return {
    documentImageKey: request.documentImageKey,
    selfieImageKey: request.selfieImageKey,
  };
}

export async function verifyRoute(event: APIGatewayProxyEvent, authContext: AuthContext) {
  if (!IMAGES_BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  await assertVerifyQuota(authContext);

  const source = await getVerifyImageSource(event, authContext);

  const project = await getProjectById({
    accountId: authContext.accountId,
    projectId: authContext.projectId,
  });

  if (!project || project.projectType !== "verify") {
    throw new HttpError(403, "This API key is not attached to a verify project");
  }

  const analysis = await verifyIdentity({
    bucketName: IMAGES_BUCKET_NAME,
    documentImageKey: source.documentImageKey,
    selfieImageKey: source.selfieImageKey,
    settings: project.verifySettings,
  });

  const createdAt = new Date().toISOString();
  const response: VerifyResponse = {
    verificationId: `ver_${ulid()}`,
    decision: analysis.decision,
    confidence: analysis.confidence,
    reasons: analysis.reasons,
    document: analysis.document,
    faceMatch: analysis.faceMatch,
    selfie: analysis.selfie,
    documentImageKey: source.documentImageKey,
    selfieImageKey: source.selfieImageKey,
    createdAt,
  };

  // Persist a privacy-preserving log (no raw PII field values). A logging
  // failure must never fail the verification itself.
  try {
    await saveVerifyLog({
      verificationId: response.verificationId,
      accountId: authContext.accountId,
      projectId: authContext.projectId,
      planId: authContext.planId,
      decision: response.decision,
      confidence: response.confidence,
      faceMatchSimilarity: response.faceMatch.similarity,
      documentType: response.document.type,
      documentDetected: response.document.detected,
      documentExpired: response.document.expired,
      selfieQuality: response.selfie.quality,
      reasons: response.reasons,
      documentImageKey: response.documentImageKey,
      selfieImageKey: response.selfieImageKey,
      createdAt,
    });
  } catch (error) {
    console.error("Failed to persist verify log", error);
  }

  // Async-delivered, HMAC-signed webhook. No raw PII in the payload.
  await publishWebhookEvent({
    type: "verification.completed",
    accountId: authContext.accountId,
    projectId: authContext.projectId,
    payload: {
      verificationId: response.verificationId,
      decision: response.decision,
      confidence: response.confidence,
      faceMatchSimilarity: response.faceMatch.similarity,
      documentType: response.document.type,
      documentDetected: response.document.detected,
      documentExpired: response.document.expired,
      selfieQuality: response.selfie.quality,
      reasons: response.reasons,
      createdAt,
    },
  });

  // Count this verification against the account's monthly allotment and bill
  // overage for paid plans. Never fails the verification.
  await recordVerificationUsage({
    accountId: authContext.accountId,
    planId: authContext.planId,
  });

  return ok(response);
}
