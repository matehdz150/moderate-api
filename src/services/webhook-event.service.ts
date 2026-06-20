import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { ulid } from "ulid";

import { createWebhookEvent } from "../repositories/webhook-event.repository.js";
import type {
  WebhookEventRecord,
  WebhookEventType,
} from "../types/webhook.types.js";

const sqsClient = new SQSClient({});

function isWebhookPublishingConfigured() {
  return Boolean(
    process.env.WEBHOOK_EVENTS_TABLE_NAME && process.env.WEBHOOK_DELIVERY_QUEUE_URL
  );
}

export async function publishWebhookEvent(params: {
  type: WebhookEventType;
  accountId: string;
  projectId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!isWebhookPublishingConfigured()) {
    return;
  }

  const now = new Date().toISOString();
  const event: WebhookEventRecord = {
    eventId: "evt_" + ulid(),
    type: params.type,
    accountId: params.accountId,
    projectId: params.projectId,
    payload: params.payload,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await createWebhookEvent(event);
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: process.env.WEBHOOK_DELIVERY_QUEUE_URL,
        MessageBody: JSON.stringify({ eventId: event.eventId }),
      })
    );
  } catch (error) {
    console.error("Failed to publish webhook event", {
      type: params.type,
      projectId: params.projectId,
      error,
    });
  }
}
