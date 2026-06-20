import type { PlanId } from "./account.types.js";

export interface CognitoAuthContext {
  userId: string;
  email: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  planId: PlanId;
}

export interface ConfirmRegisterRequest {
  email: string;
  confirmationCode: string;
}

export interface ResendConfirmationRequest {
  email: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GitHubExchangeRequest {
  code: string;
  redirectUri: string;
  planId: PlanId;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ConfirmForgotPasswordRequest {
  email: string;
  confirmationCode: string;
  newPassword: string;
}

export interface LoginResponse {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}
