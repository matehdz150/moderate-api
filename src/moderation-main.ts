import type { APIGatewayProxyEvent } from "aws-lambda";

import { healthRoute } from "./routes/health.route.js";
import { moderateRoute } from "./routes/moderate.route.js";
import { moderationLogsRoute } from "./routes/moderation-logs.route.js";
import { uploadUrlRoute } from "./routes/upload-url.route.js";
import { apiKeyProtectedRoute, getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";
import { notFound } from "./utils/http-response.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(async () => {
    const method = event.httpMethod;
    const path = getRoutePath(event);

    if (method === "POST" && path === "/moderate") {
      return apiKeyProtectedRoute(event, (authContext) =>
        moderateRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/upload-url") {
      return apiKeyProtectedRoute(event, (authContext) =>
        uploadUrlRoute(authContext)
      );
    }

    if (method === "GET" && path === "/moderation-logs") {
      return apiKeyProtectedRoute(event, (authContext) =>
        moderationLogsRoute(authContext)
      );
    }

    if (method === "GET" && path === "/health") {
      return healthRoute();
    }

    return notFound("Route not found");
  });
}
