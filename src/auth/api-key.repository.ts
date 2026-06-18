import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { ApiKeyRecord } from "../types/auth.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getApiKeysTableName() {
  const tableName = process.env.API_KEYS_TABLE_NAME;

  if (!tableName) {
    throw new Error("API_KEYS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function getApiKeyByHash(
  apiKeyHash: string
): Promise<ApiKeyRecord | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getApiKeysTableName(),
      Key: {
        apiKeyHash,
      },
      ProjectionExpression:
        "apiKeyHash, accountId, projectId, planId, #status, monthlyLimit, createdAt, lastUsedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
    })
  );

  return (result.Item as ApiKeyRecord | undefined) ?? null;
}

export async function updateLastUsedAt(apiKeyHash: string): Promise<void> {
  await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getApiKeysTableName(),
      Key: {
        apiKeyHash,
      },
      UpdateExpression: "SET lastUsedAt = :lastUsedAt",
      ExpressionAttributeValues: {
        ":lastUsedAt": new Date().toISOString(),
      },
    })
  );
}

export async function createApiKeyRecord(
  apiKeyRecord: ApiKeyRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getApiKeysTableName(),
      Item: apiKeyRecord,
      ConditionExpression: "attribute_not_exists(apiKeyHash)",
    })
  );
}

export async function listApiKeysByAccount(
  accountId: string
): Promise<ApiKeyRecord[]> {
  const result = await dynamoDbClient.send(
    new ScanCommand({
      TableName: getApiKeysTableName(),
      FilterExpression: "accountId = :accountId",
      ExpressionAttributeValues: {
        ":accountId": accountId,
      },
      ProjectionExpression:
        "apiKeyHash, accountId, projectId, planId, #status, monthlyLimit, createdAt, lastUsedAt, #name",
      ExpressionAttributeNames: {
        "#status": "status",
        "#name": "name",
      },
    })
  );

  return (result.Items as ApiKeyRecord[] | undefined) ?? [];
}

export async function updateApiKeysPlanByAccount(params: {
  accountId: string;
  planId: string;
  monthlyLimit: number;
}): Promise<void> {
  const apiKeys = await listApiKeysByAccount(params.accountId);

  await Promise.all(
    apiKeys.map((apiKey) =>
      dynamoDbClient.send(
        new UpdateCommand({
          TableName: getApiKeysTableName(),
          Key: {
            apiKeyHash: apiKey.apiKeyHash,
          },
          UpdateExpression:
            "SET planId = :planId, monthlyLimit = :monthlyLimit",
          ExpressionAttributeValues: {
            ":planId": params.planId,
            ":monthlyLimit": params.monthlyLimit,
          },
        })
      )
    )
  );
}
