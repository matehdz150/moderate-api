import { randomBytes } from "node:crypto";

import {
  createApiKeyRecord,
  getApiKeyByHash,
  revokeApiKey,
} from "../auth/api-key.repository.js";
import type {
  ApiKeyRecord,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from "../types/auth.types.js";
import { hashApiKey } from "../utils/crypto.js";
import { HttpError } from "../utils/http-response.js";

export async function createApiKey(
  request: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  const rawApiKey = `sk_test_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = hashApiKey(rawApiKey);
  const createdAt = new Date().toISOString();
  const apiKeyRecord = {
    apiKeyHash,
    accountId: request.accountId,
    projectId: request.projectId,
    planId: request.planId,
    status: "active" as const,
    monthlyLimit: request.monthlyLimit,
    createdAt,
    ...(request.name ? { name: request.name } : {}),
  };

  await createApiKeyRecord(apiKeyRecord);

  return {
    rawApiKey,
    ...apiKeyRecord,
  };
}

export async function rotateApiKey(params: {
  accountId: string;
  apiKeyHash: string;
}): Promise<{ revokedApiKey: ApiKeyRecord; apiKey: CreateApiKeyResponse }> {
  const currentApiKey = await getApiKeyByHash(params.apiKeyHash);

  if (!currentApiKey || currentApiKey.accountId !== params.accountId) {
    throw new HttpError(404, "API key not found");
  }

  if (currentApiKey.status !== "active") {
    throw new HttpError(403, "API key is not active");
  }

  const revokedApiKey = await revokeApiKey({
    accountId: params.accountId,
    apiKeyHash: params.apiKeyHash,
  });
  const apiKey = await createApiKey({
    accountId: currentApiKey.accountId,
    projectId: currentApiKey.projectId,
    planId: currentApiKey.planId,
    monthlyLimit: currentApiKey.monthlyLimit,
    ...(currentApiKey.name ? { name: currentApiKey.name } : {}),
  });

  return {
    revokedApiKey,
    apiKey,
  };
}
