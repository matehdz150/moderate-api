import type { APIGatewayProxyEvent } from "aws-lambda";

import { loginUser } from "../services/cognito.service.js";
import type { LoginRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseLoginRequest(event: APIGatewayProxyEvent): LoginRequest {
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
  };
}

export async function authLoginRoute(event: APIGatewayProxyEvent) {
  const request = parseLoginRequest(event);

  try {
    const response = await loginUser(request.email, request.password);

    return ok(response);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_login_error", {
      requestId: event.requestContext.requestId,
      route: "POST /auth/login",
      error,
    });
    }
    throw error;
  }
}
