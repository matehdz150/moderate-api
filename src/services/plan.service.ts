import type { PlanConfig, PlanId } from "../types/account.types.js";
import { HttpError } from "../utils/http-response.js";

export const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  free: {
    planId: "free",
    name: "Free",
    monthlyLimit: 500,
    projectLimit: 1,
    apiKeyLimit: 1,
    logRetentionDays: 7,
    priceUsd: 0,
    overageEnabled: false,
    overagePriceCentsPerThousand: 0,
  },
  starter: {
    planId: "starter",
    name: "Starter",
    monthlyLimit: 10000,
    projectLimit: 3,
    apiKeyLimit: 3,
    logRetentionDays: 30,
    priceUsd: 29,
    overageEnabled: true,
    overagePriceCentsPerThousand: 400,
  },
  growth: {
    planId: "growth",
    name: "Growth",
    monthlyLimit: 50000,
    projectLimit: 10,
    apiKeyLimit: 10,
    logRetentionDays: 90,
    priceUsd: 149,
    overageEnabled: true,
    overagePriceCentsPerThousand: 300,
  },
  scale: {
    planId: "scale",
    name: "Scale",
    monthlyLimit: 150000,
    projectLimit: 50,
    apiKeyLimit: 50,
    logRetentionDays: 180,
    priceUsd: 399,
    overageEnabled: true,
    overagePriceCentsPerThousand: 250,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PLAN_CONFIGS, value)
  );
}

export function getPlanConfig(planId: PlanId): PlanConfig {
  return PLAN_CONFIGS[planId];
}

export function getPlanRetentionDays(planId: string): number {
  return isPlanId(planId) ? PLAN_CONFIGS[planId].logRetentionDays : 7;
}

export function getPlanOverageConfig(planId: string) {
  if (!isPlanId(planId)) {
    return {
      overageEnabled: false,
      overagePriceCentsPerThousand: 0,
    };
  }

  const plan = PLAN_CONFIGS[planId];

  return {
    overageEnabled: plan.overageEnabled,
    overagePriceCentsPerThousand: plan.overagePriceCentsPerThousand,
  };
}

export function parsePlanId(value: unknown): PlanId {
  if (!isPlanId(value)) {
    throw new HttpError(400, "planId must be one of: free, starter, growth, scale");
  }

  return value;
}
