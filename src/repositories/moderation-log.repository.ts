import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { ModerationLogRecord } from "../types/moderation.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getModerationLogsTableName() {
  const tableName = process.env.MODERATION_LOGS_TABLE_NAME;

  if (!tableName) {
    throw new Error("MODERATION_LOGS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function saveModerationLog(
  logRecord: ModerationLogRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getModerationLogsTableName(),
      Item: logRecord,
    })
  );
}

export async function listModerationLogsByProject(
  projectId: string,
  limit = 20
): Promise<ModerationLogRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getModerationLogsTableName(),
      IndexName: "projectId-createdAt-index",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": projectId,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  return (result.Items as ModerationLogRecord[] | undefined) ?? [];
}
