import { randomBytes } from "node:crypto";

import { createApiKeyRecord } from "../auth/api-key.repository.js";
import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from "../types/auth.types.js";
import { hashApiKey } from "../utils/crypto.js";

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
