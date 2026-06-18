import type { APIGatewayProxyEvent } from "aws-lambda";

import { getProjectById } from "../repositories/project.repository.js";
import { getPolicyByProjectId, savePolicy } from "../repositories/policy.repository.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type {
  ModerationCategory,
  ModerationDecisionAction,
  ModerationMode,
  ModerationPolicy,
  ReviewFallbackAction,
  ReviewMode,
} from "../types/policy.types.js";
import type { CompliancePack } from "../types/compliance.types.js";
import { getDefaultModerationPolicy } from "../services/policy-engine.service.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";

const MODES = new Set<ModerationMode>(["strict", "balanced", "relaxed"]);
const CATEGORIES = new Set<ModerationCategory>([
  "nudity",
  "suggestive",
  "violence",
  "drugs",
  "weapons",
  "hate_symbols",
  "gambling",
  "alcohol",
]);
const ACTIONS = new Set<ModerationDecisionAction>(["allow", "review", "reject"]);
const REVIEW_MODES = new Set<ReviewMode>(["enabled", "disabled"]);
const REVIEW_FALLBACK_ACTIONS = new Set<ReviewFallbackAction>(["allow", "reject"]);
const PACKS = new Set<CompliancePack>([
  "marketplace",
  "kids",
  "education",
  "social",
  "dating",
  "ads",
]);

function requireNumber(value: unknown, name: string) {
  if (typeof value !== "number" || value < 0 || value > 100) {
    throw new HttpError(400, `${name} must be a number between 0 and 100`);
  }

  return value;
}

export async function savePolicyRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const projectId = body.projectId;

  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    throw new HttpError(400, "projectId must be a non-empty string");
  }

  const accountId = getDashboardAccountId(authContext.userId);
  const project = await getProjectById({ accountId, projectId: projectId.trim() });

  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  const mode = body.mode;
  if (typeof mode !== "string" || !MODES.has(mode as ModerationMode)) {
    throw new HttpError(400, "mode must be strict, balanced, or relaxed");
  }

  if (!Array.isArray(body.blockedCategories)) {
    throw new HttpError(400, "blockedCategories must be an array");
  }

  const blockedCategories = body.blockedCategories.map((category) => {
    if (typeof category !== "string" || !CATEGORIES.has(category as ModerationCategory)) {
      throw new HttpError(400, "blockedCategories contains an unsupported category");
    }

    return category as ModerationCategory;
  });

  const categoryActions: Partial<Record<ModerationCategory, ModerationDecisionAction>> = {};
  const rawCategoryActions = body.categoryActions;

  if (
    rawCategoryActions &&
    typeof rawCategoryActions === "object" &&
    !Array.isArray(rawCategoryActions)
  ) {
    for (const [category, action] of Object.entries(rawCategoryActions)) {
      if (!CATEGORIES.has(category as ModerationCategory)) continue;
      if (typeof action !== "string" || !ACTIONS.has(action as ModerationDecisionAction)) {
        throw new HttpError(400, "categoryActions contains an unsupported action");
      }

      categoryActions[category as ModerationCategory] = action as ModerationDecisionAction;
    }
  }

  const compliancePack = body.compliancePack;
  const reviewMode = body.reviewMode;
  const reviewFallbackAction = body.reviewFallbackAction;
  const existingPolicy = await getPolicyByProjectId(project.projectId);
  const basePolicy = existingPolicy ?? getDefaultModerationPolicy(project.projectId);
  const now = new Date().toISOString();
  const policy: ModerationPolicy = {
    ...basePolicy,
    projectId: project.projectId,
    mode: mode as ModerationMode,
    minConfidence: requireNumber(body.minConfidence, "minConfidence"),
    reviewThreshold: requireNumber(body.reviewThreshold, "reviewThreshold"),
    rejectThreshold: requireNumber(body.rejectThreshold, "rejectThreshold"),
    blockedCategories,
    categoryActions,
    reviewMode:
      typeof reviewMode === "string" && REVIEW_MODES.has(reviewMode as ReviewMode)
        ? reviewMode as ReviewMode
        : basePolicy.reviewMode ?? "enabled",
    reviewFallbackAction:
      typeof reviewFallbackAction === "string" &&
      REVIEW_FALLBACK_ACTIONS.has(reviewFallbackAction as ReviewFallbackAction)
        ? reviewFallbackAction as ReviewFallbackAction
        : basePolicy.reviewFallbackAction ?? "reject",
    ...(typeof compliancePack === "string" && PACKS.has(compliancePack as CompliancePack)
      ? { compliancePack: compliancePack as CompliancePack }
      : { compliancePack: undefined }),
    updatedAt: now,
  };

  await savePolicy(policy);

  return ok({ policy });
}
