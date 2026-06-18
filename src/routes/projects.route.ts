import type { APIGatewayProxyEvent } from "aws-lambda";

import { listProjectsByAccount } from "../repositories/project.repository.js";
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

  const project = await createProject({
    accountId: getDashboardAccountId(authContext.userId),
    name: body.name.trim(),
  });

  return ok({ project });
}
