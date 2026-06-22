import sharp from "sharp";
import type { BoundingBox, FaceDetail, TextDetection } from "@aws-sdk/client-rekognition";

import type { RedactionFace, RedactionRegion, RedactionRegionType } from "../types/redaction.types.js";
import type { RedactionSettings, RedactionTextCategory } from "../types/project.types.js";

const FACE_PADDING_RATIO = 0.12;
const TEXT_PADDING_RATIO = 0.18;
const FACE_BLUR_SIGMA = 28;
const TEXT_BLUR_SIGMA = 22;
const LICENSE_PLATE_MIN_CONFIDENCE = 60;

// Common license-plate shapes (after stripping separators/spaces). Plates vary
// a lot by country, so we accept several letter/digit arrangements.
const LICENSE_PLATE_PATTERNS = [
  /^[A-Z]{1,3}\d{2,4}[A-Z]{0,3}$/, // GR3004D, ABC1234, AB12, A123BC
  /^\d{1,4}[A-Z]{1,3}\d{0,4}$/, // 3004GR, 12AB345
  /^[A-Z]\d{3}[A-Z]{3}$/, // A123BCD (EU style)
  /^\d{3}[A-Z]{3}$/, // 123ABC
  /^[A-Z]{3}\d{3,4}$/, // ABC123 / ABC1234
];

// Keyword categories: the matched token text itself is the sensitive content.
const VALUE_CATEGORY_TERMS: Partial<Record<RedactionTextCategory, string[]>> = {
  sexual: ["sex", "sexual", "porn", "porno", "nude", "nudes", "naked", "escort", "onlyfans", "xxx"],
  profanity: ["fuck", "shit", "bitch", "asshole", "damn", "puta", "puto", "pendejo", "mierda", "chingar"],
  credentials: [
    "password",
    "passwd",
    "passcode",
    "contraseña",
    "secret",
    "token",
    "api_key",
    "apikey",
    "api key",
    "authorization",
    "bearer",
    "private key",
    "client_secret",
    "access_token",
    "refresh_token",
  ],
};

// Pattern categories: a token matching one of these regexes IS the sensitive value.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?\d(?:[\d\s().-]{6,})\d/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const RFC_RE = /\b[A-Za-zÑñ&]{3,4}\d{6}[A-Za-z0-9]{2,3}\b/;
const CURP_RE = /\b[A-Za-z]{4}\d{6}[HMhm][A-Za-z]{5}[A-Za-z0-9]\d\b/;
const IBAN_RE = /\b[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}\b/;
const CLABE_RE = /\b\d{18}\b/;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;
const API_TOKEN_RE = /\b(?:sk|pk|rk|ghp|gho|xox[baprs])[_-][A-Za-z0-9_-]{8,}\b/;
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/;

// Dates in any common format (numeric separators + EN/ES month names).
const DATE_MONTHS =
  "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|abr|ago|set|oct|dic";
