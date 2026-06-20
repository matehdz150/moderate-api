import type { BrandSafetyResult } from "./brand-safety.types.js";
import type { ComplianceResult } from "./compliance.types.js";
import type {
  ModerationCategory,
  ModerationDecisionAction,
  ModerationDecisionExplanation,
} from "./policy.types.js";
import type { ModerationLabel } from "./moderation.types.js";

export type ReviewStatus = "pending" | "approved" | "rejected" | "ignored";

export interface ReviewQueueRecord {
  reviewId: string;
  accountId: string;
  projectId: string;
  planId: string;
  moderationId: string;
  imageKey: string;
  status: ReviewStatus;
  riskScore?: number;
  category?: ModerationCategory | null;
  action: ModerationDecisionAction;
  labels: ModerationLabel[];
  explanation?: ModerationDecisionExplanation;
  brandSafety?: BrandSafetyResult;
  compliance?: ComplianceResult | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  decisionReason?: string;
}

export interface ReviewQueueItem extends ReviewQueueRecord {
  imageUrl?: string;
}
