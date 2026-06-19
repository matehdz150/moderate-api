import type { APIGatewayProxyEvent } from "aws-lambda";

import {
  listApiKeysByAccount,
  revokeApiKey,
  updateApiKeyName,
} from "../auth/api-key.repository.js";
import { getProjectById } from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createApiKey, rotateApiKey } from "../services/api-key.service.js";
import type { CreateApiKeyRequest } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import {
  toDashboardApiKey,
  toDashboardCreatedApiKey,
} from "../utils/api-key-presenter.js";

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

function parseApiKeyHashBody(event: APIGatewayProxyEvent): string {
  const body = parseJsonObjectBody(event.body);

  if (
    typeof body.apiKeyHash !== "string" ||
    body.apiKeyHash.trim().length === 0
  ) {
    throw new HttpError(400, "apiKeyHash must be a non-empty string");
  }

  return body.apiKeyHash.trim();
}

function parseRenameApiKeyRequest(event: APIGatewayProxyEvent): {
  apiKeyHash: string;
  name: string;
} {
  const body = parseJsonObjectBody(event.body);

  if (
    typeof body.apiKeyHash !== "string" ||
    body.apiKeyHash.trim().length === 0
  ) {
    throw new HttpError(400, "apiKeyHash must be a non-empty string");
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new HttpError(400, "name must be a non-empty string");
  }

  return {
    apiKeyHash: body.apiKeyHash.trim(),
    name: body.name.trim(),
  };
}

function isConditionalCheckFailed(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

export async function listApiKeysRoute(authContext: CognitoAuthContext) {
  const accountId = getDashboardAccountId(authContext.userId);
  const apiKeys = await listApiKeysByAccount(accountId);

  return ok({
    apiKeys: apiKeys.map(toDashboardApiKey),
  });
}

export async function createApiKeyRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const parsed = parseCreateApiKeyRequest(event);
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const accountId = account.accountId;
  const project = await getProjectById({ accountId, projectId: parsed.projectId });

  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  const apiKeys = await listApiKeysByAccount(accountId);

  if (apiKeys.length >= account.apiKeyLimit) {
    throw new HttpError(403, "API key limit reached for current plan");
  }

  const request: CreateApiKeyRequest = {
    accountId,
    projectId: project.projectId,
    planId: account.planId,
    monthlyLimit: account.monthlyLimit,
    ...(parsed.name ? { name: parsed.name } : {}),
  };
  const response = await createApiKey(request);

  return ok(toDashboardCreatedApiKey(response));
}

export async function renameApiKeyRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const parsed = parseRenameApiKeyRequest(event);
  const accountId = getDashboardAccountId(authContext.userId);

  try {
    const apiKey = await updateApiKeyName({
      accountId,
      apiKeyHash: parsed.apiKeyHash,
      name: parsed.name,
    });

    return ok(toDashboardApiKey(apiKey));
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new HttpError(404, "API key not found");
    }

    throw error;
  }
}

export async function revokeApiKeyRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const apiKeyHash = parseApiKeyHashBody(event);
  const accountId = getDashboardAccountId(authContext.userId);

  try {
    const apiKey = await revokeApiKey({
      accountId,
      apiKeyHash,
    });

    return ok(toDashboardApiKey(apiKey));
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new HttpError(404, "API key not found");
    }

    throw error;
  }
}

export async function rotateApiKeyRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const apiKeyHash = parseApiKeyHashBody(event);
  const accountId = getDashboardAccountId(authContext.userId);
  const response = await rotateApiKey({ accountId, apiKeyHash });

  return ok({
    revokedApiKey: toDashboardApiKey(response.revokedApiKey),
    apiKey: toDashboardCreatedApiKey(response.apiKey),
  });
}
