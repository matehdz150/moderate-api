import type { APIGatewayProxyEvent } from "aws-lambda";

import { healthRoute } from "./routes/health.route.js";
import { moderateRoute } from "./routes/moderate.route.js";
import { uploadUrlRoute } from "./routes/upload-url.route.js";
import { internalServerError, jsonResponse } from "./utils/http-response.js";

export async function handler(event: APIGatewayProxyEvent) {
  try {
    const method = event.httpMethod;
    const path = event.path;

    if (method === "POST" && path === "/moderate") {
      return moderateRoute(event);
    }

    if (method === "POST" && path === "/upload-url") {
      return uploadUrlRoute();
    }

    if (method === "GET" && path === "/health") {
      return healthRoute();
    }

    return jsonResponse(404, {
      error: "Route not found",
    });
  } catch (error) {
    console.error(error);
    return internalServerError();
  }
}
