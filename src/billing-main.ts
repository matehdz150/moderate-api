import type { APIGatewayProxyEvent } from "aws-lambda";

import {
  changeBillingPlanRoute,
  createCheckoutSessionRoute,
  createPortalSessionRoute,
  createSubscriptionIntentRoute,
  stripeWebhookRoute,
  syncBillingRoute,
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

    if (method === "POST" && (path === "/billing/subscription-intent" || path === "/billing/subscription-intent/")) {
      return cognitoProtectedRoute(event, (authContext) =>
        createSubscriptionIntentRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/billing/checkout-session") {
      return cognitoProtectedRoute(event, (authContext) =>
        createCheckoutSessionRoute(event, authContext)
      );
    }

    if (method === "POST" && (path === "/billing/change-plan" || path === "/billing/change-plan/")) {
      return cognitoProtectedRoute(event, (authContext) =>
        changeBillingPlanRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/billing/portal-session") {
      return cognitoProtectedRoute(event, (authContext) =>
        createPortalSessionRoute(authContext)
      );
    }

    if (method === "POST" && (path === "/billing/sync" || path === "/billing/sync/")) {
      return cognitoProtectedRoute(event, (authContext) =>
        syncBillingRoute(authContext)
      );
    }

    if (method === "POST" && path === "/billing/webhook") {
      return stripeWebhookRoute(event);
    }

    return notFound("Billing route not found");
  });
}
