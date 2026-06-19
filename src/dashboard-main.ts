import type { APIGatewayProxyEvent } from "aws-lambda";

import { updateAccountPlanRoute } from "./routes/account-plan.route.js";
import {
  createApiKeyRoute,
  listApiKeysRoute,
  renameApiKeyRoute,
  revokeApiKeyRoute,
  rotateApiKeyRoute,
} from "./routes/create-api-key.route.js";
import { dashboardDataRoute } from "./routes/dashboard-data.route.js";
import { dashboardModerateRoute } from "./routes/dashboard-moderate.route.js";
import { healthRoute } from "./routes/health.route.js";
import { meRoute } from "./routes/me.route.js";
import { savePolicyRoute } from "./routes/policies.route.js";
import {
  createProjectRoute,
  deleteProjectRoute,
  listProjectsRoute,
  renameProjectRoute,
} from "./routes/projects.route.js";
import { cognitoProtectedRoute, getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";
import { corsPreflight, notFound } from "./utils/http-response.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(async () => {
    const method = event.httpMethod;
    const path = getRoutePath(event);

    if (method === "OPTIONS") {
      return corsPreflight();
    }

    if (method === "GET" && path === "/me") {
      return cognitoProtectedRoute(event, (authContext) => meRoute(authContext));
    }

    if (method === "GET" && path === "/dashboard-data") {
      return cognitoProtectedRoute(event, (authContext) =>
        dashboardDataRoute(authContext)
      );
    }

    if (method === "PUT" && path === "/account/plan") {
      return cognitoProtectedRoute(event, (authContext) =>
        updateAccountPlanRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/projects") {
      return cognitoProtectedRoute(event, (authContext) =>
        listProjectsRoute(authContext)
      );
    }

    if (method === "POST" && path === "/projects") {
      return cognitoProtectedRoute(event, (authContext) =>
        createProjectRoute(event, authContext)
      );
    }

    if (method === "PATCH" && path === "/projects") {
      return cognitoProtectedRoute(event, (authContext) =>
        renameProjectRoute(event, authContext)
      );
    }

    if (method === "DELETE" && path === "/projects") {
      return cognitoProtectedRoute(event, (authContext) =>
        deleteProjectRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/api-keys") {
      return cognitoProtectedRoute(event, (authContext) =>
        createApiKeyRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/api-keys") {
      return cognitoProtectedRoute(event, (authContext) =>
        listApiKeysRoute(authContext)
      );
    }

    if (method === "PATCH" && path === "/api-keys") {
      return cognitoProtectedRoute(event, (authContext) =>
        renameApiKeyRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/api-keys/revoke") {
      return cognitoProtectedRoute(event, (authContext) =>
        revokeApiKeyRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/api-keys/rotate") {
      return cognitoProtectedRoute(event, (authContext) =>
        rotateApiKeyRoute(event, authContext)
      );
    }

    if (method === "PUT" && path === "/policies") {
      return cognitoProtectedRoute(event, (authContext) =>
        savePolicyRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/dashboard/moderate") {
      return cognitoProtectedRoute(event, (authContext) =>
        dashboardModerateRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/health") {
      return healthRoute();
    }

    return notFound("Route not found");
  });
}
