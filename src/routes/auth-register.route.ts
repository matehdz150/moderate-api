import type { APIGatewayProxyEvent } from "aws-lambda";

import { resolveAccountForIdentity } from "../services/account-identity.service.js";
import { registerUser } from "../services/cognito.service.js";
import { parsePlanId } from "../services/plan.service.js";
import type { RegisterRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseRegisterRequest(event: APIGatewayProxyEvent): RegisterRequest {
  const body = parseJsonObjectBody(event.body);

  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    throw new HttpError(400, "email must be a non-empty string");
  }

  if (
    typeof body.password !== "string" ||
    body.password.trim().length === 0
  ) {
    throw new HttpError(400, "password must be a non-empty string");
  }

  return {
    email: body.email.trim().toLowerCase(),
    password: body.password,
    planId: parsePlanId(body.planId),
  };
}

export async function authRegisterRoute(event: APIGatewayProxyEvent) {
  const request = parseRegisterRequest(event);

  try {
    const response = await registerUser(request.email, request.password);
    const account = await resolveAccountForIdentity({
      provider: "cognito",
      providerUserId: response.userId,
      legacyUserId: response.userId,
      email: request.email,
      emailVerified: true,
      planId: request.planId,
    });

    return ok({
      ...response,
      account,
    });
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_register_error", {
      requestId: event.requestContext.requestId,
      route: "POST /auth/register",
      planId: request.planId,
      error,
    });
    }
    throw error;
  }
}
