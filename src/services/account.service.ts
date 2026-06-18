import {
  createAccountRecord,
  getAccountById,
  updateAccountPlan as updateAccountPlanRecord,
} from "../repositories/account.repository.js";
import type { AccountRecord, PlanId } from "../types/account.types.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { getPlanConfig } from "./plan.service.js";

export async function createAccountForUser(params: {
  userId: string;
  email: string;
  planId: PlanId;
}): Promise<AccountRecord> {
  const now = new Date().toISOString();
  const plan = getPlanConfig(params.planId);
  const account: AccountRecord = {
    accountId: getDashboardAccountId(params.userId),
    userId: params.userId,
    email: params.email,
    planId: params.planId,
    monthlyLimit: plan.monthlyLimit,
    projectLimit: plan.projectLimit,
    apiKeyLimit: plan.apiKeyLimit,
    logRetentionDays: plan.logRetentionDays,
    createdAt: now,
    updatedAt: now,
  };

  await createAccountRecord(account);

  return account;
}

export async function ensureAccountForUser(params: {
  userId: string;
  email: string;
}): Promise<AccountRecord> {
  const accountId = getDashboardAccountId(params.userId);
  const existing = await getAccountById(accountId);

  if (existing) {
    return existing;
  }

  return createAccountForUser({
    userId: params.userId,
    email: params.email,
    planId: "free",
  });
}

export async function changeAccountPlan(params: {
  accountId: string;
  planId: PlanId;
}): Promise<AccountRecord> {
  const now = new Date().toISOString();
  const plan = getPlanConfig(params.planId);

  return updateAccountPlanRecord({
    accountId: params.accountId,
    planId: params.planId,
    monthlyLimit: plan.monthlyLimit,
    projectLimit: plan.projectLimit,
    apiKeyLimit: plan.apiKeyLimit,
    logRetentionDays: plan.logRetentionDays,
    updatedAt: now,
  });
}
