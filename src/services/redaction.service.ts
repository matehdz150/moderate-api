import sharp from "sharp";
import type { BoundingBox, FaceDetail, TextDetection } from "@aws-sdk/client-rekognition";

import type { RedactionFace, RedactionRegion, RedactionRegionType } from "../types/redaction.types.js";
import type { RedactionSettings } from "../types/project.types.js";

const FACE_PADDING_RATIO = 0.12;
const TEXT_PADDING_RATIO = 0.18;
const FACE_BLUR_SIGMA = 28;
const TEXT_BLUR_SIGMA = 22;

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

function looksLikeLicensePlate(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (normalized.length < 5 || normalized.length > 10) {
    return false;
  }

  const letters = (normalized.match(/[A-Z]/g) ?? []).length;
  const digits = (normalized.match(/[0-9]/g) ?? []).length;

  return letters >= 2 && digits >= 2;
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

  for (const face of faces.filter((item) => (item.Confidence ?? 0) >= settings.minConfidence)) {
    const region = getFaceRegion(face, imageWidth, imageHeight);

    if (!region) {
      continue;
    }

    const input = await buildBlurredRegion(normalizedBuffer, region, FACE_BLUR_SIGMA);

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

  for (const text of textDetections.filter((item) => (item.Confidence ?? 0) >= settings.minConfidence)) {
    const detectedText = text.DetectedText?.trim() ?? "";
    const isPlate = looksLikeLicensePlate(detectedText);
    let type: RedactionRegionType | null = null;

    if (settings.licensePlateBlur && isPlate) {
      type = "license_plate";
    } else if (settings.textBlur) {
      type = "text";
    }

    if (!type) {
      continue;
    }

    const region = getTextRegion(text, imageWidth, imageHeight);

    if (!region) {
      continue;
    }

    const input = await buildBlurredRegion(normalizedBuffer, region, TEXT_BLUR_SIGMA);

    composites.push({
      input,
      left: region.left,
      top: region.top,
    });

    regions.push({
      type,
      ...(detectedText ? { text: detectedText } : {}),
      confidence: Math.round((text.Confidence ?? 0) * 100) / 100,
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
