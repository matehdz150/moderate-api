export type PlanId = "free" | "starter" | "growth" | "scale";

export interface PlanConfig {
  planId: PlanId;
  name: string;
  monthlyLimit: number;
  projectLimit: number;
  apiKeyLimit: number;
  logRetentionDays: number;
  priceUsd: number;
}

export interface AccountRecord {
  accountId: string;
  userId: string;
  email: string;
  planId: PlanId;
  monthlyLimit: number;
  projectLimit: number;
  apiKeyLimit: number;
  logRetentionDays: number;
  createdAt: string;
  updatedAt: string;
}
