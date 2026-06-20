import { SignJWT, jwtVerify } from "jose";

import type { CognitoAuthContext } from "../types/cognito.types.js";

const ISSUER = "visora";
const AUDIENCE = "visora-dashboard";
const EXPIRES_IN = "7d";

function getJwtSecret() {
  const secret = process.env.VISORA_AUTH_JWT_SECRET;

  if (!secret) {
    throw new Error("VISORA_AUTH_JWT_SECRET is not configured");
  }

  return new TextEncoder().encode(secret);
}

export async function createDashboardJwt(params: {
  userId: string;
  email: string;
  provider: "github";
}) {
  return new SignJWT({
    userId: params.userId,
    email: params.email,
    provider: params.provider,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(getJwtSecret());
}

export async function verifyDashboardJwt(token: string): Promise<CognitoAuthContext> {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.userId !== "string"
  ) {
    throw new Error("Invalid dashboard token payload");
  }

  return {
    userId: payload.userId,
    email: payload.email,
  };
}
