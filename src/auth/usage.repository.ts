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
  monthlyLimit: number;
  overageEnabled: boolean;
  overagePriceCentsPerThousand: number;
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
        "usageKey, accountId, projectId, planId, #month, requestsUsed, verificationsUsed, monthlyLimit, overageEnabled, overagePriceCentsPerThousand, updatedAt",
      ExpressionAttributeNames: {
        "#month": "month",
      },
    })
  );

  return (result.Item as UsageRecord | undefined) ?? null;
}

/** Account-level monthly verification counter, separate from requestsUsed. Returns the new count. */
export async function incrementVerificationUsage(params: {
  accountId: string;
  planId: string;
}): Promise<number> {
  const month = getCurrentMonth();
  const updatedAt = new Date().toISOString();

  const result = await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getUsageTableName(),
      Key: {
        usageKey: getUsageKey(params.accountId, month),
      },
      UpdateExpression:
        "ADD verificationsUsed :inc SET updatedAt = :updatedAt, accountId = :accountId, planId = :planId, #month = :month",
      ExpressionAttributeNames: {
        "#month": "month",
      },
      ExpressionAttributeValues: {
        ":inc": 1,
        ":updatedAt": updatedAt,
        ":accountId": params.accountId,
        ":planId": params.planId,
        ":month": month,
      },
      ReturnValues: "UPDATED_NEW",
    })
  );

  return (result.Attributes?.verificationsUsed as number | undefined) ?? 1;
}

export async function getCurrentMonthProjectUsage(params: {
  accountId: string;
  projectId: string;
}): Promise<UsageRecord | null> {
  const month = getCurrentMonth();

  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getUsageTableName(),
      Key: {
        usageKey: `${params.accountId}#${params.projectId}#${month}`,
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
        "ADD requestsUsed :inc SET updatedAt = :updatedAt, accountId = :accountId, projectId = :projectId, planId = :planId, monthlyLimit = :monthlyLimit, overageEnabled = :overageEnabled, overagePriceCentsPerThousand = :overagePriceCentsPerThousand, #month = :month",
      ExpressionAttributeNames: {
        "#month": "month",
      },
      ExpressionAttributeValues: {
        ":inc": 1,
        ":updatedAt": updatedAt,
        ":accountId": params.accountId,
        ":projectId": params.projectId,
        ":planId": params.planId,
        ":monthlyLimit": params.monthlyLimit,
        ":overageEnabled": params.overageEnabled,
        ":overagePriceCentsPerThousand": params.overagePriceCentsPerThousand,
        ":month": month,
      },
    })
  );
}

export async function incrementProjectUsage(params: {
  accountId: string;
  projectId: string;
  planId: string;
}): Promise<void> {
  const month = getCurrentMonth();
  const updatedAt = new Date().toISOString();

  await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getUsageTableName(),
      Key: {
        usageKey: `${params.accountId}#${params.projectId}#${month}`,
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
