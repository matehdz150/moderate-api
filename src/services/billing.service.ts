import Stripe from "stripe";

import { updateApiKeysPlanByAccount } from "../auth/api-key.repository.js";
import {
  getAccountById,
  updateAccountBillingChange,
  updateAccountStripeCustomerId,
} from "../repositories/account.repository.js";
import { updateProjectsPlanByAccount } from "../repositories/project.repository.js";
import { markBillingEventProcessed } from "../repositories/billing-event.repository.js";
import type { AccountRecord, PlanId } from "../types/account.types.js";
import type { PaidPlanId } from "../types/billing.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { HttpError } from "../utils/http-response.js";
import { changeAccountPlan, ensureAccountForUser } from "./account.service.js";
import { getPlanConfig, isPlanId } from "./plan.service.js";

let stripeClient: Stripe | null = null;

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(name + " is not configured");
  }

  return value;
}

function getStripe() {
  if (!stripeClient) {
    stripeClient = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
  }

  return stripeClient;
}

function getAppUrl() {
  return process.env.VISORA_APP_URL ?? "https://visoracloud.com";
}

function getSuccessUrl() {
  return process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? getAppUrl() + "/dashboard/?billing=success";
}

function getCancelUrl() {
  return process.env.STRIPE_CHECKOUT_CANCEL_URL ?? getAppUrl() + "/pricing/?billing=cancelled";
}

function getPortalReturnUrl() {
  return process.env.STRIPE_PORTAL_RETURN_URL ?? getAppUrl() + "/dashboard/?billing=portal";
}

export function getStripePriceIdForPlan(planId: PlanId) {
  if (planId === "starter") return process.env.STRIPE_PRICE_STARTER;
  if (planId === "growth") return process.env.STRIPE_PRICE_GROWTH;
  if (planId === "scale") return process.env.STRIPE_PRICE_SCALE;
  return undefined;
}

function getPlanIdForStripePrice(priceId: string): PlanId | null {
  const entries: Array<[PlanId, string | undefined]> = [
    ["starter", process.env.STRIPE_PRICE_STARTER],
    ["growth", process.env.STRIPE_PRICE_GROWTH],
    ["scale", process.env.STRIPE_PRICE_SCALE],
  ];

  return entries.find(([, value]) => value === priceId)?.[0] ?? null;
}

function parsePaidPlanId(value: unknown): PaidPlanId {
  if (!isPlanId(value) || value === "free") {
    throw new HttpError(400, "planId must be one of: starter, growth, scale");
  }

  return value;
}

export function parseCheckoutPlanId(value: unknown): PaidPlanId {
  return parsePaidPlanId(value);
}

export function parseBillingChangePlanId(value: unknown): PlanId {
  if (!isPlanId(value)) {
    throw new HttpError(400, "planId must be one of: free, starter, growth, scale");
  }

  return value;
}

function getPlanRank(planId: PlanId) {
  return getPlanConfig(planId).priceUsd;
}

function getPlanChangeDirection(currentPlanId: PlanId, targetPlanId: PlanId) {
  if (currentPlanId === targetPlanId) return "same";
  return getPlanRank(targetPlanId) > getPlanRank(currentPlanId) ? "upgrade" : "downgrade";
}

function getSubscriptionItem(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];

  if (!item) {
    throw new HttpError(409, "Subscription has no billable item");
  }

  return item;
}

function getCurrentPlanIdFromSubscription(subscription: Stripe.Subscription): PlanId {
  const priceId = getSubscriptionItem(subscription).price.id;
  return getPlanIdForStripePrice(priceId) ?? "free";
}

function getPeriodEndIso(subscription: Stripe.Subscription) {
  return getSubscriptionCurrentPeriodEnd(subscription) ?? new Date().toISOString();
}

async function updatePlanDependents(account: AccountRecord) {
  const updatedAt = new Date().toISOString();

  await Promise.all([
    updateProjectsPlanByAccount({
      accountId: account.accountId,
      planId: account.planId,
      monthlyLimit: account.monthlyLimit,
      updatedAt,
    }),
    updateApiKeysPlanByAccount({
      accountId: account.accountId,
      planId: account.planId,
      monthlyLimit: account.monthlyLimit,
    }),
  ]);
}


async function ensureStripeCustomer(account: AccountRecord) {
  if (account.stripeCustomerId) {
    return account.stripeCustomerId;
  }

  const customer = await getStripe().customers.create({
    email: account.email,
    metadata: {
      accountId: account.accountId,
      userId: account.userId,
    },
  });

  await updateAccountStripeCustomerId({
    accountId: account.accountId,
    stripeCustomerId: customer.id,
    updatedAt: new Date().toISOString(),
  });

  return customer.id;
}

