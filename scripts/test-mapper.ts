import { mapRekognitionLabelsToModerationResponse } from "../src/mappers/moderation.mapper.js";

const labels = [
  {
    Name: "Explicit Nudity",
    Confidence: 98.5,
  },
];

const result =
  mapRekognitionLabelsToModerationResponse(labels as never);

console.log(JSON.stringify(result, null, 2));