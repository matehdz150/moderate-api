export type ModerationAction = "allow" | "review" | "reject";
export type BrandSafetyLevel = "safe" | "caution" | "unsafe";
export type ProjectType = "moderation" | "redaction" | "verify";
export type VerifyDecision = "verified" | "review" | "rejected";
export type RedactionStyle = "blur" | "black_box";
export type RedactionTextCategory =
  | "sexual"
  | "profanity"
  | "credentials"
  | "id_document"
  | "pii"
  | "financial"
  | "medical"
  | "dates";
export type RedactionRegionType = "face" | "text" | "license_plate";

export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ModerationDecisionExplanation {
  message: string;
  reason: "no_policy_match" | "category_action" | "risk_threshold" | "review_fallback";
  matchedCategory?: string;
  matchedLabel?: string;
  matchedConfidence?: number;
  configuredAction?: ModerationAction;
  threshold?: number;
}

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
  explanation?: ModerationDecisionExplanation;
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

export interface RedactionSettings {
  faceBlur: boolean;
  textBlur: boolean;
  licensePlateBlur: boolean;
  redactionStyle: RedactionStyle;
  textCategories: RedactionTextCategory[];
  customWords: string[];
  ignoredWords: string[];
  minConfidence: number;
}

export interface RedactionFace {
  confidence: number;
  boundingBox: BoundingBox;
}

export interface RedactionRegion {
  type: RedactionRegionType;
  text?: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface RedactionResponse {
  redactionId: string;
  imageKey: string;
  redactedImageKey: string;
  redactedImageUrl: string;
  facesBlurred: number;
  textBlurred: number;
  licensePlatesBlurred: number;
  faces: RedactionFace[];
  regions: RedactionRegion[];
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

export interface RedactImageParams {
  file: BinaryImageInput;
  filename?: string;
  contentType?: string;
}

export interface RedactImageKeyParams {
  imageKey: string;
}

export interface VerifySettings {
  /** Face similarity (0-100) at/above which the result is auto-approved. */
  faceMatchThreshold: number;
  /** Face similarity below which the result is rejected. */
  faceMatchRejectBelow: number;
  /** Reject when the document's expiration date has passed. */
  requireUnexpiredDocument: boolean;
}

export interface VerifyDocumentField {
  key: string;
  value: string;
  confidence: number;
}

export interface VerifyDocumentResult {
  detected: boolean;
  type?: string;
  fields: VerifyDocumentField[];
  expired: boolean;
  expirationDate?: string;
}

export interface VerifyFaceMatchResult {
  matched: boolean;
  /** Best similarity score (0-100) between the selfie and the document portrait. */
  similarity: number;
}

export interface VerifySelfieResult {
  quality: "pass" | "fail";
  faceCount: number;
  checks: {
    singleFace: boolean;
    eyesOpen: boolean;
    noSunglasses: boolean;
    sharp: boolean;
    wellLit: boolean;
  };
}

export interface VerifyResponse {
  verificationId: string;
  decision: VerifyDecision;
  /** 0-100 confidence in the decision. */
  confidence: number;
  reasons: string[];
  document: VerifyDocumentResult;
  faceMatch: VerifyFaceMatchResult;
  selfie: VerifySelfieResult;
  documentImageKey: string;
  selfieImageKey: string;
  createdAt: string;
}

export interface VerifyImageParams {
  /** Identity document image (ID, passport, license). */
  document: BinaryImageInput;
  /** A selfie of the person to match against the document. */
  selfie: BinaryImageInput;
  documentFilename?: string;
  selfieFilename?: string;
  contentType?: string;
}

export interface VerifyImageKeyParams {
  documentImageKey: string;
  selfieImageKey: string;
}

export interface VisoraClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}
