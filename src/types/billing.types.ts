import type { PlanId } from "./account.types.js";

export type PaidPlanId = Exclude<PlanId, "free">;

export interface BillingEventRecord {
  stripeEventId: string;
  type: string;
  processedAt: string;
}

export interface CheckoutSessionResponse {
  url: string;
}

export interface PortalSessionResponse {
  url: string;
}