const DATE_DMY_RE = /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/; // 03/08/1989, 12.5.90
const DATE_ISO_RE = /\b\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}\b/; // 2024-01-02
const DATE_DAY_MONTH_RE = new RegExp(
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\.?\\s+(?:${DATE_MONTHS})\\.?(?:\\s*,?\\s*\\d{2,4})?\\b`,
  "i"
);
const DATE_MONTH_DAY_RE = new RegExp(
  `\\b(?:${DATE_MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\.?(?:\\s*,?\\s*\\d{2,4})?\\b`,
  "i"
);

function luhnValid(digits: string): boolean {
  if (digits.length < 12) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const ID_DOCUMENT_LABEL_TERMS = [
  "name",
  "nombre",
  "first",
  "last",
  "surname",
  "apellido",
  "apellidos",
  "birth",
  "nacimiento",
  "date",
  "fecha",
  "sex",
  "sexo",
  "gender",
  "genero",
  "address",
  "domicilio",
  "nationality",
  "nacionalidad",
  "license",
  "licencia",
  "passport",
  "pasaporte",
  "id",
  "curp",
  "rfc",
  "folio",
  "estado",
  "country",
  "pais",
  "document",
  "documento",
  "number",
  "numero",
  "número",
  "clave",
  "vigencia",
  "expiration",
  "expires",
  "expedicion",
  "expedición",
  "elector",
  "credencial",
  "nss",
  "ssn",
];

// Legal / medical record labels — the sensitive VALUE near these is redacted.
const MEDICAL_LABEL_TERMS = [
  "patient",
  "paciente",
  "patient id",
  "record",
  "record number",
  "expediente",
  "historia clinica",
  "historia clínica",
  "case",
  "caso",
  "case number",
  "mrn",
  "diagnosis",
  "diagnostico",
  "diagnóstico",
  "insurance",
  "poliza",
  "póliza",
  "nhs",
];

// Categories whose terms mark a LABEL; the value beside/below it is redacted.
const LABEL_CATEGORY_TERMS: Partial<Record<RedactionTextCategory, string[]>> = {
  id_document: ID_DOCUMENT_LABEL_TERMS,
  medical: MEDICAL_LABEL_TERMS,
};

interface TextRedactionContext {
  lineById: Map<number, TextDetection>;
  labelLines: TextDetection[];
  labelTerms: string[];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getRegionFromBox(
  box: BoundingBox | undefined,
  imageWidth: number,
  imageHeight: number,
  paddingRatio: number
) {
  if (!box || box.Left == null || box.Top == null || box.Width == null || box.Height == null) {
    return null;
  }

  const rawLeft = box.Left * imageWidth;
  const rawTop = box.Top * imageHeight;
  const rawWidth = box.Width * imageWidth;
  const rawHeight = box.Height * imageHeight;
  const padX = rawWidth * paddingRatio;
  const padY = rawHeight * paddingRatio;
  const left = Math.floor(clamp(rawLeft - padX, 0, imageWidth - 1));
  const top = Math.floor(clamp(rawTop - padY, 0, imageHeight - 1));
  const right = Math.ceil(clamp(rawLeft + rawWidth + padX, left + 1, imageWidth));
  const bottom = Math.ceil(clamp(rawTop + rawHeight + padY, top + 1, imageHeight));
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { left, top, width, height };
}

function getFaceRegion(face: FaceDetail, imageWidth: number, imageHeight: number) {
  return getRegionFromBox(face.BoundingBox, imageWidth, imageHeight, FACE_PADDING_RATIO);
}

function getTextRegion(text: TextDetection, imageWidth: number, imageHeight: number) {
  return getRegionFromBox(text.Geometry?.BoundingBox, imageWidth, imageHeight, TEXT_PADDING_RATIO);
}

function getRegionKey(
  type: RedactionRegionType,
  region: { left: number; top: number; width: number; height: number }
) {
  return [
    type,
    Math.round(region.left / 2),
    Math.round(region.top / 2),
    Math.round(region.width / 2),
    Math.round(region.height / 2),
  ].join(":");
}

function looksLikeLicensePlate(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (normalized.length < 4 || normalized.length > 10) {
    return false;
  }

  const letters = (normalized.match(/[A-Z]/g) ?? []).length;
  const digits = (normalized.match(/[0-9]/g) ?? []).length;

  // A plate always mixes letters and digits.
  if (letters < 1 || digits < 2) {
    return false;
  }

  // Explicit plate shapes catch real-world formats (e.g. GR-3004D) that the
  // generic letter/digit count alone would miss or mis-handle.
  if (LICENSE_PLATE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // Generic fallback: short alphanumeric with a clear letter+digit mix.
  return letters >= 2 && digits >= 2;
}

function normalizeTextForMatching(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_\s]/g, " ").replace(/\s+/g, " ").trim();
}

function containsTerm(value: string, term: string) {
  const normalizedValue = normalizeTextForMatching(value);
  const normalizedTerm = normalizeTextForMatching(term);

  if (!normalizedValue || !normalizedTerm) return false;

  if (normalizedTerm.includes(" ")) {
    return normalizedValue.includes(normalizedTerm);
  }

  return new RegExp(`(^|\\s)${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(
    normalizedValue
  );
}

function termHit(value: string, terms: string[]) {
  return terms.some((term) => containsTerm(value, term));
}

function matchesPiiValue(value: string) {
  return (
    EMAIL_RE.test(value) ||
    SSN_RE.test(value) ||
    CURP_RE.test(value) ||
    RFC_RE.test(value) ||
    PHONE_RE.test(value)
  );
}

function matchesFinancialValue(value: string) {
  if (IBAN_RE.test(value) || CLABE_RE.test(value)) return true;

  const cardMatch = value.match(CARD_RE);
  return Boolean(cardMatch && luhnValid(cardMatch[0].replace(/\D/g, "")));
}

function matchesCredentialValue(value: string) {
  return API_TOKEN_RE.test(value) || AWS_KEY_RE.test(value) || JWT_RE.test(value);
}

function matchesDateValue(value: string) {
  return (
    DATE_DMY_RE.test(value) ||
    DATE_ISO_RE.test(value) ||
    DATE_DAY_MONTH_RE.test(value) ||
    DATE_MONTH_DAY_RE.test(value)
  );
}

// True when the token's own text is sensitive under an enabled value category
// (keyword categories + pattern categories) or a configured custom word.
function matchesValueCategory(value: string, settings: RedactionSettings) {
  if (!value.trim()) return false;

  if (settings.customWords.some((word) => containsTerm(value, word))) {
    return true;
  }

  const categories = new Set(settings.textCategories);

  if (categories.has("sexual") && termHit(value, VALUE_CATEGORY_TERMS.sexual ?? [])) return true;
  if (categories.has("profanity") && termHit(value, VALUE_CATEGORY_TERMS.profanity ?? [])) return true;
  if (
    categories.has("credentials") &&
    (termHit(value, VALUE_CATEGORY_TERMS.credentials ?? []) || matchesCredentialValue(value))
  ) {
    return true;
  }
  if (categories.has("pii") && matchesPiiValue(value)) return true;
  if (categories.has("financial") && matchesFinancialValue(value)) return true;
  if (categories.has("dates") && matchesDateValue(value)) return true;

  return false;
}

function isIgnoredText(value: string, settings: RedactionSettings) {
  return settings.ignoredWords.some((word) => containsTerm(value, word));
}

// Label categories ("id_document", "medical") redact the VALUE near a label
// rather than the label itself. Detected at the WORD level.
function enabledLabelTerms(settings: RedactionSettings): string[] {
  const terms: string[] = [];

  for (const category of settings.textCategories) {
    const categoryTerms = LABEL_CATEGORY_TERMS[category as RedactionTextCategory];
    if (categoryTerms) terms.push(...categoryTerms);
  }

  return terms;
}

function isLabelCategoryEnabled(settings: RedactionSettings) {
  return settings.textCategories.some((category) => category === "id_document" || category === "medical");
}

function isLabelToken(value: string, context: TextRedactionContext) {
  return termHit(value, context.labelTerms);
}

function getTextBox(text: TextDetection) {
  const box = text.Geometry?.BoundingBox;

  if (!box || box.Left == null || box.Top == null || box.Width == null || box.Height == null) {
    return null;
  }

  return {
    left: box.Left,
    top: box.Top,
    right: box.Left + box.Width,
    bottom: box.Top + box.Height,
    width: box.Width,
    height: box.Height,
  };
}

function buildTextRedactionContext(
  textDetections: TextDetection[],
  settings: RedactionSettings
): TextRedactionContext {
  const lineById = new Map<number, TextDetection>();
  const labelTerms = enabledLabelTerms(settings);
  const labelLines: TextDetection[] = [];

  for (const text of textDetections) {
    if (text.Type !== "LINE" || text.Id == null) continue;

    lineById.set(text.Id, text);

    if (labelTerms.length > 0 && termHit(text.DetectedText ?? "", labelTerms)) {
      labelLines.push(text);
    }
  }

  return { lineById, labelLines, labelTerms };
}

function looksLikeSensitiveIdValue(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, " ");
  const compact = normalized.replace(/[^a-zA-Z0-9]/g, "");
  const letters = (compact.match(/[a-zA-Z]/g) ?? []).length;
  const digits = (compact.match(/[0-9]/g) ?? []).length;

  if (!normalized) return false;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return true;
  if (/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(normalized)) return true;
  if (/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/.test(normalized)) return true;
  if (digits >= 5) return true;
  if (letters >= 3 && digits >= 2 && compact.length >= 6) return true;
  if (/^[A-Z]{4}\d{6}[A-Z0-9]{6,8}$/i.test(compact)) return true;

  return false;
}

function looksLikeLabeledField(value: string) {
  // A real "label: value" field has a separator or carries data (digits).
  // Plain titles/headers ("Driver License", "Republic of Utopia") do not, so
  // their sibling words should not be treated as sensitive values.
  return /[:#=]/.test(value) || /\d/.test(value);
}

function hasSensitiveParentLine(text: TextDetection, context: TextRedactionContext) {
  if (text.ParentId == null) return false;

  const parentLine = context.lineById.get(text.ParentId);
  const parentText = parentLine?.DetectedText ?? "";

  return (
    isLabelToken(parentText, context) &&
    looksLikeLabeledField(parentText) &&
    !isLabelToken(text.DetectedText ?? "", context)
  );
}

function hasNearbySensitiveLabel(text: TextDetection, context: TextRedactionContext) {
  const textBox = getTextBox(text);

  if (!textBox) return false;

  return context.labelLines.some((line) => {
    const labelBox = getTextBox(line);

    if (!labelBox) return false;

    // Value sitting just below the label.
    const verticallyNearBelow = textBox.top >= labelBox.top && textBox.top - labelBox.bottom <= 0.075;
    const horizontallyRelated =
      textBox.left >= labelBox.left - 0.04 && textBox.left <= labelBox.right + 0.32;

    if (verticallyNearBelow && horizontallyRelated) return true;

    // Value on the same row, to the right of the label ("Name: John Doe").
    const labelMidY = labelBox.top + labelBox.height / 2;
    const textMidY = textBox.top + textBox.height / 2;
    const onSameRow = Math.abs(textMidY - labelMidY) <= labelBox.height * 0.6;
    const toTheRight = textBox.left >= labelBox.right - 0.02 && textBox.left - labelBox.right <= 0.3;

    return onSameRow && toTheRight;
  });
}

function isSensitiveLabeledValue(text: TextDetection, context: TextRedactionContext) {
  const value = text.DetectedText?.trim() ?? "";

  if (!value || isLabelToken(value, context)) return false;
  if (looksLikeSensitiveIdValue(value)) return true;
  if (hasSensitiveParentLine(text, context)) return true;
  if (hasNearbySensitiveLabel(text, context)) return true;

  return false;
}

// Unified decision for one detected text token. Plates are handled separately.
//  - Master textBlur blurs whole lines (unless a label category drives selective
//    word-level redaction instead).
//  - Value categories (pii, financial, credentials, sexual, profanity) + custom
//    words match the line's own text.
//  - Label categories (id_document, medical) redact only the sensitive VALUE near
//    a label, at the word level, never the label itself.
function shouldRedactAsText(
  text: TextDetection,
  settings: RedactionSettings,
  context: TextRedactionContext
) {
  // Text redaction is gated behind the master textBlur switch. With no
  // categories or custom words it blurs all visible text; with categories it
  // redacts only the configured data types.
  if (!settings.textBlur) return false;

  const detectedText = text.DetectedText?.trim() ?? "";

  if (!detectedText) return false;
  if (isIgnoredText(detectedText, settings)) return false;

  const selective =
    settings.textCategories.length > 0 || settings.customWords.length > 0;
  const labelMode = isLabelCategoryEnabled(settings);

  if (text.Type === "LINE") {
    if (!selective) return true; // blur all visible text
    if (matchesValueCategory(detectedText, settings)) return true;
    return false;
  }

  if (labelMode) {
    if (isLabelToken(detectedText, context)) return false;
    if (isSensitiveLabeledValue(text, context)) return true;
  }

  return false;
}

async function buildBlurredRegion(
  normalizedBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
  sigma: number
) {
  return sharp(normalizedBuffer)
    .extract(region)
    .blur(sigma)
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function buildBlackBoxRegion(region: { width: number; height: number }) {
  return sharp({
    create: {
      width: region.width,
      height: region.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

function buildRedactionRegion(
  normalizedBuffer: Buffer,
  region: { left: number; top: number; width: number; height: number },
  sigma: number,
  settings: RedactionSettings
) {
  if (settings.redactionStyle === "black_box") {
    return buildBlackBoxRegion(region);
  }

  return buildBlurredRegion(normalizedBuffer, region, sigma);
}

export async function redactImage(params: {
  imageBuffer: Buffer;
  faces: FaceDetail[];
  textDetections: TextDetection[];
  settings: RedactionSettings;
}) {
  const { imageBuffer, faces, textDetections, settings } = params;
  const image = sharp(imageBuffer, { failOn: "none" }).rotate();
  const metadata = await image.metadata();
  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error("Image dimensions could not be read");
  }

  const normalizedBuffer = await image.jpeg({ quality: 92 }).toBuffer();
  const composites = [];
  const redactedFaces: RedactionFace[] = [];
  const regions: RedactionRegion[] = [];
  const redactedTextRegionKeys = new Set<string>();
  const textContext = buildTextRedactionContext(textDetections, settings);

  for (const face of faces.filter((item) => (item.Confidence ?? 0) >= settings.minConfidence)) {
    const region = getFaceRegion(face, imageWidth, imageHeight);

    if (!region) {
      continue;
    }

    const input = await buildRedactionRegion(normalizedBuffer, region, FACE_BLUR_SIGMA, settings);

    composites.push({
      input,
      left: region.left,
      top: region.top,
    });

    redactedFaces.push({
      confidence: Math.round((face.Confidence ?? 0) * 100) / 100,
      boundingBox: {
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
      },
    });
    regions.push({
      type: "face",
      confidence: Math.round((face.Confidence ?? 0) * 100) / 100,
      boundingBox: {
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
      },
    });
  }

  for (const text of textDetections) {
    const detectedText = text.DetectedText?.trim() ?? "";
    const isPlate = looksLikeLicensePlate(detectedText);
    const confidence = text.Confidence ?? 0;
    const minConfidence =
      settings.licensePlateBlur && isPlate
        ? Math.min(settings.minConfidence, LICENSE_PLATE_MIN_CONFIDENCE)
        : settings.minConfidence;
    let type: RedactionRegionType | null = null;

    if (confidence < minConfidence) {
      continue;
    }

    if (settings.licensePlateBlur && isPlate) {
      type = "license_plate";
    } else if (shouldRedactAsText(text, settings, textContext)) {
      type = "text";
    }

    if (!type) {
      continue;
    }

    const region = getTextRegion(text, imageWidth, imageHeight);

    if (!region) {
      continue;
    }

    const regionKey = getRegionKey(type, region);

    if (redactedTextRegionKeys.has(regionKey)) {
      continue;
    }

    redactedTextRegionKeys.add(regionKey);

    const input = await buildRedactionRegion(normalizedBuffer, region, TEXT_BLUR_SIGMA, settings);

    composites.push({
      input,
      left: region.left,
      top: region.top,
    });

    regions.push({
      type,
      ...(detectedText ? { text: detectedText } : {}),
      confidence: Math.round(confidence * 100) / 100,
      boundingBox: {
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
      },
    });
  }

  if (composites.length === 0) {
    return {
      outputBuffer: normalizedBuffer,
      faces: redactedFaces,
      regions,
    };
  }

  const outputBuffer = await sharp(normalizedBuffer)
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    outputBuffer,
    faces: redactedFaces,
    regions,
  };
}
