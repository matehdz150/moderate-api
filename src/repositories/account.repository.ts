import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { AccountRecord, PlanId } from "../types/account.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getAccountsTableName() {
  const tableName = process.env.ACCOUNTS_TABLE_NAME;

  if (!tableName) {
    throw new Error("ACCOUNTS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function getAccountById(
  accountId: string
): Promise<AccountRecord | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getAccountsTableName(),
      Key: {
        accountId,
      },
    })
  );

  return (result.Item as AccountRecord | undefined) ?? null;
}

export async function createAccountRecord(
  account: AccountRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getAccountsTableName(),
      Item: account,
      ConditionExpression: "attribute_not_exists(accountId)",
    })
  );
}

export async function updateAccountPlan(params: {
  accountId: string;
  planId: PlanId;
  monthlyLimit: number;
  projectLimit: number;
  apiKeyLimit: number;
  logRetentionDays: number;
  updatedAt: string;
}): Promise<AccountRecord> {
  const result = await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getAccountsTableName(),
      Key: {
        accountId: params.accountId,
      },
      UpdateExpression:
        "SET planId = :planId, monthlyLimit = :monthlyLimit, projectLimit = :projectLimit, apiKeyLimit = :apiKeyLimit, logRetentionDays = :logRetentionDays, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":planId": params.planId,
        ":monthlyLimit": params.monthlyLimit,
        ":projectLimit": params.projectLimit,
        ":apiKeyLimit": params.apiKeyLimit,
        ":logRetentionDays": params.logRetentionDays,
        ":updatedAt": params.updatedAt,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes as AccountRecord;
}
