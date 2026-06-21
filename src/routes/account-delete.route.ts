import { deleteAccountData } from "../services/account-delete.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { ok } from "../utils/http-response.js";

export async function deleteAccountRoute(authContext: CognitoAuthContext) {
  const accountId = getDashboardAccountId(authContext.userId);
  const result = await deleteAccountData({
    accountId,
    email: authContext.email,
  });

  return ok(result);
}
