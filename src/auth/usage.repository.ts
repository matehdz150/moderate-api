import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { UsageRecord } from "../types/auth.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface IncrementUsageParams {
  accountId: string;
  projectId: string;
  planId: string;
}

function getUsageTableName() {
  const tableName = process.env.USAGE_TABLE_NAME;

  if (!tableName) {
    throw new Error("USAGE_TABLE_NAME is not configured");
  }

  return tableName;
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getUsageKey(accountId: string, month: string) {
  return `${accountId}#${month}`;
}

export async function getCurrentMonthUsage(
  accountId: string
): Promise<UsageRecord | null> {
  const month = getCurrentMonth();
  const usageKey = getUsageKey(accountId, month);

  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getUsageTableName(),
      Key: {
        usageKey,
      },
      ProjectionExpression:
        "usageKey, accountId, projectId, planId, #month, requestsUsed, updatedAt",
      ExpressionAttributeNames: {
        "#month": "month",
      },
    })
  );

  return (result.Item as UsageRecord | undefined) ?? null;
}

export async function incrementUsage(
  params: IncrementUsageParams
): Promise<void> {
  const month = getCurrentMonth();
  const updatedAt = new Date().toISOString();

  await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getUsageTableName(),
      Key: {
        usageKey: getUsageKey(params.accountId, month),
      },
      UpdateExpression:
        "ADD requestsUsed :inc SET updatedAt = :updatedAt, accountId = :accountId, projectId = :projectId, planId = :planId, #month = :month",
      ExpressionAttributeNames: {
        "#month": "month",
      },
      ExpressionAttributeValues: {
        ":inc": 1,
        ":updatedAt": updatedAt,
        ":accountId": params.accountId,
        ":projectId": params.projectId,
        ":planId": params.planId,
        ":month": month,
      },
    })
  );
}
