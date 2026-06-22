import type { APIGatewayProxyEvent } from "aws-lambda";

import { getProjectById } from "../repositories/project.repository.js";
import { listRedactionLogsByProject } from "../repositories/redaction-log.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createImageReadUrl } from "../services/s3.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { RedactionLogEntry, RedactionLogRecord } from "../types/redaction.types.js";
import { HttpError, ok } from "../utils/http-response.js";

const ORIGINAL_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const REDACTED_BUCKET_NAME = process.env.REDACTED_IMAGES_BUCKET_NAME;

async function withImageUrls(
  logs: RedactionLogRecord[]
): Promise<RedactionLogEntry[]> {
  return Promise.all(
    logs.map(async (log) => {
      const [imageUrl, redactedImageUrl] = await Promise.all([
        ORIGINAL_BUCKET_NAME
          ? createImageReadUrl(ORIGINAL_BUCKET_NAME, log.imageKey).catch(() => undefined)
          : Promise.resolve(undefined),
        REDACTED_BUCKET_NAME
          ? createImageReadUrl(REDACTED_BUCKET_NAME, log.redactedImageKey).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);

      return {
        ...log,
        ...(imageUrl ? { imageUrl } : {}),
        ...(redactedImageUrl ? { redactedImageUrl } : {}),
      };
    })
  );
}

export async function redactionLogsRoute(authContext: AuthContext) {
  const logs = await listRedactionLogsByProject(authContext.projectId);

  return ok({ logs: await withImageUrls(logs) });
}

export async function dashboardRedactionLogsRoute(
  event: APIGatewayProxyEvent,
  cognitoContext: CognitoAuthContext
) {
  const projectId = event.queryStringParameters?.projectId?.trim();

  if (!projectId) {
    throw new HttpError(400, "projectId query parameter is required");
  }

  const account = await ensureAccountForUser({
    userId: cognitoContext.userId,
    email: cognitoContext.email,
  });

  const project = await getProjectById({
    accountId: account.accountId,
    projectId,
  });

  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  if (project.projectType !== "redaction") {
    throw new HttpError(400, "Selected project is not a redaction project");
  }

  const logs = await listRedactionLogsByProject(projectId);

  return ok({ logs: await withImageUrls(logs) });
}
