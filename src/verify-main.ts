import type { APIGatewayProxyEvent } from "aws-lambda";

import { healthRoute } from "./routes/health.route.js";
import { verifyRoute } from "./routes/verify.route.js";
import { dashboardVerifyLogsRoute, verifyLogsRoute } from "./routes/verify-logs.route.js";
import { corsPreflight, notFound } from "./utils/http-response.js";
import { apiKeyProtectedRoute, cognitoProtectedRoute, getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(event, async () => {
    const method = event.httpMethod;
    const path = getRoutePath(event);

    if (method === "OPTIONS") {
      return corsPreflight();
    }

    if (method === "POST" && path === "/verify") {
      return apiKeyProtectedRoute(event, (authContext) =>
        verifyRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/verify-logs") {
      return apiKeyProtectedRoute(event, (authContext) =>
        verifyLogsRoute(authContext)
      );
    }

    if (method === "GET" && path === "/dashboard/verify-logs") {
      return cognitoProtectedRoute(event, (authContext) =>
        dashboardVerifyLogsRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/verify/health") {
      return healthRoute();
    }

    return notFound("Verify route not found");
  });
}
