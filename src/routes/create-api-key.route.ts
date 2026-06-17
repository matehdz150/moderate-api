import type { APIGatewayProxyEvent } from "aws-lambda";

import { createApiKey } from "../services/api-key.service.js";
import type { CreateApiKeyRequest } from "../types/auth.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";

function parseCreateApiKeyRequest(
  event: APIGatewayProxyEvent
): CreateApiKeyRequest {
  const body = parseJsonObjectBody(event.body);

  if (
    typeof body.accountId !== "string" ||
    body.accountId.trim().length === 0
  ) {
    throw new HttpError(400, "accountId must be a non-empty string");
  }

  if (
    typeof body.projectId !== "string" ||
    body.projectId.trim().length === 0
  ) {
    throw new HttpError(400, "projectId must be a non-empty string");
  }

  if (typeof body.planId !== "string" || body.planId.trim().length === 0) {
    throw new HttpError(400, "planId must be a non-empty string");
  }

  if (
    typeof body.monthlyLimit !== "number" ||
    !Number.isInteger(body.monthlyLimit) ||
    body.monthlyLimit <= 0
  ) {
    throw new HttpError(400, "monthlyLimit must be a positive integer");
  }

  return {
    accountId: body.accountId.trim(),
    projectId: body.projectId.trim(),
    planId: body.planId.trim(),
    monthlyLimit: body.monthlyLimit,
  };
}

export async function createApiKeyRoute(event: APIGatewayProxyEvent) {
  const request = parseCreateApiKeyRequest(event);
  const response = await createApiKey(request);

  return ok(response);
}
