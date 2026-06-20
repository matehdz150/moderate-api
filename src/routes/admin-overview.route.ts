import { countModerationLogsByProjectSince } from "../repositories/moderation-log.repository.js";
import {
  getCurrentUsageMonth,
  listAdminAccounts,
  listAdminApiKeys,
  listAdminCurrentMonthUsage,
  listAdminFailedWebhookEvents,
  listAdminProjects,
} from "../repositories/admin.repository.js";
import { listRecentStructuredErrors } from "../repositories/system-log.repository.js";
import type { AdminAccountSummary, AdminSystemError, AdminWebhookFailure } from "../types/admin.types.js";
import type { ApiKeyRecord, UsageRecord } from "../types/auth.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { ProjectRecord } from "../types/project.types.js";
import type { WebhookEventRecord } from "../types/webhook.types.js";
import { HttpError, ok } from "../utils/http-response.js";

const ADMIN_SCAN_LIMIT = 1000;

function getMonthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function assertAdminAccess(authContext: CognitoAuthContext) {
  const adminEmails = getAdminEmails();

  if (adminEmails.length === 0) {
    throw new HttpError(403, "Admin access is not configured");
  }

  if (!adminEmails.includes(authContext.email.toLowerCase())) {
    throw new HttpError(403, "Admin access required");
  }
}

function buildAccountSummary(params: {
  account: Awaited<ReturnType<typeof listAdminAccounts>>[number];
  usage?: UsageRecord;
  projects: ProjectRecord[];
  apiKeys: ApiKeyRecord[];
}): AdminAccountSummary {
  const requestsUsed = params.usage?.requestsUsed ?? 0;
  const monthlyLimit = params.account.monthlyLimit || 0;
  const usagePercent = monthlyLimit > 0 ? Math.round((requestsUsed / monthlyLimit) * 1000) / 10 : 0;

  return {
    accountId: params.account.accountId,
    email: params.account.email,
    userId: params.account.userId,
    planId: params.account.planId,
    monthlyLimit,
    projectLimit: params.account.projectLimit,
    apiKeyLimit: params.account.apiKeyLimit,
    logRetentionDays: params.account.logRetentionDays,
    createdAt: params.account.createdAt,
    updatedAt: params.account.updatedAt,
    projectsCount: params.projects.length,
    activeApiKeys: params.apiKeys.filter((key) => key.status === "active").length,
    revokedApiKeys: params.apiKeys.filter((key) => key.status === "revoked").length,
    requestsUsed,
    usagePercent,
  };
}

function mapFailedWebhook(event: WebhookEventRecord): AdminWebhookFailure {
  return {
    eventId: event.eventId,
    type: event.type,
    accountId: event.accountId,
    projectId: event.projectId,
    status: event.status,
    attempts: event.attempts,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    lastAttemptAt: event.lastAttemptAt,
    lastError: event.lastError,
  };
}

export async function adminOverviewRoute(authContext: CognitoAuthContext) {
  assertAdminAccess(authContext);

  const month = getCurrentUsageMonth();
  const monthStart = getMonthStartIso();
  const [accounts, projects, apiKeys, usageRecords, failedWebhookRecords] =
    await Promise.all([
      listAdminAccounts(ADMIN_SCAN_LIMIT),
      listAdminProjects(ADMIN_SCAN_LIMIT),
      listAdminApiKeys(ADMIN_SCAN_LIMIT),
      listAdminCurrentMonthUsage(month, ADMIN_SCAN_LIMIT),
      listAdminFailedWebhookEvents(50),
    ]);

  const projectsByAccount = new Map<string, ProjectRecord[]>();
  for (const project of projects) {
    const accountProjects = projectsByAccount.get(project.accountId) ?? [];
    accountProjects.push(project);
    projectsByAccount.set(project.accountId, accountProjects);
  }

  const apiKeysByAccount = new Map<string, ApiKeyRecord[]>();
  for (const apiKey of apiKeys) {
    const accountApiKeys = apiKeysByAccount.get(apiKey.accountId) ?? [];
    accountApiKeys.push(apiKey);
    apiKeysByAccount.set(apiKey.accountId, accountApiKeys);
  }

  const usageByAccount = new Map(
    usageRecords.map((usage) => [usage.accountId, usage])
  );

  const accountsSummary = accounts
    .map((account) =>
      buildAccountSummary({
        account,
        usage: usageByAccount.get(account.accountId),
        projects: projectsByAccount.get(account.accountId) ?? [],
        apiKeys: apiKeysByAccount.get(account.accountId) ?? [],
      })
    )
    .sort((a, b) => b.requestsUsed - a.requestsUsed);

  const projectModerationCounts = await Promise.all(
    projects.slice(0, 100).map(async (project) => ({
      accountId: project.accountId,
      projectId: project.projectId,
      name: project.name,
      planId: project.planId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      monthModerations: await countModerationLogsByProjectSince(
        project.projectId,
        monthStart
      ),
    }))
  );

  let recentErrorsUnavailable: string | undefined;
  let recentErrors: AdminSystemError[] = [];

  try {
    recentErrors = await listRecentStructuredErrors({ hours: 24, limit: 30 });
  } catch (error) {
    recentErrorsUnavailable =
      error instanceof Error ? error.message : "Could not read CloudWatch logs";
  }

  const totalRequestsUsed = usageRecords.reduce(
    (total, usage) => total + (usage.requestsUsed ?? 0),
    0
  );
  const totalMonthlyLimit = accounts.reduce(
    (total, account) => total + (account.monthlyLimit ?? 0),
    0
  );
  const usersNearLimit = accountsSummary
    .filter((account) => account.usagePercent >= 80)
    .slice(0, 20);

  return ok({
    generatedAt: new Date().toISOString(),
    usage: {
      month,
      totalRequestsUsed,
      totalMonthlyLimit,
      overageAccounts: accountsSummary.filter(
        (account) => account.monthlyLimit > 0 && account.requestsUsed > account.monthlyLimit
      ).length,
      nearLimitAccounts: usersNearLimit.length,
    },
    accounts: accountsSummary.slice(0, 50),
    topProjects: projectModerationCounts
      .sort((a, b) => b.monthModerations - a.monthModerations)
      .slice(0, 20),
    usersNearLimit,
    failedWebhooks: failedWebhookRecords
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
      .map(mapFailedWebhook),
    recentErrors,
    ...(recentErrorsUnavailable ? { recentErrorsUnavailable } : {}),
  });
}
