import type { ModerationLabel as AwsModerationLabel } from "@aws-sdk/client-rekognition";

import {
  evaluateModerationPolicy,
  getDefaultModerationPolicy,
} from "../src/services/policy-engine.service.js";

const labels: AwsModerationLabel[] = [
  {
    Confidence: 97.58480072021484,
    Name: "Pills",
    ParentName: "Products",
    TaxonomyLevel: 3,
  },
  {
    Confidence: 97.58480072021484,
    Name: "Products",
    ParentName: "Drugs & Tobacco",
    TaxonomyLevel: 2,
  },
  {
    Confidence: 97.58480072021484,
    Name: "Drugs & Tobacco",
    ParentName: "",
    TaxonomyLevel: 1,
  },
];

const result = evaluateModerationPolicy({
  moderationLabels: labels,
  policy: getDefaultModerationPolicy("proj_test"),
});

if (result.category !== "drugs") {
  throw new Error(`Expected category drugs, got ${String(result.category)}`);
}

if (result.riskScore !== 97.58) {
  throw new Error(`Expected riskScore 97.58, got ${result.riskScore}`);
}

if (result.safe !== false || result.action !== "review") {
  throw new Error(
    `Expected safe=false action=review, got safe=${result.safe} action=${result.action}`
  );
}

console.log(JSON.stringify(result, null, 2));
