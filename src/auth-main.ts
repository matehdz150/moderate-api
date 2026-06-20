import type { APIGatewayProxyEvent } from "aws-lambda";

import { authConfirmForgotPasswordRoute } from "./routes/auth-confirm-forgot-password.route.js";
import { authConfirmRoute } from "./routes/auth-confirm.route.js";
import { authForgotPasswordRoute } from "./routes/auth-forgot-password.route.js";
import { authGitHubExchangeRoute } from "./routes/auth-github-exchange.route.js";
import { authLoginRoute } from "./routes/auth-login.route.js";
import { authRegisterRoute } from "./routes/auth-register.route.js";
import { authResendConfirmationRoute } from "./routes/auth-resend-confirmation.route.js";
import { healthRoute } from "./routes/health.route.js";
import { getRoutePath, handleLambdaRoute } from "./utils/lambda-router.js";
import { corsPreflight, notFound } from "./utils/http-response.js";

export async function handler(event: APIGatewayProxyEvent) {
  return handleLambdaRoute(event, async () => {
    const method = event.httpMethod;
    const path = getRoutePath(event);

    if (method === "OPTIONS") {
      return corsPreflight();
    }

    if (method === "POST" && path === "/auth/register") {
      return authRegisterRoute(event);
    }

    if (method === "POST" && path === "/auth/confirm") {
      return authConfirmRoute(event);
    }

    if (method === "POST" && path === "/auth/resend-confirmation") {
      return authResendConfirmationRoute(event);
    }

    if (method === "POST" && path === "/auth/login") {
      return authLoginRoute(event);
    }

    if (method === "POST" && path === "/auth/github/exchange") {
      return authGitHubExchangeRoute(event);
    }

    if (method === "POST" && path === "/auth/forgot-password") {
      return authForgotPasswordRoute(event);
    }

    if (method === "POST" && path === "/auth/confirm-forgot-password") {
      return authConfirmForgotPasswordRoute(event);
    }

    if (method === "GET" && path === "/health") {
      return healthRoute();
    }

    return notFound("Route not found");
  });
}
