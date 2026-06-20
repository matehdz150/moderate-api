import type { PlanId } from "./account.types.js";
import type { WebhookEventStatus, WebhookEventType } from "./webhook.types.js";

export interface AdminAccountSummary {
  accountId: string;
  email: string;
  userId: string;
  planId: PlanId;
  monthlyLimit: number;
  projectLimit: number;
  apiKeyLimit: number;
  logRetentionDays: number;
  createdAt: string;
  updatedAt: string;
  projectsCount: number;
  activeApiKeys: number;
  revokedApiKeys: number;
  requestsUsed: number;
  usagePercent: number;
}

export interface AdminProjectSummary {
  accountId: string;
  projectId: string;
  name: string;
  planId: string;
  monthModerations: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUsageSummary {
  month: string;
  totalRequestsUsed: number;
  totalMonthlyLimit: number;
  overageAccounts: number;
  nearLimitAccounts: number;
}

export interface AdminSystemError {
  timestamp: string;
  logGroupName: string;
  logStreamName?: string;
  event?: string;
  route?: string;
  requestId?: string;
  accountId?: string;
  projectId?: string;
  message: string;
}

export interface AdminWebhookFailure {
  eventId: string;
  type: WebhookEventType;
  accountId: string;
  projectId: string;
  status: WebhookEventStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface AdminOverviewResponse {
  generatedAt: string;
  usage: AdminUsageSummary;
  accounts: AdminAccountSummary[];
  topProjects: AdminProjectSummary[];
  usersNearLimit: AdminAccountSummary[];
  failedWebhooks: AdminWebhookFailure[];
  recentErrors: AdminSystemError[];
  recentErrorsUnavailable?: string;
}
