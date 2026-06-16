import type { APIGatewayProxyEvent } from "aws-lambda";

import { mapRekognitionLabelsToModerationResponse } from "../mappers/moderation.mapper.js";
import { detectModerationLabels } from "../services/rekognition.service.js";
import type { ModerateImageRequest } from "../types/moderation.types.js";
import { badRequest, ok } from "../utils/http-response.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

export async function moderateRoute(event: APIGatewayProxyEvent) {
  if (!BUCKET_NAME) {
    throw new Error("IMAGES_BUCKET_NAME is not configured");
  }

  if (!event.body) {
    return badRequest("Request body is required");
  }

  let body: ModerateImageRequest;

  try {
    body = JSON.parse(event.body) as ModerateImageRequest;
  } catch {
    return badRequest("Request body must be valid JSON");
  }

  if (!body.imageKey) {
    return badRequest("imageKey is required");
  }

  const labels = await detectModerationLabels(BUCKET_NAME, body.imageKey);
  const response = mapRekognitionLabelsToModerationResponse(labels);

  return ok(response);
}
