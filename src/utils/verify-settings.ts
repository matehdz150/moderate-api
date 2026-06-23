import type { VerifySettings } from "../types/verify.types.js";

export const DEFAULT_VERIFY_SETTINGS: VerifySettings = {
  faceMatchThreshold: 90,
  faceMatchRejectBelow: 60,
  requireUnexpiredDocument: true,
};

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeVerifySettings(
  settings?: Partial<VerifySettings>
): VerifySettings {
  const faceMatchThreshold = clampPercent(
    settings?.faceMatchThreshold,
    DEFAULT_VERIFY_SETTINGS.faceMatchThreshold
  );
  const faceMatchRejectBelow = clampPercent(
    settings?.faceMatchRejectBelow,
    DEFAULT_VERIFY_SETTINGS.faceMatchRejectBelow
  );

  return {
    faceMatchThreshold,
    // The reject cutoff can never sit above the auto-approve threshold.
    faceMatchRejectBelow: Math.min(faceMatchRejectBelow, faceMatchThreshold),
    requireUnexpiredDocument:
      typeof settings?.requireUnexpiredDocument === "boolean"
        ? settings.requireUnexpiredDocument
        : DEFAULT_VERIFY_SETTINGS.requireUnexpiredDocument,
  };
}
