import sharp from "sharp";
import type { BoundingBox, FaceDetail, TextDetection } from "@aws-sdk/client-rekognition";

import type { RedactionFace, RedactionRegion, RedactionRegionType } from "../types/redaction.types.js";
import type { RedactionSettings } from "../types/project.types.js";

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

const TEXT_CATEGORY_TERMS: Record<string, string[]> = {
  sexual: [
    "sex",
    "sexual",
    "porn",
    "porno",
    "nude",
    "nudes",
    "naked",
    "escort",
    "onlyfans",
    "xxx",
  ],
  profanity: [
    "fuck",
    "shit",
    "bitch",
    "asshole",
    "damn",
    "puta",
    "puto",
    "pendejo",
    "mierda",
    "chingar",
  ],
  credentials: [
    "password",
    "passwd",
    "passcode",
    "secret",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "private key",
  ],
  id_document: [
    "name",
    "nombre",
    "first name",
    "last name",
    "apellido",
    "apellidos",
    "date of birth",
    "fecha de nacimiento",
    "birth",
    "nacimiento",
    "address",
    "domicilio",
    "nationality",
    "nacionalidad",
    "license",
    "licencia",
    "passport",
    "pasaporte",
    "curp",
    "rfc",
  ],
};

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

interface TextRedactionContext {
  lineById: Map<number, TextDetection>;
  idLabelLines: TextDetection[];
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

function matchesConfiguredText(value: string, settings: RedactionSettings) {
  if (!value.trim()) return false;

  if (settings.customWords.some((word) => containsTerm(value, word))) {
    return true;
  }

  return settings.textCategories.some((category) =>
    (TEXT_CATEGORY_TERMS[category] ?? []).some((term) => containsTerm(value, term))
  );
}

function isIgnoredText(value: string, settings: RedactionSettings) {
  return settings.ignoredWords.some((word) => containsTerm(value, word));
}

function isIdDocumentMode(settings: RedactionSettings) {
  return settings.textCategories.includes("id_document");
}

function isIdDocumentLabel(value: string) {
  return ID_DOCUMENT_LABEL_TERMS.some((term) => containsTerm(value, term));
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

function buildTextRedactionContext(textDetections: TextDetection[]): TextRedactionContext {
  const lineById = new Map<number, TextDetection>();
  const idLabelLines: TextDetection[] = [];

  for (const text of textDetections) {
    if (text.Type !== "LINE" || text.Id == null) continue;

    lineById.set(text.Id, text);

    if (isIdDocumentLabel(text.DetectedText ?? "")) {
      idLabelLines.push(text);
    }
  }

  return { lineById, idLabelLines };
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
    isIdDocumentLabel(parentText) &&
    looksLikeLabeledField(parentText) &&
    !isIdDocumentLabel(text.DetectedText ?? "")
  );
}

function hasNearbySensitiveLabel(text: TextDetection, context: TextRedactionContext) {
  const textBox = getTextBox(text);

  if (!textBox) return false;

  return context.idLabelLines.some((line) => {
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

function isSensitiveIdDocumentValue(text: TextDetection, context: TextRedactionContext) {
  const value = text.DetectedText?.trim() ?? "";

  if (!value || isIdDocumentLabel(value)) return false;
  if (looksLikeSensitiveIdValue(value)) return true;
  if (hasSensitiveParentLine(text, context)) return true;
  if (hasNearbySensitiveLabel(text, context)) return true;

  return false;
}

function shouldUseWordLevelTextRedaction(settings: RedactionSettings) {
  return settings.textBlur && (isIdDocumentMode(settings) || settings.ignoredWords.length > 0);
}

function shouldSkipTextDetection(
  text: TextDetection,
  settings: RedactionSettings,
  context: TextRedactionContext
) {
  const detectedText = text.DetectedText?.trim() ?? "";

  if (!detectedText) return true;

  if (shouldUseWordLevelTextRedaction(settings) && text.Type === "LINE") {
    return true;
  }

  if (settings.textBlur && text.Type === "WORD" && !shouldUseWordLevelTextRedaction(settings)) {
    return true;
  }

  if (isIgnoredText(detectedText, settings)) {
    return true;
  }

  if (isIdDocumentMode(settings) && text.Type === "WORD" && isIdDocumentLabel(detectedText)) {
    return true;
  }

  if (isIdDocumentMode(settings) && text.Type === "WORD") {
    return !isSensitiveIdDocumentValue(text, context);
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
  const textContext = buildTextRedactionContext(textDetections);

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

    if (!isPlate && shouldSkipTextDetection(text, settings, textContext)) {
      continue;
    }

    if (settings.licensePlateBlur && isPlate) {
      type = "license_plate";
    } else if (settings.textBlur) {
      type = "text";
    } else if (settings.textBlur && matchesConfiguredText(detectedText, settings)) {
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
