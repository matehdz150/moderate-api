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
  createdAt: string;
}
