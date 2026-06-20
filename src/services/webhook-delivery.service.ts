import { createHmac, timingSafeEqual } from "node:crypto";

import { listActiveWebhookEndpointsForProject } from "../repositories/webhook-endpoint.repository.js";
import {
  getWebhookEvent,
  markWebhookEventDelivered,
  markWebhookEventSkipped,
  recordWebhookEventAttempt,
} from "../repositories/webhook-event.repository.js";
import type {
  WebhookEndpointRecord,
  WebhookEventRecord,
} from "../types/webhook.types.js";

const WEBHOOK_HTTP_TIMEOUT_MS = Number(
  process.env.WEBHOOK_HTTP_TIMEOUT_MS ?? 5000
);

function signPayload(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function postWebhook(endpoint: WebhookEndpointRecord, event: WebhookEventRecord) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: event.eventId,
    type: event.type,
    createdAt: event.createdAt,
    accountId: event.accountId,
    projectId: event.projectId,
    data: event.payload,
  });
  const signature = signPayload(endpoint.secret, timestamp, body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Visora-Webhooks/1.0",
        "visora-event-id": event.eventId,
        "visora-event-type": event.type,
        "visora-timestamp": timestamp,
        "visora-signature": `v1=${signature}`,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Webhook returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function deliverWebhookEvent(eventId: string): Promise<void> {
  const event = await getWebhookEvent(eventId);

  if (!event) {
    console.warn("Webhook event not found", { eventId });
    return;
  }

  if (event.status === "delivered" || event.status === "skipped") {
    return;
  }

  const endpoints = await listActiveWebhookEndpointsForProject({
    projectId: event.projectId,
    eventType: event.type,
  });

  if (endpoints.length === 0) {
    await markWebhookEventSkipped({
      eventId,
      skippedAt: new Date().toISOString(),
      reason: "No active webhook endpoint subscribed to this event type",
    });
    return;
  }

  try {
    await Promise.all(endpoints.map((endpoint) => postWebhook(endpoint, event)));
    await markWebhookEventDelivered({
      eventId,
      deliveredAt: new Date().toISOString(),
    });
  } catch (error) {
    await recordWebhookEventAttempt({
      eventId,
      status: "failed",
      attemptedAt: new Date().toISOString(),
      lastError: getErrorMessage(error),
    });

    throw error;
  }
}

export function verifyWebhookSignature(params: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signatureHeader: string;
}) {
  const expected = `v1=${signPayload(
    params.secret,
    params.timestamp,
    params.rawBody
  )}`;
  const received = params.signatureHeader;

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
