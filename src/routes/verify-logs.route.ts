import type { APIGatewayProxyEvent } from "aws-lambda";

import { getProjectById } from "../repositories/project.repository.js";
import { listVerifyLogsByProject } from "../repositories/verify-log.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createImageReadUrl } from "../services/s3.service.js";
import type { AuthContext } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { VerifyLogEntry, VerifyLogRecord } from "../types/verify.types.js";
import { HttpError, ok } from "../utils/http-response.js";

const IMAGES_BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

async function withImageUrls(
  logs: VerifyLogRecord[]
): Promise<VerifyLogEntry[]> {
  return Promise.all(
    logs.map(async (log) => {
      const [documentImageUrl, selfieImageUrl] = await Promise.all([
        IMAGES_BUCKET_NAME
          ? createImageReadUrl(IMAGES_BUCKET_NAME, log.documentImageKey).catch(() => undefined)
          : Promise.resolve(undefined),
        IMAGES_BUCKET_NAME
          ? createImageReadUrl(IMAGES_BUCKET_NAME, log.selfieImageKey).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);

      return {
        ...log,
        ...(documentImageUrl ? { documentImageUrl } : {}),
        ...(selfieImageUrl ? { selfieImageUrl } : {}),
      };
    })
  );
}

export async function verifyLogsRoute(authContext: AuthContext) {
  const logs = await listVerifyLogsByProject(authContext.projectId);

  return ok({ logs: await withImageUrls(logs) });
}

export async function dashboardVerifyLogsRoute(
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

  if (project.projectType !== "verify") {
    throw new HttpError(400, "Selected project is not a verify project");
  }

  const logs = await listVerifyLogsByProject(projectId);

  return ok({ logs: await withImageUrls(logs) });
}
