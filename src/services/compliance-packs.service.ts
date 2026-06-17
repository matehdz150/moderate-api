import type {
  Label as AwsLabel,
  ModerationLabel as AwsModerationLabel,
} from "@aws-sdk/client-rekognition";

import type {
  CompliancePack,
  ComplianceResult,
} from "../types/compliance.types.js";
import type {
  ModerationCategory,
  ModerationPolicy,
} from "../types/policy.types.js";
import { evaluateModerationPolicy } from "./policy-engine.service.js";

interface EvaluateCompliancePackParams {
  packName: CompliancePack;
  moderationLabels: AwsModerationLabel[];
  generalLabels?: AwsLabel[];
}

const COMPLIANCE_PACKS: Record<CompliancePack, ModerationPolicy> = {
  marketplace: {
    projectId: "compliance_pack_marketplace",
    mode: "balanced",
    minConfidence: 70,
    blockedCategories: [
      "nudity",
      "violence",
      "weapons",
      "drugs",
      "hate_symbols",
    ],
    categoryActions: {
      nudity: "reject",
      violence: "review",
      weapons: "reject",
      drugs: "reject",
      hate_symbols: "reject",
      suggestive: "review",
    },
    reviewThreshold: 50,
    rejectThreshold: 80,
  },
  kids: {
    projectId: "compliance_pack_kids",
    mode: "strict",
    minConfidence: 60,
    blockedCategories: [
      "nudity",
      "suggestive",
      "violence",
      "weapons",
      "drugs",
      "hate_symbols",
      "alcohol",
      "gambling",
    ],
    categoryActions: {
      nudity: "reject",
      suggestive: "reject",
      violence: "reject",
      weapons: "reject",
      drugs: "reject",
      hate_symbols: "reject",
      alcohol: "review",
      gambling: "review",
    },
    reviewThreshold: 40,
    rejectThreshold: 70,
  },
  education: {
    projectId: "compliance_pack_education",
    mode: "strict",
    minConfidence: 65,
    blockedCategories: [
      "nudity",
      "suggestive",
      "violence",
      "weapons",
      "drugs",
      "hate_symbols",
      "gambling",
    ],
    categoryActions: {
      nudity: "reject",
      suggestive: "reject",
      violence: "review",
      weapons: "reject",
      drugs: "reject",
      hate_symbols: "reject",
      gambling: "review",
    },
    reviewThreshold: 45,
    rejectThreshold: 75,
  },
  social: {
    projectId: "compliance_pack_social",
    mode: "balanced",
    minConfidence: 70,
    blockedCategories: [
      "nudity",
      "violence",
      "weapons",
      "drugs",
      "hate_symbols",
    ],
    categoryActions: {
      nudity: "reject",
      suggestive: "review",
      violence: "review",
      weapons: "review",
      drugs: "review",
      hate_symbols: "reject",
    },
    reviewThreshold: 50,
    rejectThreshold: 80,
  },
  dating: {
    projectId: "compliance_pack_dating",
    mode: "relaxed",
    minConfidence: 70,
    blockedCategories: [
      "nudity",
      "violence",
      "weapons",
      "drugs",
      "hate_symbols",
    ],
    categoryActions: {
      nudity: "review",
      suggestive: "allow",
      violence: "reject",
      weapons: "reject",
      drugs: "reject",
      hate_symbols: "reject",
    },
    reviewThreshold: 50,
    rejectThreshold: 85,
  },
  ads: {
    projectId: "compliance_pack_ads",
    mode: "strict",
    minConfidence: 75,
    blockedCategories: [
      "nudity",
      "suggestive",
      "violence",
      "weapons",
      "drugs",
      "hate_symbols",
      "alcohol",
      "gambling",
    ],
    categoryActions: {
      nudity: "reject",
      suggestive: "review",
      violence: "reject",
      weapons: "reject",
      drugs: "reject",
      hate_symbols: "reject",
      alcohol: "review",
      gambling: "review",
    },
    reviewThreshold: 50,
    rejectThreshold: 80,
  },
};

export function getCompliancePack(packName: CompliancePack): ModerationPolicy {
  return COMPLIANCE_PACKS[packName];
}

export function evaluateCompliancePack({
  packName,
  moderationLabels,
  generalLabels,
}: EvaluateCompliancePackParams): ComplianceResult {
  const decision = evaluateModerationPolicy({
    moderationLabels,
    generalLabels,
    policy: getCompliancePack(packName),
  });
  const violations = Array.from(
    new Set(
      decision.labels
        .map((label) => label.category)
        .filter((category): category is ModerationCategory =>
          Boolean(category)
        )
    )
  );

  return {
    pack: packName,
    passed: decision.action === "allow",
    violations,
  };
}
