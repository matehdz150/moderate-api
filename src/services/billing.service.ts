import Stripe from "stripe";

import { updateApiKeysPlanByAccount } from "../auth/api-key.repository.js";
import {
  getAccountById,
  updateAccountStripeCustomerId,
} from "../repositories/account.repository.js";
import { updateProjectsPlanByAccount } from "../repositories/project.repository.js";
import { markBillingEventProcessed } from "../repositories/billing-event.repository.js";
import type { AccountRecord, PlanId } from "../types/account.types.js";
import type { PaidPlanId } from "../types/billing.types.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { getDashboardAccountId } from "../utils/dashboard-account.js";
import { HttpError } from "../utils/http-response.js";
import { changeAccountPlan, ensureAccountForUser } from "./account.service.js";
import { isPlanId } from "./plan.service.js";

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

export async function createCheckoutSession(params: {
  authContext: CognitoAuthContext;
  planId: PaidPlanId;
}) {
  const accountId = getDashboardAccountId(params.authContext.userId);
  const account = await ensureAccountForUser({
    userId: params.authContext.userId,
    email: params.authContext.email,
  });
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

export async function createPortalSession(authContext: CognitoAuthContext) {
  const accountId = getDashboardAccountId(authContext.userId);
  const account = await getAccountById(accountId);

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
  const planId: PlanId =
    paidPlanId && ["active", "trialing", "past_due"].includes(status)
      ? paidPlanId
      : "free";
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
  });
  const updatedAt = new Date().toISOString();

  await Promise.all([
    updateProjectsPlanByAccount({
      accountId,
      planId: updatedAccount.planId,
      monthlyLimit: updatedAccount.monthlyLimit,
      updatedAt,
    }),
    updateApiKeysPlanByAccount({
      accountId,
      planId: updatedAccount.planId,
      monthlyLimit: updatedAccount.monthlyLimit,
    }),
  ]);
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
