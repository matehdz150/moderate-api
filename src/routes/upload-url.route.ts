import { createUploadUrl } from "../services/s3.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { UploadUrlResponse } from "../types/moderation.types.js";
import { ok } from "../utils/http-response.js";
import { buildUploadImageKey } from "../utils/s3-key-scope.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

export async function uploadUrlRoute(authContext: AuthContext) {
  if (!BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  const imageKey = buildUploadImageKey(
    authContext.accountId,
    authContext.projectId
  );
  const uploadUrl = await createUploadUrl(BUCKET_NAME, imageKey);

  const response: UploadUrlResponse = {
    uploadUrl,
    imageKey,
  };

  return ok(response);
}
