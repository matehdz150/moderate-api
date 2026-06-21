import type { APIGatewayProxyEvent } from "aws-lambda";
import { ulid } from "ulid";

import { getProjectById } from "../repositories/project.repository.js";
import { detectFaces, detectText } from "../services/rekognition.service.js";
import { getPlanRetentionDays } from "../services/plan.service.js";
import { redactImage } from "../services/redaction.service.js";
import { createImageReadUrl, downloadImageObject, uploadImageObject } from "../services/s3.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { RedactImageRequest, RedactionResponse } from "../types/redaction.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { buildRedactedImageKey } from "../utils/redaction-key-scope.js";
import { normalizeRedactionSettings } from "../utils/redaction-settings.js";
import { assertImageKeyBelongsToProject } from "../utils/s3-key-scope.js";

const ORIGINAL_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const REDACTED_BUCKET_NAME = process.env.REDACTED_IMAGES_BUCKET_NAME;

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

export async function redactRoute(event: APIGatewayProxyEvent, authContext: AuthContext) {
  if (!ORIGINAL_BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  if (!REDACTED_BUCKET_NAME) {
    throw new Error("REDACTED_IMAGES_BUCKET_NAME is not configured");
  }

  assertPaidPlan(authContext);

  const request = parseRedactImageRequest(event.body);

  assertImageKeyBelongsToProject(request.imageKey, authContext);

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
    shouldDetectFaces ? detectFaces(ORIGINAL_BUCKET_NAME, request.imageKey) : Promise.resolve([]),
    shouldDetectText ? detectText(ORIGINAL_BUCKET_NAME, request.imageKey) : Promise.resolve([]),
    downloadImageObject({
      bucketName: ORIGINAL_BUCKET_NAME,
      imageKey: request.imageKey,
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
    imageKey: request.imageKey,
    redactedImageKey,
    redactedImageUrl,
    facesBlurred: redaction.faces.length,
    textBlurred: redaction.regions.filter((region) => region.type === "text").length,
    licensePlatesBlurred: redaction.regions.filter((region) => region.type === "license_plate").length,
    faces: redaction.faces,
    regions: redaction.regions,
  };

  return ok(response);
}
