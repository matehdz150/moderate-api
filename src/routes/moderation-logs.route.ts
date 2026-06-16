import { listModerationLogsByProject } from "../repositories/moderation-log.repository.js";
import type { AuthContext } from "../types/auth.types.js";
import { ok } from "../utils/http-response.js";

export async function moderationLogsRoute(authContext: AuthContext) {
  const logs = await listModerationLogsByProject(authContext.projectId);

  return ok({
    logs,
  });
}
