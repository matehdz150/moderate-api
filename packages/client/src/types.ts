export type ModerationAction = "allow" | "review" | "reject";
export type BrandSafetyLevel = "safe" | "caution" | "unsafe";

export interface ModerationLabel {
  name: string;
  confidence: number;
  category?: string | null;
}

export interface BrandSafetyResult {
  safe: boolean;
  score: number;
  level: BrandSafetyLevel;
  reasons: string[];
}

export interface ComplianceResult {
  pack: string;
  passed: boolean;
  violations: string[];
}

export interface ModerationResponse {
  moderationId: string;
  safe: boolean;
  action: ModerationAction;
  riskScore?: number;
  category?: string | null;
  labels: ModerationLabel[];
  brandSafety?: BrandSafetyResult;
  compliance?: ComplianceResult | null;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  imageKey: string;
}

export interface ModerationLogRecord extends ModerationResponse {
  accountId: string;
  projectId: string;
  planId: string;
  imageKey: string;
  imageUrl?: string;
  policyMode?: string;
  createdAt: string;
}

export interface ModerationLogsResponse {
  logs: ModerationLogRecord[];
}

export type BinaryImageInput =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | Buffer;

export interface ModerateImageParams {
  file: BinaryImageInput;
  filename?: string;
  contentType?: string;
}

export interface ModerateImageKeyParams {
  imageKey: string;
}

export interface VisoraClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}
