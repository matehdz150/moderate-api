import type { APIGatewayProxyEvent } from "aws-lambda";
import { ulid } from "ulid";

import { getProjectById } from "../repositories/project.repository.js";
import { saveRedactionLog } from "../repositories/redaction-log.repository.js";
import { detectFaces, detectText } from "../services/rekognition.service.js";
import { publishWebhookEvent } from "../services/webhook-event.service.js";
import { getPlanRetentionDays } from "../services/plan.service.js";
import { redactImage } from "../services/redaction.service.js";
import { createImageReadUrl, downloadImageObject, uploadImageObject } from "../services/s3.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { RedactImageRequest, RedactionResponse } from "../types/redaction.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseMultipartFiles } from "../utils/multipart-form-data.js";
import { buildRedactedImageKey } from "../utils/redaction-key-scope.js";
import { normalizeRedactionSettings } from "../utils/redaction-settings.js";
import { assertImageKeyBelongsToProject, buildUploadImageKey } from "../utils/s3-key-scope.js";

const ORIGINAL_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const REDACTED_BUCKET_NAME = process.env.REDACTED_IMAGES_BUCKET_NAME;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
]);

interface RedactionImageSource {
  imageKey: string;
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

function parseRedactImageRequest(body: string | null): RedactImageRequest {
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

  const { imageKey } = parsedBody as Partial<RedactImageRequest>;

  if (typeof imageKey !== "string" || imageKey.trim().length === 0) {
    throw new HttpError(400, "imageKey is required");
  }

  return { imageKey: imageKey.trim() };
}

function assertPaidPlan(authContext: AuthContext) {
  if (authContext.planId === "free") {
    throw new HttpError(403, "Redaction is available on paid plans only");
  }
}

async function uploadRedactionImage(
  event: APIGatewayProxyEvent,
  authContext: AuthContext
): Promise<RedactionImageSource> {
  if (!ORIGINAL_BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  const file = parseMultipartFiles(event).find((item) => item.fieldName === "image");

  if (!file) {
    throw new HttpError(400, "image file is required");
  }

  const normalizedContentType = file.contentType.toLowerCase();
  const extension = SUPPORTED_UPLOAD_TYPES.get(normalizedContentType);

  if (!extension) {
    throw new HttpError(400, "Only JPEG and PNG images are supported");
  }

  if (file.content.length === 0) {
    throw new HttpError(400, "image file must not be empty");
  }

  if (file.content.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, "Image file must be 8 MB or smaller");
  }

  const imageKey = buildUploadImageKey(
    authContext.accountId,
    authContext.projectId,
    extension
  );

  await uploadImageObject({
    bucketName: ORIGINAL_BUCKET_NAME,
    imageKey,
    contentType: normalizedContentType,
    body: file.content,
    retentionTags: {
      planId: authContext.planId,
      retentionDays: getPlanRetentionDays(authContext.planId),
    },
  });

  return { imageKey };
}

async function getRedactionImageSource(
  event: APIGatewayProxyEvent,
  authContext: AuthContext
): Promise<RedactionImageSource> {
  if (isMultipartRequest(event)) {
    return uploadRedactionImage(event, authContext);
  }

  if (!event.body) {
    throw new HttpError(400, "Request body is required");
  }

  const request = parseRedactImageRequest(event.body);
  assertImageKeyBelongsToProject(request.imageKey, authContext);

  return { imageKey: request.imageKey };
}

export async function redactRoute(event: APIGatewayProxyEvent, authContext: AuthContext) {
  if (!ORIGINAL_BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  if (!REDACTED_BUCKET_NAME) {
    throw new Error("REDACTED_IMAGES_BUCKET_NAME is not configured");
  }

  assertPaidPlan(authContext);

  const source = await getRedactionImageSource(event, authContext);

  const project = await getProjectById({
    accountId: authContext.accountId,
    projectId: authContext.projectId,
  });

  if (!project || project.projectType !== "redaction") {
    throw new HttpError(403, "This API key is not attached to a redaction project");
  }

  const settings = normalizeRedactionSettings(project.redactionSettings);
  const shouldDetectFaces = settings.faceBlur;
  const shouldDetectText = settings.textBlur || settings.licensePlateBlur;

  const [faces, textDetections, imageBuffer] = await Promise.all([
    shouldDetectFaces ? detectFaces(ORIGINAL_BUCKET_NAME, source.imageKey) : Promise.resolve([]),
    shouldDetectText ? detectText(ORIGINAL_BUCKET_NAME, source.imageKey) : Promise.resolve([]),
    downloadImageObject({
      bucketName: ORIGINAL_BUCKET_NAME,
      imageKey: source.imageKey,
    }),
  ]);
  const redaction = await redactImage({
    imageBuffer,
    faces,
    textDetections,
    settings,
  });
  const redactedImageKey = buildRedactedImageKey(authContext.accountId, authContext.projectId);

  await uploadImageObject({
    bucketName: REDACTED_BUCKET_NAME,
    imageKey: redactedImageKey,
    contentType: "image/jpeg",
    body: redaction.outputBuffer,
    retentionTags: {
      planId: authContext.planId,
      retentionDays: getPlanRetentionDays(authContext.planId),
    },
  });

  const redactedImageUrl = await createImageReadUrl(REDACTED_BUCKET_NAME, redactedImageKey);
  const response: RedactionResponse = {
    redactionId: `red_${ulid()}`,
    imageKey: source.imageKey,
    redactedImageKey,
    redactedImageUrl,
    facesBlurred: redaction.faces.length,
    textBlurred: redaction.regions.filter((region) => region.type === "text").length,
    licensePlatesBlurred: redaction.regions.filter((region) => region.type === "license_plate").length,
    faces: redaction.faces,
    regions: redaction.regions,
  };

  // Persist the redaction for the dashboard logs / detail drawer. A logging
  // failure must never fail the redaction itself.
  const createdAt = new Date().toISOString();
  try {
    await saveRedactionLog({
      redactionId: response.redactionId,
      accountId: authContext.accountId,
      projectId: authContext.projectId,
      planId: authContext.planId,
      imageKey: response.imageKey,
      redactedImageKey: response.redactedImageKey,
      style: settings.redactionStyle,
      facesBlurred: response.facesBlurred,
      textBlurred: response.textBlurred,
      licensePlatesBlurred: response.licensePlatesBlurred,
      regions: response.regions,
      createdAt,
    });
  } catch (error) {
    console.error("Failed to persist redaction log", error);
  }

  // Async-delivered, HMAC-signed webhook. No-ops if webhook env is unset.
  await publishWebhookEvent({
    type: "redaction.completed",
    accountId: authContext.accountId,
    projectId: authContext.projectId,
    payload: {
      redactionId: response.redactionId,
      imageKey: response.imageKey,
      redactedImageKey: response.redactedImageKey,
      style: settings.redactionStyle,
      facesBlurred: response.facesBlurred,
      textBlurred: response.textBlurred,
      licensePlatesBlurred: response.licensePlatesBlurred,
      regions: response.regions,
      createdAt,
    },
  });

  return ok(response);
}
