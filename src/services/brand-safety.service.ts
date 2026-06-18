import type { BrandSafetyResult } from "../types/brand-safety.types.js";
import type { ModerationLabel } from "../types/moderation.types.js";
import type {
  ModerationCategory,
  ModerationDecisionAction,
  ModerationPolicy,
} from "../types/policy.types.js";

interface EvaluateBrandSafetyParams {
  action: ModerationDecisionAction;
  riskScore: number;
  labels: ModerationLabel[];
  policy: ModerationPolicy;
}

const UNSAFE_CATEGORIES = new Set<ModerationCategory>([
  "weapons",
  "violence",
  "drugs",
  "hate_symbols",
  "nudity",
]);

const CAUTION_CATEGORIES = new Set<ModerationCategory>([
  "alcohol",
  "gambling",
  "suggestive",
]);

function uniqueCategories(labels: ModerationLabel[]) {
  return Array.from(
    new Set(
      labels
        .map((label) => label.category)
        .filter((category): category is ModerationCategory =>
          Boolean(category)
        )
    )
  );
}

function getLevel(params: EvaluateBrandSafetyParams) {
  if (params.action === "reject") {
    return "unsafe";
  }

  if (params.action === "review") {
    return "caution";
  }

  if (params.action === "allow") {
    return "safe";
  }

  const categories = uniqueCategories(params.labels);
  const hasUnsafeCategory = categories.some((category) =>
    UNSAFE_CATEGORIES.has(category)
  );
  const hasCautionCategory = categories.some((category) =>
    CAUTION_CATEGORIES.has(category)
  );

  if (hasUnsafeCategory) {
    const onlyReviewUnsafeCategories = categories
      .filter((category) => UNSAFE_CATEGORIES.has(category))
      .every(
        (category) => params.policy.categoryActions[category] === "review"
      );

    return onlyReviewUnsafeCategories ? "caution" : "unsafe";
  }

  if (hasCautionCategory) {
    return "caution";
  }

  return "safe";
}

export function evaluateBrandSafety(
  params: EvaluateBrandSafetyParams
): BrandSafetyResult {
  const reasons = uniqueCategories(params.labels);
  const level = getLevel(params);

  return {
    safe: level === "safe",
    score: params.riskScore,
    level,
    reasons,
  };
}
