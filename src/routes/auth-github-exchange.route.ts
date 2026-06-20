import type { APIGatewayProxyEvent } from "aws-lambda";

import { loginWithGitHub } from "../services/github-auth.service.js";
import { parsePlanId } from "../services/plan.service.js";
import type { GitHubExchangeRequest } from "../types/cognito.types.js";
import { ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function parseGitHubExchangeRequest(event: APIGatewayProxyEvent): GitHubExchangeRequest {
  const body = parseJsonObjectBody(event.body);

  if (typeof body.code !== "string" || body.code.trim().length === 0) {
    throw new HttpError(400, "code must be a non-empty string");
  }

  if (typeof body.redirectUri !== "string" || body.redirectUri.trim().length === 0) {
    throw new HttpError(400, "redirectUri must be a non-empty string");
  }

  return {
    code: body.code.trim(),
    redirectUri: body.redirectUri.trim(),
    planId: parsePlanId(body.planId),
  };
}

export async function authGitHubExchangeRoute(event: APIGatewayProxyEvent) {
  const request = parseGitHubExchangeRequest(event);

  try {
    const session = await loginWithGitHub(request);

    return ok(session);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("auth_github_error", {
        requestId: event.requestContext.requestId,
        route: "POST /auth/github/exchange",
        error,
      });
    }

    throw error;
  }
}
