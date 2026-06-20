import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type {
  PublicWebhookEndpoint,
  WebhookEndpointRecord,
  WebhookEventType,
} from "../types/webhook.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getWebhookEndpointsTableName() {
  const tableName = process.env.WEBHOOK_ENDPOINTS_TABLE_NAME;

  if (!tableName) {
    throw new Error("WEBHOOK_ENDPOINTS_TABLE_NAME is not configured");
  }

  return tableName;
}

export function toPublicWebhookEndpoint(
  endpoint: WebhookEndpointRecord
): PublicWebhookEndpoint {
  const { secret: _secret, ...publicEndpoint } = endpoint;

  return publicEndpoint;
}

export async function createWebhookEndpoint(
  endpoint: WebhookEndpointRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getWebhookEndpointsTableName(),
      Item: endpoint,
      ConditionExpression: "attribute_not_exists(webhookId)",
    })
  );
}

export async function listWebhookEndpointsByAccount(params: {
  accountId: string;
  projectId?: string;
  limit?: number;
}): Promise<WebhookEndpointRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getWebhookEndpointsTableName(),
      IndexName: "accountId-createdAt-index",
      KeyConditionExpression: "accountId = :accountId",
      FilterExpression: params.projectId ? "projectId = :projectId" : undefined,
      ExpressionAttributeValues: {
        ":accountId": params.accountId,
        ...(params.projectId ? { ":projectId": params.projectId } : {}),
      },
      ScanIndexForward: false,
      Limit: params.limit ?? 100,
    })
  );

  return (result.Items as WebhookEndpointRecord[] | undefined) ?? [];
}

export async function listActiveWebhookEndpointsForProject(params: {
  projectId: string;
  eventType: WebhookEventType;
}): Promise<WebhookEndpointRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getWebhookEndpointsTableName(),
      IndexName: "projectId-status-index",
      KeyConditionExpression: "projectId = :projectId AND #status = :status",
      FilterExpression: "contains(#events, :eventType)",
      ExpressionAttributeNames: {
        "#status": "status",
        "#events": "events",
      },
      ExpressionAttributeValues: {
        ":projectId": params.projectId,
        ":status": "active",
        ":eventType": params.eventType,
      },
    })
  );

  return (result.Items as WebhookEndpointRecord[] | undefined) ?? [];
}

export async function disableWebhookEndpoint(params: {
  webhookId: string;
  accountId: string;
  updatedAt: string;
}): Promise<WebhookEndpointRecord | null> {
  const result = await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getWebhookEndpointsTableName(),
      Key: { webhookId: params.webhookId },
      ConditionExpression: "accountId = :accountId",
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":accountId": params.accountId,
        ":status": "disabled",
        ":updatedAt": params.updatedAt,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return (result.Attributes as WebhookEndpointRecord | undefined) ?? null;
}
