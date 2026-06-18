import type {
  Label as AwsLabel,
  ModerationLabel as AwsModerationLabel,
} from "@aws-sdk/client-rekognition";

import type {
  ModerationCategory,
  ModerationDecision,
  ModerationDecisionAction,
  ModerationMode,
  ModerationPolicy,
} from "../types/policy.types.js";

interface EvaluateModerationPolicyParams {
  moderationLabels: AwsModerationLabel[];
  generalLabels?: AwsLabel[];
  policy: ModerationPolicy;
}

interface NormalizedLabel {
  name: string;
  confidence: number;
  category: ModerationCategory;
}

const DEFAULT_BLOCKED_CATEGORIES: ModerationCategory[] = [
  "nudity",
  "suggestive",
  "violence",
  "drugs",
  "weapons",
  "hate_symbols",
];

const MODE_CATEGORY_ACTIONS: Record<
  ModerationMode,
  Record<ModerationCategory, ModerationDecisionAction>
> = {
  strict: {
    suggestive: "reject",
    violence: "review",
    nudity: "reject",
    drugs: "reject",
    weapons: "reject",
    hate_symbols: "reject",
    alcohol: "review",
    gambling: "review",
  },
  balanced: {
    suggestive: "review",
    violence: "review",
    nudity: "reject",
    drugs: "review",
    weapons: "reject",
    hate_symbols: "reject",
    alcohol: "allow",
    gambling: "review",
  },
  relaxed: {
    suggestive: "allow",
    violence: "review",
    nudity: "reject",
    drugs: "review",
    weapons: "review",
    hate_symbols: "reject",
    alcohol: "allow",
    gambling: "allow",
  },
};

