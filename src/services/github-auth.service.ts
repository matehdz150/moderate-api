import { ensureAccountForUser } from "./account.service.js";
import { createDashboardJwt } from "../utils/app-jwt.js";
import { HttpError } from "../utils/http-response.js";
import type { LoginResponse } from "../types/cognito.types.js";
import type { PlanId } from "../types/account.types.js";

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id?: number;
  email?: string | null;
}

interface GitHubEmailResponse {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

function getGitHubConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId) {
    throw new Error("GITHUB_CLIENT_ID is not configured");
  }

  if (!clientSecret) {
    throw new Error("GITHUB_CLIENT_SECRET is not configured");
  }

  return { clientId, clientSecret };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok || !payload) {
    throw new HttpError(401, "Could not verify GitHub account");
  }

  return payload;
}

async function exchangeCodeForAccessToken(params: {
  code: string;
  redirectUri: string;
}) {
  const { clientId, clientSecret } = getGitHubConfig();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });
  const payload = await readJsonResponse<GitHubTokenResponse>(response);

  if (!payload.access_token) {
    throw new HttpError(401, payload.error_description ?? "Invalid GitHub authorization code");
  }

  return payload.access_token;
}

async function fetchGitHubUser(accessToken: string) {
  return readJsonResponse<GitHubUserResponse>(
    await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + accessToken,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
  );
}

async function fetchGitHubEmail(accessToken: string, fallbackEmail?: string | null) {
  if (fallbackEmail) {
    return fallbackEmail.toLowerCase();
  }

  const emails = await readJsonResponse<GitHubEmailResponse[]>(
    await fetch("https://api.github.com/user/emails", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + accessToken,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
  );
  const email =
    emails.find((item) => item.primary && item.verified && item.email)?.email ??
    emails.find((item) => item.verified && item.email)?.email;

  if (!email) {
    throw new HttpError(400, "GitHub account must have a verified email");
  }

  return email.toLowerCase();
}

export async function loginWithGitHub(params: {
  code: string;
  redirectUri: string;
  planId: PlanId;
}): Promise<LoginResponse> {
  const accessToken = await exchangeCodeForAccessToken({
    code: params.code,
    redirectUri: params.redirectUri,
  });
  const githubUser = await fetchGitHubUser(accessToken);

  if (typeof githubUser.id !== "number") {
    throw new HttpError(401, "Invalid GitHub account");
  }

  const email = await fetchGitHubEmail(accessToken, githubUser.email);
  const userId = "github_" + githubUser.id;

  await ensureAccountForUser({
    userId,
    email,
    planId: params.planId,
  });

  const idToken = await createDashboardJwt({
    userId,
    email,
    provider: "github",
  });

  return {
    idToken,
    accessToken: idToken,
    expiresIn: 60 * 60 * 24 * 7,
    tokenType: "Bearer",
  };
}
