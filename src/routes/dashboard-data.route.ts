import { listApiKeysByAccount } from "../auth/api-key.repository.js";
import { getCurrentMonthUsage } from "../auth/usage.repository.js";
import {
  countModerationLogsByProjectSince,
  listModerationLogsByProject,
} from "../repositories/moderation-log.repository.js";
import { getPolicyByProjectId } from "../repositories/policy.repository.js";
import { listProjectsByAccount } from "../repositories/project.repository.js";
import { getDefaultModerationPolicy } from "../services/policy-engine.service.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createImageReadUrl } from "../services/s3.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { ModerationLogRecord } from "../types/moderation.types.js";
import { toDashboardApiKey } from "../utils/api-key-presenter.js";
import { ok } from "../utils/http-response.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;

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
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const accountId = account.accountId;
  const projects = await listProjectsByAccount(accountId);
  const apiKeys = await listApiKeysByAccount(accountId);
  const usage = await getCurrentMonthUsage(accountId);
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
  const requestsUsed = usage?.requestsUsed ?? 0;
  const overageEnabled = usage?.overageEnabled ?? account.planId !== "free";
  const overageRequests = overageEnabled
    ? Math.max(0, requestsUsed - account.monthlyLimit)
    : 0;
  const overagePriceCentsPerThousand =
    usage?.overagePriceCentsPerThousand ?? 0;
  const estimatedOverageCents = Math.ceil(
    (overageRequests / 1000) * overagePriceCentsPerThousand
  );

  return ok({
    account: {
      accountId: account.accountId,
      email: account.email,
      userId: account.userId,
      planId: account.planId,
      monthlyLimit: account.monthlyLimit,
      projectLimit: account.projectLimit,
      apiKeyLimit: account.apiKeyLimit,
      logRetentionDays: account.logRetentionDays,
      stripeCustomerId: account.stripeCustomerId,
      stripeSubscriptionId: account.stripeSubscriptionId,
      stripeSubscriptionStatus: account.stripeSubscriptionStatus,
      stripeCurrentPeriodEnd: account.stripeCurrentPeriodEnd,
    },
    projects: projects.map((project) => ({
      ...project,
      monthModerations: monthlyCountByProject.get(project.projectId) ?? 0,
    })),
    apiKeys: apiKeys.map(toDashboardApiKey),
    policies,
    moderationLogs: moderationLogsWithImageUrls,
    stats: {
      imagesModerated: imagesModeratedThisMonth,
      rejected: moderationLogs.filter((log) => log.action === "reject").length,
      review: moderationLogs.filter((log) => log.action === "review").length,
      activeProjects: projects.length,
    },
    usage: {
      month: usage?.month ?? new Date().toISOString().slice(0, 7),
      requestsUsed,
      monthlyLimit: account.monthlyLimit,
      overageEnabled,
      overageRequests,
      overagePriceCentsPerThousand,
      estimatedOverageCents,
    },
  });
}
