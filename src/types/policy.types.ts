import type { ModerationLabel } from "./moderation.types.js";
import type { CompliancePack } from "./compliance.types.js";

export type ModerationMode = "strict" | "balanced" | "relaxed";

export type ModerationCategory =
  | "nudity"
  | "suggestive"
  | "violence"
  | "drugs"
  | "weapons"
  | "hate_symbols"
  | "gambling"
  | "alcohol";

export type ModerationDecisionAction = "allow" | "review" | "reject";

export interface ModerationPolicy {
  projectId: string;
  mode: ModerationMode;
  compliancePack?: CompliancePack;
  minConfidence: number;
  blockedCategories: ModerationCategory[];
  categoryActions: Partial<
    Record<ModerationCategory, ModerationDecisionAction>
  >;
  reviewThreshold: number;
  rejectThreshold: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModerationDecision {
  safe: boolean;
  action: ModerationDecisionAction;
  riskScore: number;
  category: ModerationCategory | null;
  labels: ModerationLabel[];
}
