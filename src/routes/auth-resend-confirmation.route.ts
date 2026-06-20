import type { APIGatewayProxyEvent } from "aws-lambda";

import { resendUserConfirmationCode } from "../services/cognito.service.js";
import type { ResendConfirmationRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseResendConfirmationRequest(
  event: APIGatewayProxyEvent
): ResendConfirmationRequest {
  const body = parseJsonObjectBody(event.body);

  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    throw new HttpError(400, "email must be a non-empty string");
  }

  return {
    email: body.email.trim().toLowerCase(),
  };
}

export async function authResendConfirmationRoute(event: APIGatewayProxyEvent) {
  const request = parseResendConfirmationRequest(event);

  try {
    const response = await resendUserConfirmationCode(request.email);

    return ok(response);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_resend_confirmation_error", {
      requestId: event.requestContext.requestId,
      route: "POST /auth/resend-confirmation",
      error,
    });
    }
    throw error;
  }
}
