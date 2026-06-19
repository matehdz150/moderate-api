import type { APIGatewayProxyEvent } from "aws-lambda";

import { getCurrentMonthUsage, incrementUsage } from "../auth/usage.repository.js";
import { getProjectById } from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { getPlanOverageConfig } from "../services/plan.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { HttpError } from "../utils/http-response.js";
import { moderateRoute } from "./moderate.route.js";

function getProjectId(event: APIGatewayProxyEvent) {
  const projectId = event.queryStringParameters?.projectId?.trim();

  if (!projectId) {
    throw new HttpError(400, "projectId query parameter is required");
  }

  return projectId;
}

export async function dashboardModerateRoute(
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

  const usageRecord = await getCurrentMonthUsage(account.accountId);
  const requestsUsed = usageRecord?.requestsUsed ?? 0;
  const overageConfig = getPlanOverageConfig(account.planId);

  if (!overageConfig.overageEnabled && requestsUsed >= account.monthlyLimit) {
    throw new HttpError(429, "Monthly usage limit exceeded");
  }

  const authContext: AuthContext = {
    apiKeyHash: "dashboard-playground",
    accountId: account.accountId,
    projectId: project.projectId,
    planId: account.planId,
    monthlyLimit: account.monthlyLimit,
    overageEnabled: overageConfig.overageEnabled,
    overagePriceCentsPerThousand: overageConfig.overagePriceCentsPerThousand,
    requestsUsed,
  };

  const response = await moderateRoute(event, authContext);

  if (response.statusCode < 400) {
    await incrementUsage({
      accountId: authContext.accountId,
      projectId: authContext.projectId,
      planId: authContext.planId,
      monthlyLimit: authContext.monthlyLimit,
      overageEnabled: authContext.overageEnabled,
      overagePriceCentsPerThousand: authContext.overagePriceCentsPerThousand,
    });
  }

  return response;
}
