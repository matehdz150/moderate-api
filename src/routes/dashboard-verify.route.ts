import type { APIGatewayProxyEvent } from "aws-lambda";

import { getProjectById } from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { getPlanOverageConfig } from "../services/plan.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { HttpError } from "../utils/http-response.js";
import { verifyRoute } from "./verify.route.js";

function getProjectId(event: APIGatewayProxyEvent) {
  const projectId = event.queryStringParameters?.projectId?.trim();

  if (!projectId) {
    throw new HttpError(400, "projectId query parameter is required");
  }

  return projectId;
}

export async function dashboardVerifyRoute(
  event: APIGatewayProxyEvent,
  cognitoContext: CognitoAuthContext
) {
  const account = await ensureAccountForUser({
    userId: cognitoContext.userId,
    email: cognitoContext.email,
  });
  const projectId = getProjectId(event);
  const project = await getProjectById({
    accountId: account.accountId,
    projectId,
  });

  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  if (project.projectType !== "verify") {
    throw new HttpError(400, "Selected project is not a verify project");
  }

  const overageConfig = getPlanOverageConfig(account.planId);

  // verifyRoute enforces the verify allotment and records its own usage/overage,
  // so the playground does not touch the shared request counter here.
  const authContext: AuthContext = {
    apiKeyHash: "dashboard-playground",
    accountId: account.accountId,
    projectId: project.projectId,
    planId: account.planId,
    monthlyLimit: account.monthlyLimit,
    overageEnabled: overageConfig.overageEnabled,
    overagePriceCentsPerThousand: overageConfig.overagePriceCentsPerThousand,
    requestsUsed: 0,
  };

  return verifyRoute(event, authContext);
}