export async function createSubscriptionIntent(params: {
  authContext: CognitoAuthContext;
  planId: PaidPlanId;
}) {
  const account = await ensureAccountForUser({
    userId: params.authContext.userId,
    email: params.authContext.email,
  });
  const accountId = account.accountId;
  const priceId = getStripePriceIdForPlan(params.planId);

  if (!priceId) {
    throw new HttpError(500, "Stripe price is not configured for this plan");
  }

  if (account.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(account.stripeSubscriptionStatus ?? "")) {
    throw new HttpError(400, "Use the billing portal to change an active subscription");
  }

  const customerId = await ensureStripeCustomer(account);
  const existingSubscriptions = await getStripe().subscriptions.list({
    customer: customerId,
    status: "incomplete",
    limit: 10,
    expand: ["data.latest_invoice.payment_intent"],
  });
  const reusableSubscription = existingSubscriptions.data.find((subscription) =>
    subscription.items.data.some((item) => item.price.id === priceId)
  );
  const subscription = reusableSubscription ?? await getStripe().subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
    },
    metadata: {
      accountId,
      planId: params.planId,
    },
    expand: ["latest_invoice.payment_intent"],
  });
  const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  const paymentIntent = invoice && typeof (invoice as any).payment_intent === "object"
    ? (invoice as any).payment_intent
    : null;
  const clientSecret = typeof paymentIntent?.client_secret === "string"
    ? paymentIntent.client_secret
    : undefined;

  if (!clientSecret) {
    throw new HttpError(502, "Stripe did not return a payment client secret");
  }

  return {
    clientSecret,
    subscriptionId: subscription.id,
    customerId,
    planId: params.planId,
  };
}

export async function createCheckoutSession(params: {
  authContext: CognitoAuthContext;
  planId: PaidPlanId;
}) {
  const account = await ensureAccountForUser({
    userId: params.authContext.userId,
    email: params.authContext.email,
  });
  const accountId = account.accountId;
  const priceId = getStripePriceIdForPlan(params.planId);

  if (!priceId) {
    throw new HttpError(500, "Stripe price is not configured for this plan");
  }

  const customerId = await ensureStripeCustomer(account);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: accountId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: getSuccessUrl(),
    cancel_url: getCancelUrl(),
    metadata: {
      accountId,
      planId: params.planId,
    },
    subscription_data: {
      metadata: {
        accountId,
        planId: params.planId,
      },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new HttpError(502, "Stripe did not return a checkout URL");
  }

  return {
    url: session.url,
  };
}

