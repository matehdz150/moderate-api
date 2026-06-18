import type { APIGatewayProxyEvent } from "aws-lambda";

import { updateApiKeysPlanByAccount } from "../auth/api-key.repository.js";
import { updateProjectsPlanByAccount } from "../repositories/project.repository.js";
import { changeAccountPlan, ensureAccountForUser } from "../services/account.service.js";
import { parsePlanId } from "../services/plan.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";

export async function updateAccountPlanRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const planId = parsePlanId(body.planId);
  const accountId = getDashboardAccountId(authContext.userId);

  await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });

  const account = await changeAccountPlan({ accountId, planId });
  const updatedAt = new Date().toISOString();

  await Promise.all([
    updateProjectsPlanByAccount({
      accountId,
      planId: account.planId,
      monthlyLimit: account.monthlyLimit,
      updatedAt,
    }),
    updateApiKeysPlanByAccount({
      accountId,
      planId: account.planId,
      monthlyLimit: account.monthlyLimit,
    }),
  ]);

  return ok({ account });
}
