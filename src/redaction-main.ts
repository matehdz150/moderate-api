import type { APIGatewayProxyEvent } from "aws-lambda";

import { healthRoute } from "./routes/health.route.js";
import { redactRoute } from "./routes/redact.route.js";
import { corsPreflight, notFound } from "./utils/http-response.js";
import { apiKeyProtectedRoute, getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(event, async () => {
    const method = event.httpMethod;
    const path = getRoutePath(event);

    if (method === "OPTIONS") {
      return corsPreflight();
    }

    if (method === "POST" && path === "/redact") {
      return apiKeyProtectedRoute(event, (authContext) =>
        redactRoute(event, authContext)
      );
    }

    if (method === "GET" && (path === "/redaction/health" || path === "/redact/health")) {
      return healthRoute();
    }

    return notFound("Redaction route not found");
  });
}
