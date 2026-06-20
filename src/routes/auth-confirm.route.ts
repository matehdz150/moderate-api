import type { APIGatewayProxyEvent } from "aws-lambda";

import { confirmUserRegistration } from "../services/cognito.service.js";
import type { ConfirmRegisterRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseConfirmRegisterRequest(
  event: APIGatewayProxyEvent
): ConfirmRegisterRequest {
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

  return {
    email: body.email.trim().toLowerCase(),
    confirmationCode: body.confirmationCode.trim(),
  };
}

export async function authConfirmRoute(event: APIGatewayProxyEvent) {
  const request = parseConfirmRegisterRequest(event);

  try {
    const response = await confirmUserRegistration(
      request.email,
      request.confirmationCode
    );

    return ok(response);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_confirm_error", {
      requestId: event.requestContext.requestId,
      route: "POST /auth/confirm",
      error,
    });
    }
    throw error;
  }
}
