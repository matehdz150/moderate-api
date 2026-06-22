import type {
  RedactionSettings,
  RedactionStyle,
  RedactionTextCategory,
} from "../types/project.types.js";

const REDACTION_STYLES = new Set<RedactionStyle>(["blur", "black_box"]);
const TEXT_CATEGORIES = new Set<RedactionTextCategory>([
  "sexual",
  "profanity",
  "credentials",
  "id_document",
  "pii",
  "financial",
  "medical",
]);

export const DEFAULT_REDACTION_SETTINGS: RedactionSettings = {
  faceBlur: true,
  textBlur: false,
  licensePlateBlur: false,
  redactionStyle: "blur",
  textCategories: [],
  customWords: [],
  ignoredWords: [],
  minConfidence: 80,
};

function normalizeRedactionStyle(style: unknown): RedactionStyle {
  return typeof style === "string" && REDACTION_STYLES.has(style as RedactionStyle)
    ? (style as RedactionStyle)
    : DEFAULT_REDACTION_SETTINGS.redactionStyle;
}

function normalizeTextCategories(categories: unknown): RedactionTextCategory[] {
  if (!Array.isArray(categories)) return DEFAULT_REDACTION_SETTINGS.textCategories;

  return Array.from(
    new Set(
      categories.filter(
        (category): category is RedactionTextCategory =>
          typeof category === "string" && TEXT_CATEGORIES.has(category as RedactionTextCategory)
      )
    )
  );
}

function normalizeCustomWords(words: unknown): string[] {
  if (!Array.isArray(words)) return DEFAULT_REDACTION_SETTINGS.customWords;

  return Array.from(
    new Set(
      words
        .filter((word): word is string => typeof word === "string")
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length > 0)
        .slice(0, 50)
    )
  );
}

export function normalizeRedactionSettings(
  settings?: Partial<RedactionSettings>
): RedactionSettings {
  return {
    faceBlur: settings?.faceBlur ?? DEFAULT_REDACTION_SETTINGS.faceBlur,
    textBlur: settings?.textBlur ?? DEFAULT_REDACTION_SETTINGS.textBlur,
    licensePlateBlur:
      settings?.licensePlateBlur ?? DEFAULT_REDACTION_SETTINGS.licensePlateBlur,
    redactionStyle: normalizeRedactionStyle(settings?.redactionStyle),
    textCategories: normalizeTextCategories(settings?.textCategories),
    customWords: normalizeCustomWords(settings?.customWords),
    ignoredWords: normalizeCustomWords(settings?.ignoredWords),
    minConfidence: Math.max(
      0,
      Math.min(100, settings?.minConfidence ?? DEFAULT_REDACTION_SETTINGS.minConfidence)
    ),
  };
}
