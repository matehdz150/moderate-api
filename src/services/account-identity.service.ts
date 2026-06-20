import {
  buildIdentityKey,
  getAccountIdentity,
  listAccountIdentitiesByEmail,
  putAccountIdentity,
} from "../repositories/account-identity.repository.js";
import {
  getAccountByEmail,
  getAccountById,
} from "../repositories/account.repository.js";
import type {
  AccountIdentityProvider,
  AccountRecord,
  PlanId,
} from "../types/account.types.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { createAccountForUser } from "./account.service.js";

async function saveIdentity(params: {
  provider: AccountIdentityProvider;
  providerUserId: string;
  account: AccountRecord;
}) {
  const now = new Date().toISOString();

  await putAccountIdentity({
    identityKey: buildIdentityKey(params.provider, params.providerUserId),
    provider: params.provider,
    providerUserId: params.providerUserId,
    accountId: params.account.accountId,
    email: params.account.email.toLowerCase(),
    createdAt: now,
    updatedAt: now,
  });
}

async function findExistingAccountByEmail(email: string) {
  const identities = await listAccountIdentitiesByEmail(email);

  for (const identity of identities) {
    const account = await getAccountById(identity.accountId);

    if (account) {
      return account;
    }
  }

  return getAccountByEmail(email);
}

export async function resolveAccountForIdentity(params: {
  provider: AccountIdentityProvider;
  providerUserId: string;
  legacyUserId: string;
  email: string;
  emailVerified: boolean;
  planId?: PlanId;
}): Promise<AccountRecord> {
  const email = params.email.trim().toLowerCase();
  const identityKey = buildIdentityKey(params.provider, params.providerUserId);
  const existingIdentity = await getAccountIdentity(identityKey);

  if (existingIdentity) {
    const account = await getAccountById(existingIdentity.accountId);

    if (account) {
      return account;
    }
  }

  if (params.emailVerified) {
    const accountByEmail = await findExistingAccountByEmail(email);

    if (accountByEmail) {
      await saveIdentity({
        provider: params.provider,
        providerUserId: params.providerUserId,
        account: accountByEmail,
      });

      return accountByEmail;
    }
  }

  const legacyAccount = await getAccountById(getDashboardAccountId(params.legacyUserId));

  if (legacyAccount) {
    await saveIdentity({
      provider: params.provider,
      providerUserId: params.providerUserId,
      account: legacyAccount,
    });

    return legacyAccount;
  }

  const account = await createAccountForUser({
    userId: params.legacyUserId,
    email,
    planId: params.planId ?? "free",
  });

  await saveIdentity({
    provider: params.provider,
    providerUserId: params.providerUserId,
    account,
  });

  return account;
}
