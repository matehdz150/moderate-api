import type {
  Label as AwsLabel,
  ModerationLabel as AwsModerationLabel,
} from "@aws-sdk/client-rekognition";

import {
  evaluateModerationPolicy,
  getDefaultModerationPolicy,
} from "../src/services/policy-engine.service.js";

function assertDecision(
  name: string,
  result: ReturnType<typeof evaluateModerationPolicy>,
  expected: { category: string; riskScore: number; safe: boolean; action: string }
) {
  if (result.category !== expected.category) {
    throw new Error(
      `${name}: expected category ${expected.category}, got ${String(result.category)}`
    );
  }

  if (result.riskScore !== expected.riskScore) {
    throw new Error(
      `${name}: expected riskScore ${expected.riskScore}, got ${result.riskScore}`
    );
  }

  if (result.safe !== expected.safe || result.action !== expected.action) {
    throw new Error(
      `${name}: expected safe=${expected.safe} action=${expected.action}, got safe=${result.safe} action=${result.action}`
    );
  }
}

const drugModerationLabels: AwsModerationLabel[] = [
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

const drugResult = evaluateModerationPolicy({
  moderationLabels: drugModerationLabels,
  policy: getDefaultModerationPolicy("proj_test"),
});

assertDecision("drug moderation labels", drugResult, {
  category: "drugs",
  riskScore: 97.58,
  safe: false,
  action: "review",
});

const weaponGeneralLabels: AwsLabel[] = [
  {
    Name: "Weapon",
    Confidence: 93.14027404785156,
    Aliases: [{ Name: "Weaponry" }],
    Categories: [{ Name: "Weapons and Military" }],
  },
  {
    Name: "Ammunition",
    Confidence: 91.7046127319336,
    Parents: [{ Name: "Weapon" }],
    Categories: [{ Name: "Weapons and Military" }],
  },
  {
    Name: "Bomb",
    Confidence: 57.54829788208008,
    Parents: [{ Name: "Ammunition" }, { Name: "Weapon" }],
    Categories: [{ Name: "Weapons and Military" }],
  },
];

const weaponResult = evaluateModerationPolicy({
  moderationLabels: [],
  generalLabels: weaponGeneralLabels,
  policy: getDefaultModerationPolicy("proj_test"),
});

assertDecision("weapon general labels", weaponResult, {
  category: "weapons",
  riskScore: 93.14,
  safe: false,
  action: "reject",
});

console.log(JSON.stringify({ drugResult, weaponResult }, null, 2));
