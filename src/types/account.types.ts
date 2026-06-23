export type PlanId = "free" | "starter" | "plus" | "growth" | "scale";

export interface PlanConfig {
  planId: PlanId;
  name: string;
  monthlyLimit: number;
  projectLimit: number;
  apiKeyLimit: number;
  logRetentionDays: number;
  priceUsd: number;
  overageEnabled: boolean;
  overagePriceCentsPerThousand: number;
  /** Verifications included per month (separate from the request limit). */
  verifyIncluded: number;
  /** Price per verification beyond the included amount, in cents. 0 = no overage (hard cap). */
  verifyOverageCents: number;
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
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: string;
  stripeCurrentPeriodEnd?: string;
  stripePendingPlanId?: PlanId;
  stripePlanChangeEffectiveAt?: string;
  stripeScheduleId?: string;
  stripeCancelAtPeriodEnd?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AccountIdentityProvider = "cognito" | "google" | "github";

export interface AccountIdentityRecord {
  identityKey: string;
  provider: AccountIdentityProvider;
  providerUserId: string;
  accountId: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}
