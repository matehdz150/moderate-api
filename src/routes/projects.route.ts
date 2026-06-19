import type { APIGatewayProxyEvent } from "aws-lambda";

import { revokeApiKeysByProject } from "../auth/api-key.repository.js";
import { deletePolicyByProjectId } from "../repositories/policy.repository.js";
import {
  deleteProjectRecord,
  listProjectsByAccount,
  updateProjectName,
} from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createProject } from "../services/project.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";

function parseProjectId(body: Record<string, unknown>) {
  if (typeof body.projectId !== "string" || body.projectId.trim().length === 0) {
    throw new HttpError(400, "projectId must be a non-empty string");
  }

  return body.projectId.trim();
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

  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const projects = await listProjectsByAccount(account.accountId);

  if (projects.length >= account.projectLimit) {
    throw new HttpError(403, "Project limit reached for current plan");
  }

  const project = await createProject({
    accountId: account.accountId,
    name: body.name.trim(),
    planId: account.planId,
    monthlyLimit: account.monthlyLimit,
  });

  return ok({ project });
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
