import { ulid } from "ulid";

import type { AuthContext } from "../types/auth.types.js";
import { HttpError } from "./http-response.js";

export function getAllowedImagePrefix(accountId: string, projectId: string) {
  return `accounts/${accountId}/projects/${projectId}/uploads/`;
}

export function buildUploadImageKey(accountId: string, projectId: string) {
  return `${getAllowedImagePrefix(accountId, projectId)}${ulid()}.jpg`;
}

export function assertImageKeyBelongsToProject(
  imageKey: string,
  authContext: AuthContext
): void {
  const allowedPrefix = getAllowedImagePrefix(
    authContext.accountId,
    authContext.projectId
  );

  if (!imageKey.startsWith(allowedPrefix)) {
    throw new HttpError(403, "You do not have access to this image");
  }
}
