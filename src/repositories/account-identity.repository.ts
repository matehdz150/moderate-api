import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { AccountIdentityRecord } from "../types/account.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getAccountIdentitiesTableName() {
  const tableName = process.env.ACCOUNT_IDENTITIES_TABLE_NAME;

  if (!tableName) {
    throw new Error("ACCOUNT_IDENTITIES_TABLE_NAME is not configured");
  }

  return tableName;
}

export function buildIdentityKey(provider: string, providerUserId: string) {
  return provider.toLowerCase() + "#" + providerUserId;
}

export async function getAccountIdentity(
  identityKey: string
): Promise<AccountIdentityRecord | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getAccountIdentitiesTableName(),
      Key: { identityKey },
    })
  );

  return (result.Item as AccountIdentityRecord | undefined) ?? null;
}

export async function listAccountIdentitiesByEmail(
  email: string
): Promise<AccountIdentityRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getAccountIdentitiesTableName(),
      IndexName: "email-createdAt-index",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email.toLowerCase(),
      },
      ScanIndexForward: true,
      Limit: 10,
    })
  );

  return (result.Items as AccountIdentityRecord[] | undefined) ?? [];
}

export async function putAccountIdentity(
  identity: AccountIdentityRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getAccountIdentitiesTableName(),
      Item: identity,
    })
  );
}
