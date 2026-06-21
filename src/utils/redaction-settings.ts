import type { RedactionSettings } from "../types/project.types.js";

export const DEFAULT_REDACTION_SETTINGS: RedactionSettings = {
  faceBlur: true,
  textBlur: false,
  licensePlateBlur: false,
  minConfidence: 80,
};

export function normalizeRedactionSettings(
  settings?: Partial<RedactionSettings>
): RedactionSettings {
  return {
    faceBlur: settings?.faceBlur ?? DEFAULT_REDACTION_SETTINGS.faceBlur,
    textBlur: settings?.textBlur ?? DEFAULT_REDACTION_SETTINGS.textBlur,
    licensePlateBlur:
      settings?.licensePlateBlur ?? DEFAULT_REDACTION_SETTINGS.licensePlateBlur,
    minConfidence: Math.max(
      0,
      Math.min(100, settings?.minConfidence ?? DEFAULT_REDACTION_SETTINGS.minConfidence)
    ),
  };
}
