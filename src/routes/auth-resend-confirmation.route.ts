import type { APIGatewayProxyEvent } from "aws-lambda";

import { resendUserConfirmationCode } from "../services/cognito.service.js";
import type { ResendConfirmationRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";

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
  const response = await resendUserConfirmationCode(request.email);

  return ok(response);
}
