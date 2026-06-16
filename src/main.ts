import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { authenticateApiKey, recordUsage } from "./auth/api-key-auth.js";
import { authenticateCognitoJwt } from "./auth/cognito-auth.js";
import { healthRoute } from "./routes/health.route.js";
import { meRoute } from "./routes/me.route.js";
import { moderateRoute } from "./routes/moderate.route.js";
import { moderationLogsRoute } from "./routes/moderation-logs.route.js";
import { uploadUrlRoute } from "./routes/upload-url.route.js";
import type { AuthContext } from "./types/auth.types.js";
import type { CognitoAuthContext } from "./types/cognito.types.js";
import {
  errorResponse,
  internalServerError,
  isHttpError,
  notFound,
} from "./utils/http-response.js";

async function protectedRoute(
  event: APIGatewayProxyEvent,
  route: (authContext: AuthContext) => Promise<APIGatewayProxyResult>
) {
  const authContext = await authenticateApiKey(event);
  const response = await route(authContext);

  if (response.statusCode < 400) {
    await recordUsage(authContext);
  }

  return response;
}

async function cognitoProtectedRoute(
  event: APIGatewayProxyEvent,
  route: (authContext: CognitoAuthContext) => Promise<APIGatewayProxyResult>
) {
  const authContext = await authenticateCognitoJwt(event);

  return route(authContext);
}

export async function handler(event: APIGatewayProxyEvent) {
  try {
    const method = event.httpMethod;
    const path = event.path;

    if (method === "POST" && path === "/moderate") {
      return await protectedRoute(event, (authContext) =>
        moderateRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/upload-url") {
      return await protectedRoute(event, () => uploadUrlRoute());
    }

    if (method === "GET" && path === "/moderation-logs") {
      return await protectedRoute(event, (authContext) =>
        moderationLogsRoute(authContext)
      );
    }

    if (method === "GET" && path === "/me") {
      return await cognitoProtectedRoute(event, (authContext) =>
        meRoute(authContext)
      );
    }

    if (method === "GET" && path === "/health") {
      return healthRoute();
    }

    return notFound("Route not found");
  } catch (error) {
    if (isHttpError(error)) {
      return errorResponse(error);
    }

    console.error(error);
    return internalServerError();
  }
}
