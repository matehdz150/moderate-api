import type { APIGatewayProxyEvent } from "aws-lambda";

import { mapRekognitionLabelsToModerationResponse } from "../mappers/moderation.mapper.js";
import { detectModerationLabels } from "../services/rekognition.service.js";
import type { ModerateImageRequest } from "../types/moderation.types.js";
import { badRequest, HttpError, ok } from "../utils/http-response.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

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

export async function moderateRoute(event: APIGatewayProxyEvent) {
  if (!BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  if (!event.body) {
    return badRequest("Request body is required");
  }

  const body = parseModerateImageRequest(event.body);

  try {
    const labels = await detectModerationLabels(BUCKET_NAME, body.imageKey);
    const response = mapRekognitionLabelsToModerationResponse(labels);

    return ok(response);
  } catch (error) {
    return mapModerationError(error);
  }
}
