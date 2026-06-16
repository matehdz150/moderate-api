import { ulid } from "ulid";

import { createUploadUrl } from "../services/s3.service.js";
import type { UploadUrlResponse } from "../types/moderation.types.js";
import { ok } from "../utils/http-response.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

export async function uploadUrlRoute() {
  if (!BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  const imageKey = `uploads/${ulid()}.jpg`;
  const uploadUrl = await createUploadUrl(BUCKET_NAME, imageKey);

  const response: UploadUrlResponse = {
    uploadUrl,
    imageKey,
  };

  return ok(response);
}
