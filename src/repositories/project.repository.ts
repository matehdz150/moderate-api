import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
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

export async function updateProjectName(params: {
  accountId: string;
  projectId: string;
  name: string;
  updatedAt: string;
}): Promise<ProjectRecord> {
  const result = await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getProjectsTableName(),
      Key: {
        accountId: params.accountId,
        projectId: params.projectId,
      },
      ConditionExpression: "attribute_exists(accountId) AND attribute_exists(projectId)",
      UpdateExpression: "SET #name = :name, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#name": "name",
      },
      ExpressionAttributeValues: {
        ":name": params.name,
        ":updatedAt": params.updatedAt,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes as ProjectRecord;
}

export async function deleteProjectRecord(params: {
  accountId: string;
  projectId: string;
}): Promise<ProjectRecord> {
  const result = await dynamoDbClient.send(
    new DeleteCommand({
      TableName: getProjectsTableName(),
      Key: params,
      ConditionExpression: "attribute_exists(accountId) AND attribute_exists(projectId)",
      ReturnValues: "ALL_OLD",
    })
  );

  return result.Attributes as ProjectRecord;
}

export async function updateProjectsPlanByAccount(params: {
  accountId: string;
  planId: string;
  monthlyLimit: number;
  updatedAt: string;
}): Promise<void> {
  const projects = await listProjectsByAccount(params.accountId);

  await Promise.all(
    projects.map((project) =>
      dynamoDbClient.send(
        new UpdateCommand({
          TableName: getProjectsTableName(),
          Key: {
            accountId: project.accountId,
            projectId: project.projectId,
          },
          UpdateExpression:
            "SET planId = :planId, monthlyLimit = :monthlyLimit, updatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":planId": params.planId,
            ":monthlyLimit": params.monthlyLimit,
            ":updatedAt": params.updatedAt,
          },
        })
      )
    )
  );
}
