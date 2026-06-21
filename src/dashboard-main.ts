import type { APIGatewayProxyEvent } from "aws-lambda";

import { deleteAccountRoute } from "./routes/account-delete.route.js";
import { updateAccountPlanRoute } from "./routes/account-plan.route.js";
import { adminOverviewRoute } from "./routes/admin-overview.route.js";
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
import { decideReviewQueueRoute, listReviewQueueRoute } from "./routes/review-queue.route.js";
import {
  createWebhookRoute,
  deleteWebhookRoute,
  listWebhookEventsRoute,
  listWebhooksRoute,
  retryWebhookEventRoute,
  rotateWebhookSecretRoute,
} from "./routes/webhooks.route.js";
import {
  createProjectRoute,
  deleteProjectRoute,
  listProjectsRoute,
  renameProjectRoute,
} from "./routes/projects.route.js";
import { cognitoProtectedRoute, getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";
import { corsPreflight, notFound } from "./utils/http-response.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(event, async () => {
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

    if (method === "GET" && path === "/admin/overview") {
      return cognitoProtectedRoute(event, (authContext) =>
        adminOverviewRoute(authContext)
      );
    }

    if (method === "PUT" && path === "/account/plan") {
      return cognitoProtectedRoute(event, (authContext) =>
        updateAccountPlanRoute(event, authContext)
      );
    }

    if (method === "DELETE" && path === "/account") {
      return cognitoProtectedRoute(event, (authContext) =>
        deleteAccountRoute(authContext)
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

    if (method === "GET" && path === "/review-queue") {
      return cognitoProtectedRoute(event, (authContext) =>
        listReviewQueueRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/review-queue/decision") {
      return cognitoProtectedRoute(event, (authContext) =>
        decideReviewQueueRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/dashboard/moderate") {
      return cognitoProtectedRoute(event, (authContext) =>
        dashboardModerateRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/webhooks") {
      return cognitoProtectedRoute(event, (authContext) =>
        listWebhooksRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/webhook-events") {
      return cognitoProtectedRoute(event, (authContext) =>
        listWebhookEventsRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/webhook-events/retry") {
      return cognitoProtectedRoute(event, (authContext) =>
        retryWebhookEventRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/webhooks") {
      return cognitoProtectedRoute(event, (authContext) =>
        createWebhookRoute(event, authContext)
      );
    }

    if (method === "DELETE" && path === "/webhooks") {
      return cognitoProtectedRoute(event, (authContext) =>
        deleteWebhookRoute(event, authContext)
      );
    }

    if (method === "POST" && path === "/webhooks/rotate-secret") {
      return cognitoProtectedRoute(event, (authContext) =>
        rotateWebhookSecretRoute(event, authContext)
      );
    }

    if (method === "GET" && path === "/health") {
      return healthRoute();
    }

    return notFound("Route not found");
  });
}
