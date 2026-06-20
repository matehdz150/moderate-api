import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

import type { ApiKeyRecord, UsageRecord } from "../types/auth.types.js";
import type { AccountRecord } from "../types/account.types.js";
import type { ProjectRecord } from "../types/project.types.js";
import type { WebhookEventRecord } from "../types/webhook.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MAX_ADMIN_SCAN_ITEMS = 1000;

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(name + " is not configured");
  }

  return value;
}

async function scanAll<T>(params: {
  tableName: string;
  limit?: number;
  filterExpression?: string;
  projectionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
}): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  const maxItems = params.limit ?? MAX_ADMIN_SCAN_ITEMS;

  do {
    const result = await dynamoDbClient.send(
      new ScanCommand({
        TableName: params.tableName,
        Limit: Math.min(100, maxItems - items.length),
        ExclusiveStartKey: exclusiveStartKey,
        FilterExpression: params.filterExpression,
        ProjectionExpression: params.projectionExpression,
        ExpressionAttributeNames: params.expressionAttributeNames,
        ExpressionAttributeValues: params.expressionAttributeValues,
      })
    );

    items.push(...((result.Items as T[] | undefined) ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey && items.length < maxItems);

  return items;
}

export function getCurrentUsageMonth() {
  return new Date().toISOString().slice(0, 7);
}

export async function listAdminAccounts(limit?: number): Promise<AccountRecord[]> {
  return scanAll<AccountRecord>({
    tableName: requiredEnv("ACCOUNTS_TABLE_NAME"),
    limit,
  });
}

export async function listAdminProjects(limit?: number): Promise<ProjectRecord[]> {
  return scanAll<ProjectRecord>({
    tableName: requiredEnv("PROJECTS_TABLE_NAME"),
    limit,
  });
}

export async function listAdminApiKeys(limit?: number): Promise<ApiKeyRecord[]> {
  return scanAll<ApiKeyRecord>({
    tableName: requiredEnv("API_KEYS_TABLE_NAME"),
    limit,
    projectionExpression:
      "apiKeyHash, accountId, projectId, planId, #status, monthlyLimit, createdAt, lastUsedAt, #name",
    expressionAttributeNames: {
      "#status": "status",
      "#name": "name",
    },
  });
}

export async function listAdminCurrentMonthUsage(
  month = getCurrentUsageMonth(),
  limit?: number
): Promise<UsageRecord[]> {
  return scanAll<UsageRecord>({
    tableName: requiredEnv("USAGE_TABLE_NAME"),
    limit,
    filterExpression: "#month = :month",
    expressionAttributeNames: {
      "#month": "month",
    },
    expressionAttributeValues: {
      ":month": month,
    },
  });
}

export async function listAdminFailedWebhookEvents(
  limit = 50
): Promise<WebhookEventRecord[]> {
  return scanAll<WebhookEventRecord>({
    tableName: requiredEnv("WEBHOOK_EVENTS_TABLE_NAME"),
    limit,
    filterExpression: "#status = :status",
    expressionAttributeNames: {
      "#status": "status",
    },
    expressionAttributeValues: {
      ":status": "failed",
    },
  });
}
