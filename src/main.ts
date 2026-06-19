import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { authenticateApiKey, recordUsage } from "./auth/api-key-auth.js";
import { authenticateCognitoJwt } from "./auth/cognito-auth.js";
import { updateAccountPlanRoute } from "./routes/account-plan.route.js";
import { authConfirmRoute } from "./routes/auth-confirm.route.js";
import { authLoginRoute } from "./routes/auth-login.route.js";
import { authRegisterRoute } from "./routes/auth-register.route.js";
import { authResendConfirmationRoute } from "./routes/auth-resend-confirmation.route.js";
import {
  createApiKeyRoute,
  listApiKeysRoute,
  renameApiKeyRoute,
  revokeApiKeyRoute,
  rotateApiKeyRoute,
} from "./routes/create-api-key.route.js";
import { dashboardDataRoute } from "./routes/dashboard-data.route.js";
import { healthRoute } from "./routes/health.route.js";
import { meRoute } from "./routes/me.route.js";
import { moderateRoute } from "./routes/moderate.route.js";
import { moderationLogsRoute } from "./routes/moderation-logs.route.js";
import { savePolicyRoute } from "./routes/policies.route.js";
import { createProjectRoute, listProjectsRoute } from "./routes/projects.route.js";
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

    if (method === "POST" && path === "/auth/register") {
      return await authRegisterRoute(event);
    }

    if (method === "POST" && path === "/auth/confirm") {
      return await authConfirmRoute(event);
    }

    if (method === "POST" && path === "/auth/resend-confirmation") {
      return await authResendConfirmationRoute(event);
    }

    if (method === "POST" && path === "/auth/login") {
      return await authLoginRoute(event);
    }

    if (method === "POST" && path === "/moderate") {
      return await protectedRoute(event, (authContext) =>
        moderateRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/upload-url") {
      return await protectedRoute(event, (authContext) =>
        uploadUrlRoute(authContext)
      );
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

    if (method === "GET" && path === "/dashboard-data") {
      return await cognitoProtectedRoute(event, (authContext) =>
        dashboardDataRoute(authContext)
      );
    }

    if (method === "PUT" && path === "/account/plan") {
      return await cognitoProtectedRoute(event, (authContext) =>
        updateAccountPlanRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/projects") {
      return await cognitoProtectedRoute(event, (authContext) =>
        listProjectsRoute(authContext)
      );
    }

    if (method === "POST" && path === "/projects") {
      return await cognitoProtectedRoute(event, (authContext) =>
        createProjectRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/api-keys") {
      return await cognitoProtectedRoute(event, (authContext) =>
        createApiKeyRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/api-keys") {
      return await cognitoProtectedRoute(event, (authContext) =>
        listApiKeysRoute(authContext)
      );
    }

    if (method === "PATCH" && path === "/api-keys") {
      return await cognitoProtectedRoute(event, (authContext) =>
        renameApiKeyRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/api-keys/revoke") {
      return await cognitoProtectedRoute(event, (authContext) =>
        revokeApiKeyRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/api-keys/rotate") {
      return await cognitoProtectedRoute(event, (authContext) =>
        rotateApiKeyRoute(event, authContext)
      );
    }

    if (method === "PUT" && path === "/policies") {
      return await cognitoProtectedRoute(event, (authContext) =>
        savePolicyRoute(event, authContext)
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
