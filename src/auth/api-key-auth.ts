import type { APIGatewayProxyEvent } from "aws-lambda";

import { getApiKeyByHash, updateLastUsedAt } from "./api-key.repository.js";
import { getCurrentMonthUsage, incrementUsage } from "./usage.repository.js";
import type { AuthContext } from "../types/auth.types.js";
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

export async function authenticateApiKey(
  event: APIGatewayProxyEvent
): Promise<AuthContext> {
  const apiKey = getHeader(event, "x-api-key");

  if (!apiKey) {
    throw new HttpError(401, "Missing API key");
  }

  const apiKeyHash = hashApiKey(apiKey);
  const apiKeyRecord = await getApiKeyByHash(apiKeyHash);

  if (!apiKeyRecord) {
    throw new HttpError(401, "Invalid API key");
  }

  if (apiKeyRecord.status !== "active") {
    throw new HttpError(403, "API key is not active");
  }

  const usageRecord = await getCurrentMonthUsage(apiKeyRecord.accountId);
  const requestsUsed = usageRecord?.requestsUsed ?? 0;

  if (requestsUsed >= apiKeyRecord.monthlyLimit) {
    throw new HttpError(429, "Monthly usage limit exceeded");
  }

  await updateLastUsedAt(apiKeyRecord.apiKeyHash);

  return {
    accountId: apiKeyRecord.accountId,
    projectId: apiKeyRecord.projectId,
    planId: apiKeyRecord.planId,
    monthlyLimit: apiKeyRecord.monthlyLimit,
    requestsUsed,
  };
}

export async function recordUsage(authContext: AuthContext): Promise<void> {
  await incrementUsage({
    accountId: authContext.accountId,
    projectId: authContext.projectId,
    planId: authContext.planId,
  });
}
