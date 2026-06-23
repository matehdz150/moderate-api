export type VerifyDecision = "verified" | "review" | "rejected";

/** Per-project thresholds. Optional — sensible defaults are applied in the
 *  verify service when a project has no overrides yet. */
export interface VerifySettings {
  /** Face similarity (0-100) at/above which the match is treated as a pass. */
  faceMatchThreshold: number;
  /** Face similarity below which the request is rejected outright. */
  faceMatchRejectBelow: number;
  /** Require the document to carry an expiration date that is still valid. */
  requireUnexpiredDocument: boolean;
}

export interface VerifyImageRequest {
  documentImageKey: string;
  selfieImageKey: string;
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
  /** 0-100 overall confidence in the decision. */
  confidence: number;
  reasons: string[];
  document: VerifyDocumentResult;
  faceMatch: VerifyFaceMatchResult;
  selfie: VerifySelfieResult;
  documentImageKey: string;
  selfieImageKey: string;
  createdAt: string;
}

/** Persisted to DynamoDB. Intentionally privacy-preserving: we keep the
 *  decision, scores and document type, but NOT the extracted PII field values. */
export interface VerifyLogRecord {
  verificationId: string;
  accountId: string;
  projectId: string;
  planId: string;
  decision: VerifyDecision;
  confidence: number;
  faceMatchSimilarity: number;
  documentType?: string;
  documentDetected: boolean;
  documentExpired: boolean;
  selfieQuality: "pass" | "fail";
  reasons: string[];
  documentImageKey: string;
  selfieImageKey: string;
  createdAt: string;
}

export interface VerifyLogEntry extends VerifyLogRecord {
  documentImageUrl?: string;
  selfieImageUrl?: string;
}
