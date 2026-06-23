import { compareFaces, detectFacesDetailed } from "./rekognition.service.js";
import { analyzeIdDocument } from "./textract.service.js";
import type {
  VerifyDecision,
  VerifyDocumentResult,
  VerifyFaceMatchResult,
  VerifySelfieResult,
  VerifySettings,
} from "../types/verify.types.js";
import { DEFAULT_VERIFY_SETTINGS } from "../utils/verify-settings.js";

export { DEFAULT_VERIFY_SETTINGS };

const EXPIRATION_KEYS = ["EXPIRATION_DATE", "DATE_OF_EXPIRY"];
const TYPE_KEYS = ["ID_TYPE", "DOCUMENT_TYPE", "CLASS"];

export interface VerifyAnalysis {
  decision: VerifyDecision;
  confidence: number;
  reasons: string[];
  document: VerifyDocumentResult;
  faceMatch: VerifyFaceMatchResult;
  selfie: VerifySelfieResult;
}

function findField(
  fields: { key: string; value: string }[],
  candidates: string[]
): string | undefined {
  for (const candidate of candidates) {
    const match = fields.find((field) => field.key === candidate);
    if (match) return match.value;
  }
  return undefined;
}

function isExpired(rawDate: string | undefined): { expired: boolean; iso?: string } {
  if (!rawDate) return { expired: false };

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return { expired: false };

  return { expired: parsed.getTime() < Date.now(), iso: parsed.toISOString().slice(0, 10) };
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Runs the full Verify pipeline: document authenticity (Textract AnalyzeID),
 *  selfie<->document face match (Rekognition CompareFaces) and selfie quality /
 *  anti-spoof checks (Rekognition DetectFaces). */
export async function verifyIdentity(params: {
  bucketName: string;
  documentImageKey: string;
  selfieImageKey: string;
  settings?: Partial<VerifySettings>;
}): Promise<VerifyAnalysis> {
  const settings: VerifySettings = { ...DEFAULT_VERIFY_SETTINGS, ...params.settings };

  const [analyzeId, faceCompare, selfieFaces] = await Promise.all([
    analyzeIdDocument(params.bucketName, params.documentImageKey),
    compareFaces(
      params.bucketName,
      params.selfieImageKey,
      params.bucketName,
      params.documentImageKey
    ).catch(() => ({ bestSimilarity: 0, sourceFaceFound: false, targetFaceFound: false })),
    detectFacesDetailed(params.bucketName, params.selfieImageKey).catch(() => []),
  ]);

  // ---- Document ----
  const expirationRaw = findField(analyzeId.fields, EXPIRATION_KEYS);
  const { expired, iso: expirationDate } = isExpired(expirationRaw);
  const document: VerifyDocumentResult = {
    detected: analyzeId.detected,
    type: findField(analyzeId.fields, TYPE_KEYS),
    fields: analyzeId.fields,
    expired,
    expirationDate,
  };

  // ---- Face match ----
  const faceMatch: VerifyFaceMatchResult = {
    similarity: clamp(faceCompare.bestSimilarity),
    matched:
      faceCompare.sourceFaceFound &&
      faceCompare.targetFaceFound &&
      faceCompare.bestSimilarity >= settings.faceMatchThreshold,
  };

  // ---- Selfie quality / anti-spoof ----
  const primary = selfieFaces[0];
  const checks = {
    singleFace: selfieFaces.length === 1,
    eyesOpen: Boolean(primary?.EyesOpen?.Value),
    noSunglasses: !(primary?.Sunglasses?.Value ?? false),
    sharp: (primary?.Quality?.Sharpness ?? 0) >= 30,
    wellLit:
      (primary?.Quality?.Brightness ?? 0) >= 20 &&
      (primary?.Quality?.Brightness ?? 0) <= 95,
  };
  const qualityPass =
    selfieFaces.length === 1 && checks.noSunglasses && checks.sharp && checks.wellLit;
  const selfie: VerifySelfieResult = {
    quality: qualityPass ? "pass" : "fail",
    faceCount: selfieFaces.length,
    checks,
  };

  // ---- Decision ----
  const reasons: string[] = [];
  let decision: VerifyDecision = "verified";

  if (!document.detected) {
    reasons.push("No identity document was detected in the document image.");
    decision = "rejected";
  }
  if (!faceCompare.sourceFaceFound) {
    reasons.push("No face was detected in the selfie.");
    decision = "rejected";
  }
  if (!faceCompare.targetFaceFound) {
    reasons.push("No face was detected on the identity document.");
    decision = "rejected";
  }
  if (
    faceCompare.sourceFaceFound &&
    faceCompare.targetFaceFound &&
    faceMatch.similarity < settings.faceMatchRejectBelow
  ) {
    reasons.push(
      `Selfie does not match the document portrait (similarity ${faceMatch.similarity}%).`
    );
    decision = "rejected";
  }
  if (settings.requireUnexpiredDocument && document.expired) {
    reasons.push("The identity document is expired.");
    decision = "rejected";
  }

  if (decision !== "rejected") {
    if (faceMatch.matched && selfie.quality === "pass") {
      decision = "verified";
    } else {
      decision = "review";
      if (!faceMatch.matched) {
        reasons.push(
          `Face similarity ${faceMatch.similarity}% is below the auto-approve threshold of ${settings.faceMatchThreshold}%.`
        );
      }
      if (selfie.quality === "fail") {
        if (selfieFaces.length !== 1) reasons.push("Selfie should contain exactly one face.");
        if (!checks.noSunglasses) reasons.push("Remove sunglasses for the selfie.");
        if (!checks.sharp) reasons.push("Selfie is too blurry.");
        if (!checks.wellLit) reasons.push("Selfie lighting is too dark or too bright.");
      }
    }
  }

  // ---- Confidence in the decision ----
  let confidence: number;
  if (decision === "verified") {
    confidence = faceMatch.similarity;
  } else if (decision === "rejected") {
    confidence =
      !document.detected || !faceCompare.sourceFaceFound || !faceCompare.targetFaceFound
        ? 95
        : clamp(100 - faceMatch.similarity);
  } else {
    confidence = 50;
  }

  return { decision, confidence, reasons, document, faceMatch, selfie };
}