export function getDefaultModerationPolicy(
  projectId: string
): ModerationPolicy {
  return {
    projectId,
    mode: "balanced",
    minConfidence: 70,
    blockedCategories: DEFAULT_BLOCKED_CATEGORIES,
    categoryActions: {
      nudity: "reject",
      suggestive: "review",
      violence: "review",
      drugs: "review",
      weapons: "reject",
      hate_symbols: "reject",
    },
    reviewThreshold: 50,
    rejectThreshold: 80,
  };
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_ALIASES: Record<ModerationCategory, string[]> = {
  nudity: [
    "explicit nudity",
    "nudity",
    "graphic male nudity",
    "graphic female nudity",
    "sexual activity",
    "exposed body parts",
  ],
  suggestive: [
    "suggestive",
    "female swimwear or underwear",
    "male swimwear or underwear",
    "partial nudity",
    "revealing clothes",
  ],
  violence: [
    "violence",
    "graphic violence",
    "weapon violence",
    "physical violence",
    "blood and gore",
    "gore",
  ],
  weapons: [
    "weapon",
    "weapons",
    "weaponry",
    "weapons and military",
    "military",
    "gun",
    "guns",
    "firearm",
    "firearms",
    "rifle",
    "pistol",
    "knife",
    "knives",
    "ammunition",
    "bomb",
    "explosives",
  ],
  drugs: [
    "drug",
    "drugs",
    "drugs and tobacco",
    "drug products",
    "drug paraphernalia",
    "pill",
    "pills",
    "tablet",
    "tablets",
    "capsule",
    "capsules",
    "syringe",
    "syringes",
    "narcotic",
    "narcotics",
    "cannabis",
    "marijuana",
    "weed",
    "tobacco",
    "smoking",
  ],
  hate_symbols: [
    "hate symbols",
    "hate symbol",
    "nazi symbol",
    "extremist",
    "extremist symbol",
    "white supremacy",
  ],
  gambling: [
    "gambling",
    "casino",
    "slot machine",
    "betting",
    "lottery",
  ],
  alcohol: [
    "alcohol",
    "alcoholic beverage",
    "beer",
    "wine",
    "liquor",
    "spirits",
  ],
};

const CATEGORY_MATCHERS = Object.entries(CATEGORY_ALIASES).flatMap(
  ([category, aliases]) =>
    aliases.map((alias) => ({
      category: category as ModerationCategory,
      alias: normalizeText(alias),
    }))
);

function mapLabelNameToCategory(
  labelName: string
): ModerationCategory | null {
  const normalizedName = normalizeText(labelName);
  const match = CATEGORY_MATCHERS.find(
    ({ alias }) =>
      normalizedName === alias ||
      normalizedName.startsWith(`${alias} `) ||
      normalizedName.endsWith(` ${alias}`) ||
      normalizedName.includes(` ${alias} `)
  );

  return match?.category ?? null;
}

function mapModerationLabel(
  label: AwsModerationLabel,
  minConfidence: number
): NormalizedLabel | null {
  const confidence = Number((label.Confidence ?? 0).toFixed(2));

  if (confidence < minConfidence) {
    return null;
  }

  const category =
    (label.Name ? mapLabelNameToCategory(label.Name) : null) ??
    (label.ParentName ? mapLabelNameToCategory(label.ParentName) : null);

  if (!category) {
    return null;
  }

  return {
    name: label.Name ?? "Unknown",
    confidence,
    category,
  };
}

function getGeneralLabelCategory(label: AwsLabel): ModerationCategory | null {
  const candidates = [
    label.Name,
    ...(label.Parents ?? []).map((parent) => parent.Name),
    ...(label.Aliases ?? []).map((alias) => alias.Name),
    ...(label.Categories ?? []).map((category) => category.Name),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const category = mapLabelNameToCategory(candidate);

    if (category) {
      return category;
    }
  }

  return null;
}

function mapGeneralLabel(
  label: AwsLabel,
  minConfidence: number
): NormalizedLabel | null {
  const confidence = Number((label.Confidence ?? 0).toFixed(2));

  if (confidence < minConfidence) {
    return null;
  }

  const category = getGeneralLabelCategory(label);

  if (!category) {
    return null;
  }

  return {
    name: label.Name ?? "Unknown",
    confidence,
    category,
  };
}

function getFinalActionFromThresholds(
  riskScore: number,
  policy: ModerationPolicy
): ModerationDecisionAction {
  if (riskScore >= policy.rejectThreshold) {
    return "reject";
  }

  if (riskScore >= policy.reviewThreshold) {
    return "review";
  }

  return "allow";
}

export function evaluateModerationPolicy({
  moderationLabels,
  generalLabels = [],
  policy,
}: EvaluateModerationPolicyParams): ModerationDecision {
  const categoryActions = {
    ...MODE_CATEGORY_ACTIONS[policy.mode],
    ...policy.categoryActions,
  };
  const blockedCategories = new Set(policy.blockedCategories);
  const labels = [
    ...moderationLabels
      .map((label) => mapModerationLabel(label, policy.minConfidence))
      .filter((label): label is NormalizedLabel => Boolean(label)),
    ...generalLabels
      .map((label) => mapGeneralLabel(label, policy.minConfidence))
      .filter((label): label is NormalizedLabel => Boolean(label)),
  ].filter((label) => blockedCategories.has(label.category));

  const riskScore = labels.reduce(
    (highestConfidence, label) =>
      Math.max(highestConfidence, label.confidence),
    0
  );
  const highestRiskLabel =
    labels.find((label) => label.confidence === riskScore) ?? null;

  const hasReject = labels.some(
    (label) => categoryActions[label.category] === "reject"
  );
  const hasReview = labels.some(
    (label) => categoryActions[label.category] === "review"
  );

  const action = hasReject
    ? "reject"
    : hasReview
      ? "review"
      : getFinalActionFromThresholds(riskScore, policy);

  return {
    safe: action === "allow",
    action,
    riskScore,
    category: highestRiskLabel?.category ?? null,
    labels,
  };
}
