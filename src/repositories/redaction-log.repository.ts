import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { RedactionLogRecord } from "../types/redaction.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getRedactionLogsTableName() {
  const tableName = process.env.REDACTION_LOGS_TABLE_NAME;

  if (!tableName) {
    throw new Error("REDACTION_LOGS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function saveRedactionLog(
  logRecord: RedactionLogRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getRedactionLogsTableName(),
      Item: logRecord,
    })
  );
}

export async function listRedactionLogsByProject(
  projectId: string,
  limit = 20
): Promise<RedactionLogRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getRedactionLogsTableName(),
      IndexName: "projectId-createdAt-index",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": projectId,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  return (result.Items as RedactionLogRecord[] | undefined) ?? [];
}

export async function countRedactionLogsByProjectSince(
  projectId: string,
  since: string
): Promise<number> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getRedactionLogsTableName(),
      IndexName: "projectId-createdAt-index",
      KeyConditionExpression: "projectId = :projectId AND createdAt >= :since",
      ExpressionAttributeValues: {
        ":projectId": projectId,
        ":since": since,
      },
      Select: "COUNT",
    })
  );

  return result.Count ?? 0;
}
