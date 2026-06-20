import type { APIGatewayProxyEvent } from "aws-lambda";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";

import { resolveAccountForIdentity } from "../services/account-identity.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { AccountIdentityProvider } from "../types/account.types.js";
import { verifyDashboardJwt } from "../utils/app-jwt.js";
import { HttpError } from "../utils/http-response.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getHeader(event: APIGatewayProxyEvent, headerName: string) {
  const requestedHeader = headerName.toLowerCase();

  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (name.toLowerCase() === requestedHeader) {
      return value;
    }
  }

  return undefined;
}

function getCognitoConfig() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const region = process.env.AWS_REGION;

  if (!userPoolId) {
    throw new Error("COGNITO_USER_POOL_ID is not configured");
  }

  if (!clientId) {
    throw new Error("COGNITO_CLIENT_ID is not configured");
  }

  if (!region) {
    throw new Error("AWS_REGION is not configured");
  }

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

  return {
    clientId,
    issuer,
  };
}

function getJwks(issuer: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }

  return jwks;
}

function getCognitoProviderIdentity(payload: JWTPayload): {
  provider: AccountIdentityProvider;
  providerUserId: string;
  legacyUserId: string;
} {
  const legacyUserId = String(payload.sub);
  const identities = payload.identities;

  if (Array.isArray(identities)) {
    const identity = identities.find((item) => {
      return (
        item &&
        typeof item === "object" &&
        "providerName" in item &&
        "userId" in item
      );
    }) as { providerName?: unknown; userId?: unknown } | undefined;

    if (typeof identity?.providerName === "string" && typeof identity.userId === "string") {
      const providerName = identity.providerName.toLowerCase();

      if (providerName === "google") {
        return {
          provider: "google",
          providerUserId: identity.userId,
          legacyUserId,
        };
      }
    }
  }

  return {
    provider: "cognito",
    providerUserId: legacyUserId,
    legacyUserId,
  };
}

function isEmailVerified(payload: JWTPayload) {
  return payload.email_verified === true || payload.email_verified === "true";
}

async function mapPayloadToAuthContext(payload: JWTPayload): Promise<CognitoAuthContext> {
  if (payload.token_use !== "id") {
    throw new HttpError(401, "Invalid authorization token");
  }

  if (!payload.sub || typeof payload.email !== "string") {
    throw new HttpError(401, "Invalid authorization token");
  }

  const identity = getCognitoProviderIdentity(payload);
  const account = await resolveAccountForIdentity({
    ...identity,
    email: payload.email,
    emailVerified: isEmailVerified(payload),
  });

  return {
    userId: account.userId,
    email: account.email,
  };
}

export async function authenticateCognitoJwt(
  event: APIGatewayProxyEvent
): Promise<CognitoAuthContext> {
  const authorization = getHeader(event, "authorization")?.trim();

  if (!authorization) {
    throw new HttpError(401, "Missing authorization token");
  }

  const [scheme, token, ...rest] = authorization.split(/\s+/);

  if (scheme !== "Bearer" || !token || rest.length > 0) {
    throw new HttpError(401, "Invalid authorization token");
  }

  try {
    if (decodeJwt(token).iss === "visora") {
      return await verifyDashboardJwt(token);
    }
  } catch {
    throw new HttpError(401, "Invalid authorization token");
  }

  const { clientId, issuer } = getCognitoConfig();

  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      audience: clientId,
      issuer,
    });

    return await mapPayloadToAuthContext(payload);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    try {
      return await verifyDashboardJwt(token);
    } catch {
      throw new HttpError(401, "Invalid authorization token");
    }
  }
}