export async function changeBillingPlan(params: {
  authContext: CognitoAuthContext;
  planId: PlanId;
}) {
  const account = await ensureAccountForUser({
    userId: params.authContext.userId,
    email: params.authContext.email,
  });

  if (params.planId === account.planId && !account.stripePendingPlanId) {
    return {
      account,
      changeType: "none" as const,
      effectiveAt: account.stripeCurrentPeriodEnd,
    };
  }

  if (params.planId !== "free" && !getStripePriceIdForPlan(params.planId)) {
    throw new HttpError(500, "Stripe price is not configured for this plan");
  }

  if (!account.stripeCustomerId || !account.stripeSubscriptionId) {
    if (params.planId === "free") {
      const updatedAccount = await changeAccountPlan({
        accountId: account.accountId,
        planId: "free",
        stripeCustomerId: account.stripeCustomerId,
        stripePendingPlanId: null,
        stripePlanChangeEffectiveAt: null,
        stripeScheduleId: null,
        stripeCancelAtPeriodEnd: null,
      });
      await updatePlanDependents(updatedAccount);

      return {
        account: updatedAccount,
        changeType: "immediate" as const,
        effectiveAt: new Date().toISOString(),
      };
    }

    throw new HttpError(409, "Complete checkout before changing to this plan");
  }

  let subscription = await getStripe().subscriptions.retrieve(account.stripeSubscriptionId);

  if (["canceled", "incomplete_expired"].includes(subscription.status)) {
    throw new HttpError(409, "Subscription is not active. Start a new checkout for this plan");
  }

  const currentPlanId = getCurrentPlanIdFromSubscription(subscription);
  const targetPlanId = params.planId;
  const direction = getPlanChangeDirection(currentPlanId, targetPlanId);

  if (direction === "same") {
    if (subscription.cancel_at_period_end || account.stripePendingPlanId) {
      subscription = await getStripe().subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
        metadata: {
          ...subscription.metadata,
          pendingPlanId: "",
          pendingEffectiveAt: "",
        },
      });

      if (subscription.schedule && typeof subscription.schedule === "string") {
        await getStripe().subscriptionSchedules.release(subscription.schedule);
      }
    }

    const updatedAccount = await updateAccountBillingChange({
      accountId: account.accountId,
      stripePendingPlanId: null,
      stripePlanChangeEffectiveAt: null,
      stripeScheduleId: null,
      stripeCancelAtPeriodEnd: false,
      stripeSubscriptionStatus: subscription.status,
      stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
      updatedAt: new Date().toISOString(),
    });

    return {
      account: updatedAccount,
      changeType: "none" as const,
      effectiveAt: getSubscriptionCurrentPeriodEnd(subscription),
    };
  }

  if (targetPlanId === "free") {
    if (subscription.schedule && typeof subscription.schedule === "string") {
      await getStripe().subscriptionSchedules.release(subscription.schedule);
    }

    subscription = await getStripe().subscriptions.update(subscription.id, {
      cancel_at_period_end: true,
      metadata: {
        ...subscription.metadata,
        accountId: account.accountId,
        pendingPlanId: "free",
        pendingEffectiveAt: getPeriodEndIso(subscription),
      },
    });

    const updatedAccount = await updateAccountBillingChange({
      accountId: account.accountId,
      stripePendingPlanId: "free",
      stripePlanChangeEffectiveAt: getPeriodEndIso(subscription),
      stripeScheduleId: null,
      stripeCancelAtPeriodEnd: true,
      stripeSubscriptionStatus: subscription.status,
      stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
      updatedAt: new Date().toISOString(),
    });

    return {
      account: updatedAccount,
      changeType: "scheduled" as const,
      effectiveAt: getPeriodEndIso(subscription),
    };
  }

  const targetPriceId = getStripePriceIdForPlan(targetPlanId);

  if (!targetPriceId) {
    throw new HttpError(500, "Stripe price is not configured for this plan");
  }

  const item = getSubscriptionItem(subscription);

  if (direction === "upgrade") {
    if (subscription.schedule && typeof subscription.schedule === "string") {
      await getStripe().subscriptionSchedules.release(subscription.schedule);
    }

    subscription = await getStripe().subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
      items: [{ id: item.id, price: targetPriceId, quantity: item.quantity ?? 1 }],
      metadata: {
        ...subscription.metadata,
        accountId: account.accountId,
        planId: targetPlanId,
        pendingPlanId: "",
        pendingEffectiveAt: "",
      },
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    });

    await updateAccountFromSubscription(subscription);
    const updatedAccount = (await getAccountById(account.accountId)) ?? account;

    return {
      account: updatedAccount,
      changeType: "immediate" as const,
      effectiveAt: new Date().toISOString(),
    };
  }

  if (subscription.cancel_at_period_end) {
    subscription = await getStripe().subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
    });
  }

  let scheduleId = typeof subscription.schedule === "string" ? subscription.schedule : undefined;

  if (!scheduleId) {
    const schedule = await getStripe().subscriptionSchedules.create({
      from_subscription: subscription.id,
    });
    scheduleId = schedule.id;
  }

  const schedule = await getStripe().subscriptionSchedules.retrieve(scheduleId);
  const currentPhase = schedule.current_phase;
  const phaseStart = currentPhase?.start_date ?? Math.floor(Date.now() / 1000);
  const phaseEnd = currentPhase?.end_date ?? item.current_period_end;

  if (!phaseEnd) {
    throw new HttpError(409, "Subscription period end is not available");
  }

  await getStripe().subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        start_date: phaseStart,
        end_date: phaseEnd,
        items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
        metadata: {
          accountId: account.accountId,
          planId: currentPlanId,
          pendingPlanId: targetPlanId,
          pendingEffectiveAt: new Date(phaseEnd * 1000).toISOString(),
        },
      },
      {
        start_date: phaseEnd,
        items: [{ price: targetPriceId, quantity: item.quantity ?? 1 }],
        proration_behavior: "none",
        metadata: {
          accountId: account.accountId,
          planId: targetPlanId,
          pendingPlanId: "",
          pendingEffectiveAt: "",
        },
      },
    ],
  } as any);

  const effectiveAt = new Date(phaseEnd * 1000).toISOString();
  const updatedAccount = await updateAccountBillingChange({
    accountId: account.accountId,
    stripePendingPlanId: targetPlanId,
    stripePlanChangeEffectiveAt: effectiveAt,
    stripeScheduleId: scheduleId,
    stripeCancelAtPeriodEnd: false,
    stripeSubscriptionStatus: subscription.status,
    stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
    updatedAt: new Date().toISOString(),
  });

  return {
    account: updatedAccount,
    changeType: "scheduled" as const,
    effectiveAt,
  };
}

