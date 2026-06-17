import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

import type { ModerationPolicy } from "../types/policy.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getPoliciesTableName() {
  const tableName = process.env.POLICIES_TABLE_NAME;

  if (!tableName) {
    throw new Error("POLICIES_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function getPolicyByProjectId(
  projectId: string
): Promise<ModerationPolicy | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getPoliciesTableName(),
      Key: {
        projectId,
      },
    })
  );

  return (result.Item as ModerationPolicy | undefined) ?? null;
}
