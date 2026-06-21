import { ulid } from "ulid";

export function buildRedactedImageKey(accountId: string, projectId: string) {
  return `accounts/${accountId}/projects/${projectId}/redacted/${ulid()}.jpg`;
}
