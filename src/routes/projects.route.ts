import type { APIGatewayProxyEvent } from "aws-lambda";

import { revokeApiKeysByProject } from "../auth/api-key.repository.js";
import { deletePolicyByProjectId } from "../repositories/policy.repository.js";
import {
  deleteProjectRecord,
  listProjectsByAccount,
  updateProjectRedactionSettings,
  updateProjectName,
} from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createProject } from "../services/project.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { RedactionSettings } from "../types/project.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { normalizeRedactionSettings } from "../utils/redaction-settings.js";

function parseProjectType(body: Record<string, unknown>) {
  if (body.projectType === undefined) {
    return "moderation" as const;
  }

  if (body.projectType !== "moderation" && body.projectType !== "redaction") {
    throw new HttpError(400, "projectType must be moderation or redaction");
  }

  return body.projectType;
}

function parseProjectId(body: Record<string, unknown>) {
  if (typeof body.projectId !== "string" || body.projectId.trim().length === 0) {
    throw new HttpError(400, "projectId must be a non-empty string");
  }

  return body.projectId.trim();
}

function parseBooleanSetting(
  settings: Record<string, unknown>,
  key: keyof Pick<RedactionSettings, "faceBlur" | "textBlur" | "licensePlateBlur">
) {
  if (settings[key] === undefined) return undefined;

  if (typeof settings[key] !== "boolean") {
    throw new HttpError(400, `${key} must be a boolean`);
  }

  return settings[key];
}

function parseRedactionSettings(body: Record<string, unknown>) {
  const rawSettings = body.redactionSettings;

  if (rawSettings === undefined) {
    return undefined;
  }

  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    throw new HttpError(400, "redactionSettings must be an object");
  }

  const settings = rawSettings as Record<string, unknown>;
  const minConfidence = settings.minConfidence;

  if (
    minConfidence !== undefined &&
    (typeof minConfidence !== "number" || !Number.isFinite(minConfidence))
  ) {
    throw new HttpError(400, "minConfidence must be a number");
  }

  return normalizeRedactionSettings({
    faceBlur: parseBooleanSetting(settings, "faceBlur"),
    textBlur: parseBooleanSetting(settings, "textBlur"),
    licensePlateBlur: parseBooleanSetting(settings, "licensePlateBlur"),
    minConfidence,
  });
}

function isConditionalCheckFailed(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

export async function listProjectsRoute(authContext: CognitoAuthContext) {
  const accountId = getDashboardAccountId(authContext.userId);
  const projects = await listProjectsByAccount(accountId);

  return ok({ accountId, projects });
}

export async function createProjectRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new HttpError(400, "name must be a non-empty string");
  }

  const projectType = parseProjectType(body);
  const redactionSettings = parseRedactionSettings(body);
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const projects = await listProjectsByAccount(account.accountId);

  if (projects.length >= account.projectLimit) {
    throw new HttpError(403, "Project limit reached for current plan");
  }

  if (projectType === "redaction" && account.planId === "free") {
    throw new HttpError(403, "Redaction projects are available on paid plans only");
  }

  const project = await createProject({
    accountId: account.accountId,
    name: body.name.trim(),
    planId: account.planId,
    monthlyLimit: account.monthlyLimit,
    projectType,
    redactionSettings,
  });

  return ok({ project });
}

export async function updateProjectRedactionSettingsRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const projectId = parseProjectId(body);
  const redactionSettings = parseRedactionSettings(body);

  if (!redactionSettings) {
    throw new HttpError(400, "redactionSettings is required");
  }

  const accountId = getDashboardAccountId(authContext.userId);

  try {
    const project = await updateProjectRedactionSettings({
      accountId,
      projectId,
      redactionSettings,
      updatedAt: new Date().toISOString(),
    });

    return ok({ project });
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new HttpError(404, "Redaction project not found");
    }

    throw error;
  }
}

export async function renameProjectRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const projectId = parseProjectId(body);

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new HttpError(400, "name must be a non-empty string");
  }

  const accountId = getDashboardAccountId(authContext.userId);

  try {
    const project = await updateProjectName({
      accountId,
      projectId,
      name: body.name.trim(),
      updatedAt: new Date().toISOString(),
    });

    return ok({ project });
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new HttpError(404, "Project not found");
    }

    throw error;
  }
}

export async function deleteProjectRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const projectId = parseProjectId(body);
  const accountId = getDashboardAccountId(authContext.userId);

  try {
    const project = await deleteProjectRecord({ accountId, projectId });

    await Promise.all([
      deletePolicyByProjectId(projectId),
      revokeApiKeysByProject({ accountId, projectId }),
    ]);

    return ok({ project });
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new HttpError(404, "Project not found");
    }

    throw error;
  }
}