export async function createPortalSession(authContext: CognitoAuthContext) {
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });

  if (!account?.stripeCustomerId) {
    throw new HttpError(400, "No billing customer exists for this account");
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: getPortalReturnUrl(),
  });

  return {
    url: session.url,
  };
}

function getSubscriptionCurrentPeriodEnd(subscription: Stripe.Subscription) {
  const periodEnd = subscription.items.data[0]?.current_period_end;

  return typeof periodEnd === "number"
    ? new Date(periodEnd * 1000).toISOString()
    : undefined;
}

async function updateAccountFromSubscription(subscription: Stripe.Subscription) {
  const accountId =
    typeof subscription.metadata.accountId === "string"
      ? subscription.metadata.accountId
      : undefined;
  const priceId = subscription.items.data[0]?.price.id;

  if (!accountId || !priceId) {
    return;
  }

  const account = await getAccountById(accountId);

  if (!account) {
    return;
  }

  const status = subscription.status;
  const paidPlanId = getPlanIdForStripePrice(priceId);
  const activeStatus = ["active", "trialing", "past_due"].includes(status);
  const planId: PlanId = paidPlanId && activeStatus ? paidPlanId : "free";
  const metadataPendingPlanId = isPlanId(subscription.metadata.pendingPlanId)
    ? subscription.metadata.pendingPlanId
    : null;
  const existingPendingPlanId = account.stripePendingPlanId && account.stripePendingPlanId !== planId
    ? account.stripePendingPlanId
    : null;
  const pendingPlanId = metadataPendingPlanId ?? existingPendingPlanId;
  const pendingEffectiveAt = subscription.metadata.pendingEffectiveAt || account.stripePlanChangeEffectiveAt || null;
  const hasPendingChange = pendingPlanId && pendingPlanId !== planId;
  const updatedAccount = await changeAccountPlan({
    accountId,
    planId,
    stripeCustomerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: status,
    stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
    stripePendingPlanId: hasPendingChange ? pendingPlanId : null,
    stripePlanChangeEffectiveAt: hasPendingChange ? pendingEffectiveAt : null,
    stripeScheduleId: typeof subscription.schedule === "string" ? subscription.schedule : null,
    stripeCancelAtPeriodEnd: subscription.cancel_at_period_end,
  });

  await updatePlanDependents(updatedAccount);
}

export async function syncBillingAccount(authContext: CognitoAuthContext) {
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });

  if (!account.stripeCustomerId) {
    return account;
  }

  const subscriptions = await getStripe().subscriptions.list({
    customer: account.stripeCustomerId,
    status: "all",
    limit: 10,
  });
  const subscription = subscriptions.data
    .filter((item) => !["canceled", "incomplete_expired"].includes(item.status))
    .sort((a, b) => b.created - a.created)[0];

  if (!subscription) {
    if (account.planId !== "free" || account.stripeSubscriptionStatus) {
      return changeAccountPlan({
        accountId: account.accountId,
        planId: "free",
        stripeCustomerId: account.stripeCustomerId,
        stripeSubscriptionStatus: "none",
      });
    }

    return account;
  }

  await updateAccountFromSubscription(subscription);

  return (await getAccountById(account.accountId)) ?? account;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!subscriptionId) {
    return;
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);

  await updateAccountFromSubscription(subscription);
}

export async function processStripeWebhook(params: {
  body: string | Buffer;
  signature: string;
}) {
  const event = getStripe().webhooks.constructEvent(
    params.body,
    params.signature,
    requiredEnv("STRIPE_WEBHOOK_SECRET")
  );
  const shouldProcess = await markBillingEventProcessed({
    stripeEventId: event.id,
    type: event.type,
    processedAt: new Date().toISOString(),
  });

  if (!shouldProcess) {
    return {
      received: true,
      duplicate: true,
    };
  }

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await updateAccountFromSubscription(event.data.object as Stripe.Subscription);
  }

  return {
    received: true,
  };
}
