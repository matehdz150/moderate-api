import type { APIGatewayProxyEvent } from "aws-lambda";

import { listProjectsByAccount } from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createProject } from "../services/project.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";

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
