import type { APIGatewayProxyEvent } from "aws-lambda";

import { forgotUserPassword } from "../services/cognito.service.js";
import type { ForgotPasswordRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseForgotPasswordRequest(event: APIGatewayProxyEvent): ForgotPasswordRequest {
  const body = parseJsonObjectBody(event.body);

  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    throw new HttpError(400, "email must be a non-empty string");
  }

  return {
    email: body.email.trim().toLowerCase(),
  };
}

export async function authForgotPasswordRoute(event: APIGatewayProxyEvent) {
  const request = parseForgotPasswordRequest(event);

  try {
    const response = await forgotUserPassword(request.email);

    return ok(response);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_forgot_password_error", {
        requestId: event.requestContext.requestId,
        route: "POST /auth/forgot-password",
        error,
      });
    }
    throw error;
  }
}
