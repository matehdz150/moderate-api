import type { APIGatewayProxyEvent } from "aws-lambda";

import {
  createCheckoutSessionRoute,
  createPortalSessionRoute,
  stripeWebhookRoute,
} from "./routes/billing.route.js";
import { healthRoute } from "./routes/health.route.js";
import { corsPreflight, notFound } from "./utils/http-response.js";
import { cognitoProtectedRoute, getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(event, async () => {
    const method = event.httpMethod;
    const path = getRoutePath(event);

    if (method === "OPTIONS") {
      return corsPreflight();
    }

    if (method === "GET" && path === "/billing/health") {
      return healthRoute();
    }

    if (method === "POST" && path === "/billing/checkout-session") {
      return cognitoProtectedRoute(event, (authContext) =>
        createCheckoutSessionRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/billing/portal-session") {
      return cognitoProtectedRoute(event, (authContext) =>
        createPortalSessionRoute(authContext)
      );
    }

    if (method === "POST" && path === "/billing/webhook") {
      return stripeWebhookRoute(event);
    }

    return notFound("Billing route not found");
  });
}
