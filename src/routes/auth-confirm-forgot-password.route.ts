import type { APIGatewayProxyEvent } from "aws-lambda";

import { confirmUserForgotPassword } from "../services/cognito.service.js";
import type { ConfirmForgotPasswordRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseConfirmForgotPasswordRequest(event: APIGatewayProxyEvent): ConfirmForgotPasswordRequest {
  const body = parseJsonObjectBody(event.body);

  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    throw new HttpError(400, "email must be a non-empty string");
  }

  if (
    typeof body.confirmationCode !== "string" ||
    body.confirmationCode.trim().length === 0
  ) {
    throw new HttpError(400, "confirmationCode must be a non-empty string");
  }

  if (
    typeof body.newPassword !== "string" ||
    body.newPassword.trim().length === 0
  ) {
    throw new HttpError(400, "newPassword must be a non-empty string");
  }

  return {
    email: body.email.trim().toLowerCase(),
    confirmationCode: body.confirmationCode.trim(),
    newPassword: body.newPassword,
  };
}

export async function authConfirmForgotPasswordRoute(event: APIGatewayProxyEvent) {
  const request = parseConfirmForgotPasswordRequest(event);

  try {
    const response = await confirmUserForgotPassword(request);

    return ok(response);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_confirm_forgot_password_error", {
        requestId: event.requestContext.requestId,
        route: "POST /auth/confirm-forgot-password",
        error,
      });
    }
    throw error;
  }
}
