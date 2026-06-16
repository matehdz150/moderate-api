import type { ModerationLabel as AwsModerationLabel } from "@aws-sdk/client-rekognition";
import { ulid } from "ulid";
import type { ModerationResponse } from "../types/moderation.types.js";

export function mapRekognitionLabelsToModerationResponse(
  awsLabels: AwsModerationLabel[]
): ModerationResponse {
  const labels = awsLabels.map((label) => ({
    name: label.Name ?? "Unknown",
    confidence: Number((label.Confidence ?? 0).toFixed(2)),
  }));

  const safe = labels.length === 0;

  return {
    moderationId: `mod_${ulid()}`,
    safe,
    action: safe ? "allow" : "reject",
    labels,
  };
}