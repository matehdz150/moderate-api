import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type {
  WebhookEventRecord,
  WebhookEventStatus,
} from "../types/webhook.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getWebhookEventsTableName() {
  const tableName = process.env.WEBHOOK_EVENTS_TABLE_NAME;

  if (!tableName) {
    throw new Error("WEBHOOK_EVENTS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function createWebhookEvent(
  event: WebhookEventRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getWebhookEventsTableName(),
      Item: event,
      ConditionExpression: "attribute_not_exists(eventId)",
    })
  );
}

export async function getWebhookEvent(
  eventId: string
): Promise<WebhookEventRecord | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getWebhookEventsTableName(),
      Key: { eventId },
    })
  );

  return (result.Item as WebhookEventRecord | undefined) ?? null;
}

export async function listWebhookEventsByProject(params: {
  projectId: string;
  limit?: number;
}): Promise<WebhookEventRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getWebhookEventsTableName(),
      IndexName: "projectId-createdAt-index",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": params.projectId,
      },
      ScanIndexForward: false,
      Limit: params.limit ?? 50,
    })
  );

  return (result.Items as WebhookEventRecord[] | undefined) ?? [];
}

export async function markWebhookEventDelivered(params: {
  eventId: string;
  deliveredAt: string;
}): Promise<void> {
  await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getWebhookEventsTableName(),
      Key: { eventId: params.eventId },
      UpdateExpression:
        "SET #status = :status, updatedAt = :now, lastAttemptAt = :now, deliveredAt = :now REMOVE lastError ADD attempts :one",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "delivered",
        ":now": params.deliveredAt,
        ":one": 1,
      },
    })
  );
}

export async function markWebhookEventSkipped(params: {
  eventId: string;
  skippedAt: string;
  reason: string;
}): Promise<void> {
  await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getWebhookEventsTableName(),
      Key: { eventId: params.eventId },
      UpdateExpression:
        "SET #status = :status, updatedAt = :now, skippedAt = :now, lastError = :reason",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "skipped",
        ":now": params.skippedAt,
        ":reason": params.reason,
      },
    })
  );
}

export async function recordWebhookEventAttempt(params: {
  eventId: string;
  status: Extract<WebhookEventStatus, "pending" | "failed">;
  attemptedAt: string;
  lastError?: string;
}): Promise<void> {
  await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getWebhookEventsTableName(),
      Key: { eventId: params.eventId },
      UpdateExpression:
        "SET #status = :status, updatedAt = :now, lastAttemptAt = :now, lastError = :lastError ADD attempts :one",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": params.status,
        ":now": params.attemptedAt,
        ":lastError": params.lastError ?? "",
        ":one": 1,
      },
    })
  );
}

export async function markWebhookEventPending(params: {
  eventId: string;
  updatedAt: string;
}): Promise<WebhookEventRecord> {
  const result = await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getWebhookEventsTableName(),
      Key: { eventId: params.eventId },
      ConditionExpression: "attribute_exists(eventId)",
      UpdateExpression:
        "SET #status = :status, updatedAt = :updatedAt REMOVE lastError, skippedAt, deliveredAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "pending",
        ":updatedAt": params.updatedAt,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes as WebhookEventRecord;
}
