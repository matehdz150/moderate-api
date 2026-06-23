import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { authenticateApiKey, recordUsage } from "../auth/api-key-auth.js";
import { authenticateCognitoJwt } from "../auth/cognito-auth.js";
import type { AuthContext } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import {
  errorResponse,
  internalServerError,
  isHttpError,
} from "./http-response.js";
import { logError } from "./structured-log.js";

export function getRoutePath(event: APIGatewayProxyEvent) {
  return event.resource && !event.resource.includes("{")
    ? event.resource
    : event.path;
}

export async function handleLambdaRoute(
  event: APIGatewayProxyEvent,
  route: () => Promise<APIGatewayProxyResult> | APIGatewayProxyResult
) {
  try {
    return await route();
  } catch (error) {
    if (isHttpError(error)) {
      return errorResponse(error);
    }

    logError("lambda_unhandled_error", {
      requestId: event.requestContext.requestId,
      route: `${event.httpMethod} ${getRoutePath(event)}`,
      error,
    });
    return internalServerError();
  }
}

export async function apiKeyProtectedRoute(
  event: APIGatewayProxyEvent,
  route: (authContext: AuthContext) => Promise<APIGatewayProxyResult>,
  options?: { recordUsage?: boolean }
) {
  const authContext = await authenticateApiKey(event);
  const response = await route(authContext);

  // Verify tracks its own per-verification usage, so it opts out of the shared
  // request counter via { recordUsage: false }.
  if (response.statusCode < 400 && options?.recordUsage !== false) {
    await recordUsage(authContext);
  }

  return response;
}

export async function cognitoProtectedRoute(
  event: APIGatewayProxyEvent,
  route: (authContext: CognitoAuthContext) => Promise<APIGatewayProxyResult>
) {
  const authContext = await authenticateCognitoJwt(event);

  return route(authContext);
}
