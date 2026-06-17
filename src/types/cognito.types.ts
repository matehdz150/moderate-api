export interface CognitoAuthContext {
  userId: string;
  email: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface ConfirmRegisterRequest {
  email: string;
  confirmationCode: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}
