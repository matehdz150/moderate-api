import type { APIGatewayProxyEvent } from "aws-lambda";

import { listApiKeysByAccount } from "../auth/api-key.repository.js";
import { getProjectById } from "../repositories/project.repository.js";
import { createApiKey } from "../services/api-key.service.js";
import type { CreateApiKeyRequest } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";

function parseCreateApiKeyRequest(event: APIGatewayProxyEvent): {
  projectId: string;
  name?: string;
} {
  const body = parseJsonObjectBody(event.body);

  if (
    typeof body.projectId !== "string" ||
    body.projectId.trim().length === 0
  ) {
    throw new HttpError(400, "projectId must be a non-empty string");
  }

  return {
    projectId: body.projectId.trim(),
    ...(typeof body.name === "string" && body.name.trim().length > 0
      ? { name: body.name.trim() }
      : {}),
  };
}

function maskApiKeyHash(apiKeyHash: string) {
  return `${apiKeyHash.slice(0, 10)}...${apiKeyHash.slice(-6)}`;
}

export async function listApiKeysRoute(authContext: CognitoAuthContext) {
  const accountId = getDashboardAccountId(authContext.userId);
  const apiKeys = await listApiKeysByAccount(accountId);

  return ok({
    apiKeys: apiKeys.map((apiKey) => ({
      ...apiKey,
      apiKeyHash: maskApiKeyHash(apiKey.apiKeyHash),
    })),
  });
}

export async function createApiKeyRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const parsed = parseCreateApiKeyRequest(event);
  const accountId = getDashboardAccountId(authContext.userId);
  const project = await getProjectById({ accountId, projectId: parsed.projectId });

  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  const request: CreateApiKeyRequest = {
    accountId,
    projectId: project.projectId,
    planId: project.planId,
    monthlyLimit: project.monthlyLimit,
    ...(parsed.name ? { name: parsed.name } : {}),
  };
  const response = await createApiKey(request);

  return ok(response);
}
