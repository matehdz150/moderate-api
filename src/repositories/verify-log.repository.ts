import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { VerifyLogRecord } from "../types/verify.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getVerifyLogsTableName() {
  const tableName = process.env.VERIFY_LOGS_TABLE_NAME;

  if (!tableName) {
    throw new Error("VERIFY_LOGS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function saveVerifyLog(logRecord: VerifyLogRecord): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getVerifyLogsTableName(),
      Item: logRecord,
    })
  );
}

export async function listVerifyLogsByProject(
  projectId: string,
  limit = 20
): Promise<VerifyLogRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getVerifyLogsTableName(),
      IndexName: "projectId-createdAt-index",
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: {
        ":projectId": projectId,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  return (result.Items as VerifyLogRecord[] | undefined) ?? [];
}
