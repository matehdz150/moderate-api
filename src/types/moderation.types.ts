import type { BrandSafetyResult } from "./brand-safety.types.js";
import type { ComplianceResult } from "./compliance.types.js";
import type {
  ModerationCategory,
  ModerationDecisionAction,
} from "./policy.types.js";

export interface ModerateImageRequest {
  imageKey: string;
}

export interface ModerationLabel {
  name: string;
  confidence: number;
  category?: ModerationCategory;
}

export type ModerationAction = ModerationDecisionAction;

export interface ModerationResponse {
  moderationId: string;
  safe: boolean;
  action: ModerationAction;
  riskScore?: number;
  category?: ModerationCategory | null;
  labels: ModerationLabel[];
  brandSafety?: BrandSafetyResult;
  compliance?: ComplianceResult | null;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  imageKey: string;
}

export interface ModerationLogRecord {
  moderationId: string;
  accountId: string;
  projectId: string;
  planId: string;
  imageKey: string;
  safe: boolean;
  action: ModerationAction;
  riskScore?: number;
  category?: ModerationCategory | null;
  policyMode?: string;
  labels: ModerationLabel[];
  brandSafety?: BrandSafetyResult;
  compliance?: ComplianceResult | null;
  createdAt: string;
}
