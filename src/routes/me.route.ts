import type { CognitoAuthContext } from "../types/cognito.types.js";
import { ok } from "../utils/http-response.js";

export async function meRoute(authContext: CognitoAuthContext) {
  return ok({
    userId: authContext.userId,
    email: authContext.email,
  });
}
