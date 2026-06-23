import { incrementVerificationUsage } from "../auth/usage.repository.js";
import { getAccountById } from "../repositories/account.repository.js";
import { getVerifyAllowance } from "./plan.service.js";
import { chargeVerifyOverage } from "./verify-billing.service.js";

/**
 * Records one verification against the account's monthly counter (separate from
 * the shared request limit) and, for paid plans over their included allotment,
 * charges the per-verification overage to Stripe. Best-effort: a billing
 * failure is logged but never fails the verification.
 */
export async function recordVerificationUsage(params: {
  accountId: string;
  planId: string;
}): Promise<void> {
  const newCount = await incrementVerificationUsage({
    accountId: params.accountId,
    planId: params.planId,
  });

  const { included, overageCents } = getVerifyAllowance(params.planId);

  if (overageCents <= 0 || newCount <= included) {
    return;
  }

  try {
    const account = await getAccountById(params.accountId);

    if (account?.stripeCustomerId) {
      await chargeVerifyOverage({
        stripeCustomerId: account.stripeCustomerId,
        cents: overageCents,
        accountId: params.accountId,
      });
    }
  } catch (error) {
    console.error("Failed to charge verify overage", error);
  }
}
