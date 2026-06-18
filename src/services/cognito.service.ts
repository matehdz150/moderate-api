import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import type { LoginResponse } from "../types/cognito.types.js";
import { HttpError } from "../utils/http-response.js";

const cognitoClient = new CognitoIdentityProviderClient({});

function getCognitoClientId() {
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!clientId) {
    throw new Error("COGNITO_CLIENT_ID is not configured");
  }

  return clientId;
}

function mapCognitoAuthError(error: unknown): never {
  const errorName = error instanceof Error ? error.name : undefined;

  if (errorName === "UsernameExistsException") {
    throw new HttpError(409, "Email is already registered");
  }

  if (errorName === "InvalidPasswordException") {
    throw new HttpError(400, "Password does not meet requirements");
  }

  if (errorName === "CodeMismatchException") {
    throw new HttpError(400, "Invalid confirmation code");
  }

  if (errorName === "ExpiredCodeException") {
    throw new HttpError(400, "Confirmation code has expired");
  }

  if (
    errorName === "NotAuthorizedException" ||
    errorName === "UserNotFoundException"
  ) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (errorName === "UserNotConfirmedException") {
    throw new HttpError(403, "User is not confirmed");
  }

  throw error;
}

function mapResendConfirmationError(error: unknown): never {
  const errorName = error instanceof Error ? error.name : undefined;

  if (errorName === "UserNotFoundException") {
    throw new HttpError(404, "User not found");
  }

  if (errorName === "InvalidParameterException") {
    throw new HttpError(400, "User cannot receive a confirmation code");
  }

  if (
    errorName === "LimitExceededException" ||
    errorName === "TooManyRequestsException"
  ) {
    throw new HttpError(429, "Too many verification code requests. Try again later");
  }

  if (errorName === "CodeDeliveryFailureException") {
    throw new HttpError(502, "Could not send verification code");
  }

  throw error;
}

export async function registerUser(email: string, password: string) {
  try {
    const result = await cognitoClient.send(
      new SignUpCommand({
        ClientId: getCognitoClientId(),
        Username: email,
        Password: password,
        UserAttributes: [
          {
            Name: "email",
            Value: email,
          },
        ],
      })
    );

    return {
      userId: result.UserSub,
      email,
      userConfirmed: result.UserConfirmed ?? false,
    };
  } catch (error) {
    mapCognitoAuthError(error);
  }
}

export async function confirmUserRegistration(
  email: string,
  confirmationCode: string
) {
  try {
    await cognitoClient.send(
      new ConfirmSignUpCommand({
        ClientId: getCognitoClientId(),
        Username: email,
        ConfirmationCode: confirmationCode,
      })
    );

    return {
      email,
      confirmed: true,
    };
  } catch (error) {
    mapCognitoAuthError(error);
  }
}

export async function resendUserConfirmationCode(email: string) {
  try {
    await cognitoClient.send(
      new ResendConfirmationCodeCommand({
        ClientId: getCognitoClientId(),
        Username: email,
      })
    );

    return {
      email,
      resent: true,
    };
  } catch (error) {
    mapResendConfirmationError(error);
  }
}

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        ClientId: getCognitoClientId(),
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      })
    );

    if (!result.AuthenticationResult?.IdToken) {
      throw new HttpError(401, "Invalid email or password");
    }

    return {
      idToken: result.AuthenticationResult.IdToken,
      accessToken: result.AuthenticationResult.AccessToken ?? "",
      refreshToken: result.AuthenticationResult.RefreshToken,
      expiresIn: result.AuthenticationResult.ExpiresIn,
      tokenType: result.AuthenticationResult.TokenType,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    mapCognitoAuthError(error);
  }
}
