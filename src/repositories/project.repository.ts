import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { ProjectRecord } from "../types/project.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getProjectsTableName() {
  const tableName = process.env.PROJECTS_TABLE_NAME;

  if (!tableName) {
    throw new Error("PROJECTS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function listProjectsByAccount(
  accountId: string
): Promise<ProjectRecord[]> {
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getProjectsTableName(),
      KeyConditionExpression: "accountId = :accountId",
      ExpressionAttributeValues: {
        ":accountId": accountId,
      },
    })
  );

  return (result.Items as ProjectRecord[] | undefined) ?? [];
}

export async function getProjectById(params: {
  accountId: string;
  projectId: string;
}): Promise<ProjectRecord | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getProjectsTableName(),
      Key: params,
    })
  );

  return (result.Item as ProjectRecord | undefined) ?? null;
}

export async function createProjectRecord(
  project: ProjectRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getProjectsTableName(),
      Item: project,
      ConditionExpression:
        "attribute_not_exists(accountId) AND attribute_not_exists(projectId)",
    })
  );
}
