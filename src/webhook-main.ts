import type { SQSEvent, SQSBatchResponse } from "aws-lambda";

import { deliverWebhookEvent } from "./services/webhook-delivery.service.js";
import type { WebhookQueueMessage } from "./types/webhook.types.js";
import { logError } from "./utils/structured-log.js";

function parseMessage(body: string): WebhookQueueMessage {
  const parsed = JSON.parse(body) as Partial<WebhookQueueMessage>;

  if (!parsed.eventId) {
    throw new Error("Webhook queue message is missing eventId");
  }

  return { eventId: parsed.eventId };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      const message = parseMessage(record.body);
      await deliverWebhookEvent(message.eventId);
    } catch (error) {
      logError("webhook_queue_message_failed", {
        requestId: record.messageId,
        route: "SQS webhook delivery",
        messageId: record.messageId,
        error,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
