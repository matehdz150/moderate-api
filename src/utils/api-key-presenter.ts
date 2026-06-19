import type { ApiKeyRecord, CreateApiKeyResponse } from "../types/auth.types.js";

export type DashboardApiKeyRecord = ApiKeyRecord & {
  displayKey: string;
};

export type DashboardCreateApiKeyResponse = CreateApiKeyResponse & {
  displayKey: string;
};

export function maskApiKeyHash(apiKeyHash: string) {
  return `${apiKeyHash.slice(0, 10)}...${apiKeyHash.slice(-6)}`;
}

export function toDashboardApiKey(apiKey: ApiKeyRecord): DashboardApiKeyRecord {
  return {
    ...apiKey,
    displayKey: maskApiKeyHash(apiKey.apiKeyHash),
  };
}

export function toDashboardCreatedApiKey(
  apiKey: CreateApiKeyResponse
): DashboardCreateApiKeyResponse {
  return {
    ...apiKey,
    displayKey: maskApiKeyHash(apiKey.apiKeyHash),
  };
}
