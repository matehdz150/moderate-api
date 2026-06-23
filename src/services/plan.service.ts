import type { PlanConfig, PlanId } from "../types/account.types.js";
import { HttpError } from "../utils/http-response.js";

/**
 * Free plan can try redaction and verify, but with a small monthly cap per
 * project. Paid plans are unlimited (subject to their overall monthlyLimit).
 */
export const FREE_MONTHLY_REDACTIONS = 50;
export const FREE_MONTHLY_VERIFICATIONS = 25;

/** ISO timestamp for the first day of the current month (UTC). */
export function getMonthStartIso(): string {
  return `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
}

export const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {
  free: {
    planId: "free",
    name: "Free",
    monthlyLimit: 1000,
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
    monthlyLimit: 8000,
    projectLimit: 3,
    apiKeyLimit: 3,
    logRetentionDays: 30,
    priceUsd: 19,
    overageEnabled: true,
    overagePriceCentsPerThousand: 250,
  },
  plus: {
    planId: "plus",
    name: "Plus",
    monthlyLimit: 16000,
    projectLimit: 5,
    apiKeyLimit: 5,
    logRetentionDays: 60,
    priceUsd: 39,
    overageEnabled: true,
    overagePriceCentsPerThousand: 240,
  },
  growth: {
    planId: "growth",
    name: "Growth",
    monthlyLimit: 38000,
    projectLimit: 10,
    apiKeyLimit: 10,
    logRetentionDays: 90,
    priceUsd: 89,
    overageEnabled: true,
    overagePriceCentsPerThousand: 225,
  },
  scale: {
    planId: "scale",
    name: "Scale",
    monthlyLimit: 110000,
    projectLimit: 50,
    apiKeyLimit: 50,
    logRetentionDays: 180,
    priceUsd: 249,
    overageEnabled: true,
    overagePriceCentsPerThousand: 200,
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
    throw new HttpError(400, "planId must be one of: free, starter, plus, growth, scale");
  }

  return value;
}
