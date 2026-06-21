import type { APIGatewayProxyEvent } from "aws-lambda";

import { getApiKeyByHash, updateLastUsedAt } from "./api-key.repository.js";
import { getCurrentMonthUsage, incrementProjectUsage, incrementUsage } from "./usage.repository.js";
import type { ApiKeyRecord, AuthContext } from "../types/auth.types.js";
import { getPlanOverageConfig } from "../services/plan.service.js";
import { hashApiKey } from "../utils/crypto.js";
import { HttpError } from "../utils/http-response.js";

function getHeader(event: APIGatewayProxyEvent, headerName: string) {
  const requestedHeader = headerName.toLowerCase();

  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (name.toLowerCase() === requestedHeader) {
      return value;
    }
  }

  return undefined;
}

function validateApiKeyRecord(apiKeyRecord: ApiKeyRecord) {
  if (
    !apiKeyRecord.accountId ||
    !apiKeyRecord.projectId ||
    !apiKeyRecord.planId ||
    typeof apiKeyRecord.monthlyLimit !== "number"
  ) {
    throw new Error("API key record is misconfigured");
  }
}

export async function authenticateApiKey(
  event: APIGatewayProxyEvent
): Promise<AuthContext> {
  const apiKey = getHeader(event, "x-api-key")?.trim();

  if (!apiKey) {
    throw new HttpError(401, "Missing API key");
  }

  const apiKeyHash = hashApiKey(apiKey);
  const apiKeyRecord = await getApiKeyByHash(apiKeyHash);

  if (!apiKeyRecord) {
    throw new HttpError(401, "Invalid API key");
  }

  validateApiKeyRecord(apiKeyRecord);

  if (apiKeyRecord.status !== "active") {
    throw new HttpError(403, "API key is not active");
  }

  const usageRecord = await getCurrentMonthUsage(apiKeyRecord.accountId);
  const requestsUsed = usageRecord?.requestsUsed ?? 0;
  const overageConfig = getPlanOverageConfig(apiKeyRecord.planId);

  if (!overageConfig.overageEnabled && requestsUsed >= apiKeyRecord.monthlyLimit) {
    throw new HttpError(429, "Monthly usage limit exceeded");
  }

  return {
    apiKeyHash: apiKeyRecord.apiKeyHash,
    accountId: apiKeyRecord.accountId,
    projectId: apiKeyRecord.projectId,
    planId: apiKeyRecord.planId,
    monthlyLimit: apiKeyRecord.monthlyLimit,
    overageEnabled: overageConfig.overageEnabled,
    overagePriceCentsPerThousand: overageConfig.overagePriceCentsPerThousand,
    requestsUsed,
  };
}

export async function recordUsage(authContext: AuthContext): Promise<void> {
  await Promise.all([
    incrementUsage({
      accountId: authContext.accountId,
      projectId: authContext.projectId,
      planId: authContext.planId,
      monthlyLimit: authContext.monthlyLimit,
      overageEnabled: authContext.overageEnabled,
      overagePriceCentsPerThousand:
        authContext.overagePriceCentsPerThousand,
    }),
    incrementProjectUsage({
      accountId: authContext.accountId,
      projectId: authContext.projectId,
      planId: authContext.planId,
    }),
    updateLastUsedAt(authContext.apiKeyHash),
  ]);
}
