export type ApiKeyStatus = "active" | "revoked";

export interface ApiKeyRecord {
  apiKeyHash: string;
  accountId: string;
  projectId: string;
  planId: string;
  status: ApiKeyStatus;
  monthlyLimit: number;
  createdAt: string;
  lastUsedAt?: string;
}

export interface UsageRecord {
  usageKey: string;
  accountId: string;
  projectId: string;
  planId: string;
  month: string;
  requestsUsed: number;
  updatedAt: string;
}

export interface AuthContext {
  apiKeyHash: string;
  accountId: string;
  projectId: string;
  planId: string;
  monthlyLimit: number;
  requestsUsed: number;
}

export interface CreateApiKeyRequest {
  accountId: string;
  projectId: string;
  planId: string;
  monthlyLimit: number;
}

export interface CreateApiKeyResponse extends ApiKeyRecord {
  rawApiKey: string;
}
