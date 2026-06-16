import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { authenticateApiKey, recordUsage } from "./auth/api-key-auth.js";
import { healthRoute } from "./routes/health.route.js";
import { moderateRoute } from "./routes/moderate.route.js";
import { uploadUrlRoute } from "./routes/upload-url.route.js";
import {
  errorResponse,
  internalServerError,
  isHttpError,
  notFound,
} from "./utils/http-response.js";

async function protectedRoute(
  event: APIGatewayProxyEvent,
  route: () => Promise<APIGatewayProxyResult>
) {
  const authContext = await authenticateApiKey(event);
  const response = await route();

  if (response.statusCode < 400) {
    await recordUsage(authContext);
  }

  return response;
}

export async function handler(event: APIGatewayProxyEvent) {
  try {
    const method = event.httpMethod;
    const path = event.path;

    if (method === "POST" && path === "/moderate") {
      return await protectedRoute(event, () => moderateRoute(event));
    }

    if (method === "POST" && path === "/upload-url") {
      return await protectedRoute(event, () => uploadUrlRoute());
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
