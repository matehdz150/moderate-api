import type { APIGatewayProxyEvent } from "aws-lambda";
import { ulid } from "ulid";

import { getPolicyByProjectId } from "../repositories/policy.repository.js";
import { saveModerationLog } from "../repositories/moderation-log.repository.js";
import { evaluateBrandSafety } from "../services/brand-safety.service.js";
import {
  evaluateCompliancePack,
  getCompliancePack,
} from "../services/compliance-packs.service.js";
import {
  detectGeneralLabels,
  detectModerationLabels,
} from "../services/rekognition.service.js";
import { uploadImageObject } from "../services/s3.service.js";
import { getPlanRetentionDays } from "../services/plan.service.js";
import {
  evaluateModerationPolicy,
  getDefaultModerationPolicy,
} from "../services/policy-engine.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { ModerateImageRequest } from "../types/moderation.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseMultipartFiles } from "../utils/multipart-form-data.js";
import {
  assertImageKeyBelongsToProject,
  buildUploadImageKey,
} from "../utils/s3-key-scope.js";
import type { ModerationPolicy } from "../types/policy.types.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
]);

interface ModerationImageSource {
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

function parseModerateImageRequest(body: string): ModerateImageRequest {
  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  if (
    !parsedBody ||
    typeof parsedBody !== "object" ||
    Array.isArray(parsedBody)
  ) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  const imageKey = (parsedBody as Record<string, unknown>).imageKey;

  if (typeof imageKey !== "string" || imageKey.trim().length === 0) {
    throw new HttpError(400, "imageKey must be a non-empty string");
  }

  return {
    imageKey: imageKey.trim(),
  };
}

async function uploadModerationImage(
  event: APIGatewayProxyEvent,
  authContext: AuthContext
): Promise<ModerationImageSource> {
  if (!BUCKET_NAME) {
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
    bucketName: BUCKET_NAME,
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

async function getModerationImageSource(
  event: APIGatewayProxyEvent,
  authContext: AuthContext
): Promise<ModerationImageSource> {
  if (isMultipartRequest(event)) {
    return uploadModerationImage(event, authContext);
  }

  if (!event.body) {
    throw new HttpError(400, "Request body is required");
  }

  const body = parseModerateImageRequest(event.body);
  assertImageKeyBelongsToProject(body.imageKey, authContext);

  return { imageKey: body.imageKey };
}

function mapModerationError(error: unknown): never {
  const errorName = error instanceof Error ? error.name : undefined;

  if (errorName === "InvalidS3ObjectException") {
    throw new HttpError(400, "Image not found or cannot be read");
  }

  if (errorName === "InvalidImageFormatException") {
    throw new HttpError(400, "Unsupported image format");
  }

  if (errorName === "ImageTooLargeException") {
    throw new HttpError(400, "Image file is too large");
  }

  throw error;
}

function policyRequiresSupplementalLabels(policy: ModerationPolicy) {
  const supplementalCategories = new Set(["weapons", "drugs"]);
  const categories = new Set([
    ...policy.blockedCategories,
    ...Object.keys(policy.categoryActions),
  ]);

  return Array.from(supplementalCategories).some((category) =>
    categories.has(category)
  );
}

function shouldDetectGeneralLabels(params: {
  moderationOnlyDecision: ReturnType<typeof evaluateModerationPolicy>;
  policy: ModerationPolicy;
}) {
  if (params.moderationOnlyDecision.labels.length === 0) {
    return true;
  }

  if (!params.policy.compliancePack) {
    return false;
  }

  return policyRequiresSupplementalLabels(
    getCompliancePack(params.policy.compliancePack)
  );
}

export async function moderateRoute(
  event: APIGatewayProxyEvent,
  authContext: AuthContext
) {
  if (!BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  try {
    const imageSource = await getModerationImageSource(event, authContext);
    const policy =
      (await getPolicyByProjectId(authContext.projectId)) ??
      getDefaultModerationPolicy(authContext.projectId);
    const labels = await detectModerationLabels(BUCKET_NAME, imageSource.imageKey);
    const moderationOnlyDecision = evaluateModerationPolicy({
      moderationLabels: labels,
      policy,
    });
    const generalLabels = shouldDetectGeneralLabels({
      moderationOnlyDecision,
      policy,
    })
      ? await detectGeneralLabels(BUCKET_NAME, imageSource.imageKey)
      : [];
    const decision = evaluateModerationPolicy({
      moderationLabels: labels,
      generalLabels,
      policy,
    });
    const brandSafety = evaluateBrandSafety({
      action: decision.action,
      riskScore: decision.riskScore,
      labels: decision.labels,
      policy,
    });
    const compliance = policy.compliancePack
      ? evaluateCompliancePack({
          packName: policy.compliancePack,
          moderationLabels: labels,
          generalLabels,
        })
      : undefined;
    const response = {
      moderationId: `mod_${ulid()}`,
      safe: decision.safe,
      action: decision.action,
      riskScore: decision.riskScore,
      category: decision.category,
      labels: decision.labels,
      brandSafety,
      ...(compliance ? { compliance } : {}),
    };

    await saveModerationLog({
      moderationId: response.moderationId,
      accountId: authContext.accountId,
      projectId: authContext.projectId,
      planId: authContext.planId,
      imageKey: imageSource.imageKey,
      safe: response.safe,
      action: response.action,
      riskScore: response.riskScore,
      category: response.category,
      policyMode: policy.mode,
      labels: response.labels,
      brandSafety: response.brandSafety,
      ...(compliance ? { compliance } : {}),
      createdAt: new Date().toISOString(),
    });

    return ok(response);
  } catch (error) {
    return mapModerationError(error);
  }
}
