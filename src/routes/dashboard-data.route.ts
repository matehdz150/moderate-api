import { listApiKeysByAccount } from "../auth/api-key.repository.js";
import {
  countModerationLogsByProjectSince,
  listModerationLogsByProject,
} from "../repositories/moderation-log.repository.js";
import { getPolicyByProjectId } from "../repositories/policy.repository.js";
import { listProjectsByAccount } from "../repositories/project.repository.js";
import { getDefaultModerationPolicy } from "../services/policy-engine.service.js";
import { createImageReadUrl } from "../services/s3.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { ModerationLogRecord } from "../types/moderation.types.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { ok } from "../utils/http-response.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

function maskApiKeyHash(apiKeyHash: string) {
  return `${apiKeyHash.slice(0, 10)}...${apiKeyHash.slice(-6)}`;
}

function getMonthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function withImageUrls(logs: ModerationLogRecord[]) {
  if (!BUCKET_NAME) {
    return logs;
  }

  return Promise.all(
    logs.map(async (log) => ({
      ...log,
      imageUrl: await createImageReadUrl(BUCKET_NAME, log.imageKey),
    }))
  );
}

export async function dashboardDataRoute(authContext: CognitoAuthContext) {
  const accountId = getDashboardAccountId(authContext.userId);
  const projects = await listProjectsByAccount(accountId);
  const apiKeys = await listApiKeysByAccount(accountId);
  const monthStart = getMonthStartIso();
  const policies = await Promise.all(
    projects.map(async (project) =>
      (await getPolicyByProjectId(project.projectId)) ??
      getDefaultModerationPolicy(project.projectId)
    )
  );
  const monthlyCounts = await Promise.all(
    projects.map(async (project) => ({
      projectId: project.projectId,
      monthModerations: await countModerationLogsByProjectSince(
        project.projectId,
        monthStart
      ),
    }))
  );
  const logsByProject = await Promise.all(
    projects.map((project) => listModerationLogsByProject(project.projectId, 10))
  );
  const moderationLogs = logsByProject
    .flat()
    .sort((a: ModerationLogRecord, b: ModerationLogRecord) =>
      b.createdAt.localeCompare(a.createdAt)
    )
    .slice(0, 50);
  const moderationLogsWithImageUrls = await withImageUrls(moderationLogs);
  const monthlyCountByProject = new Map(
    monthlyCounts.map((item) => [item.projectId, item.monthModerations])
  );
  const imagesModeratedThisMonth = monthlyCounts.reduce(
    (total, item) => total + item.monthModerations,
    0
  );

  return ok({
    account: {
      accountId,
      email: authContext.email,
      userId: authContext.userId,
    },
    projects: projects.map((project) => ({
      ...project,
      monthModerations: monthlyCountByProject.get(project.projectId) ?? 0,
    })),
    apiKeys: apiKeys.map((apiKey) => ({
      ...apiKey,
      apiKeyHash: maskApiKeyHash(apiKey.apiKeyHash),
    })),
    policies,
    moderationLogs: moderationLogsWithImageUrls,
    stats: {
      imagesModerated: imagesModeratedThisMonth,
      rejected: moderationLogs.filter((log) => log.action === "reject").length,
      review: moderationLogs.filter((log) => log.action === "review").length,
      activeProjects: projects.length,
    },
  });
}
