import type { APIGatewayProxyEvent } from "aws-lambda";

import {
  changeBillingPlan,
  createCheckoutSession,
  createPortalSession,
  createSubscriptionIntent,
  parseBillingChangePlanId,
  parseCheckoutPlanId,
  processStripeWebhook,
  syncBillingAccount,
} from "../services/billing.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import { badRequest, ok, HttpError } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";
import { logError } from "../utils/structured-log.js";

function getHeader(event: APIGatewayProxyEvent, headerName: string) {
  const requestedHeader = headerName.toLowerCase();

  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (name.toLowerCase() === requestedHeader) {
      return value;
    }
  }

  return undefined;
}

function getRawBody(event: APIGatewayProxyEvent) {
  if (!event.body) {
    throw new HttpError(400, "Request body is required");
  }

  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : event.body;
}

export async function createSubscriptionIntentRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const planId = parseCheckoutPlanId(body.planId);
  const intent = await createSubscriptionIntent({ authContext, planId });

  return ok(intent);
}

export async function createCheckoutSessionRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const planId = parseCheckoutPlanId(body.planId);
  const session = await createCheckoutSession({ authContext, planId });

  return ok(session);
}

export async function changeBillingPlanRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const planId = parseBillingChangePlanId(body.planId);
  const result = await changeBillingPlan({ authContext, planId });

  return ok({
    account: {
      accountId: result.account.accountId,
      email: result.account.email,
      userId: result.account.userId,
      planId: result.account.planId,
      monthlyLimit: result.account.monthlyLimit,
      projectLimit: result.account.projectLimit,
      apiKeyLimit: result.account.apiKeyLimit,
      logRetentionDays: result.account.logRetentionDays,
      stripeCustomerId: result.account.stripeCustomerId,
      stripeSubscriptionId: result.account.stripeSubscriptionId,
      stripeSubscriptionStatus: result.account.stripeSubscriptionStatus,
      stripeCurrentPeriodEnd: result.account.stripeCurrentPeriodEnd,
      stripePendingPlanId: result.account.stripePendingPlanId,
      stripePlanChangeEffectiveAt: result.account.stripePlanChangeEffectiveAt,
      stripeScheduleId: result.account.stripeScheduleId,
      stripeCancelAtPeriodEnd: result.account.stripeCancelAtPeriodEnd,
    },
    changeType: result.changeType,
    effectiveAt: result.effectiveAt,
  });
}

export async function createPortalSessionRoute(
  authContext: CognitoAuthContext
) {
  const session = await createPortalSession(authContext);

  return ok(session);
}

export async function syncBillingRoute(authContext: CognitoAuthContext) {
  const account = await syncBillingAccount(authContext);

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
      stripePendingPlanId: account.stripePendingPlanId,
      stripePlanChangeEffectiveAt: account.stripePlanChangeEffectiveAt,
      stripeScheduleId: account.stripeScheduleId,
      stripeCancelAtPeriodEnd: account.stripeCancelAtPeriodEnd,
    },
  });
}

export async function stripeWebhookRoute(event: APIGatewayProxyEvent) {
  const signature = getHeader(event, "stripe-signature");

  if (!signature) {
    return badRequest("Missing Stripe signature");
  }

  try {
    const result = await processStripeWebhook({
      body: getRawBody(event),
      signature,
    });

    return ok(result);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode >= 500) {
      logError("stripe_webhook_error", {
        requestId: event.requestContext.requestId,
        route: "POST /billing/webhook",
        error,
      });
    }

    throw error;
  }
}
