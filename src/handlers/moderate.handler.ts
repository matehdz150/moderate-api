import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { detectModerationLabels } from "../services/rekognition.service.js";
import { mapRekognitionLabelsToModerationResponse } from "../mappers/moderation.mapper.js";
import {
  badRequest,
  internalServerError,
  ok,
} from "../utils/http-response.js";

import type { ModerateImageRequest } from "../types/moderation.types.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

export async function handler(
  event: APIGatewayProxyEventV2
) {
  try {
    if (!BUCKET_NAME) {
      throw new Error("IMAGES_BUCKET_NAME is not configured");
    }

    if (!event.body) {
      return badRequest("Request body is required");
    }

    const body = JSON.parse(event.body) as ModerateImageRequest;

    if (!body.imageKey) {
      return badRequest("imageKey is required");
    }

    const labels = await detectModerationLabels(
      BUCKET_NAME,
      body.imageKey
    );

    const response =
      mapRekognitionLabelsToModerationResponse(labels);

    return ok(response);
  } catch (error) {
    console.error(error);

    return internalServerError();
  }
}