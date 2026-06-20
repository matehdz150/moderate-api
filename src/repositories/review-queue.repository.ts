import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type {
  ReviewQueueRecord,
  ReviewStatus,
} from "../types/review.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getReviewQueueTableName() {
  const tableName = process.env.REVIEW_QUEUE_TABLE_NAME;

  if (!tableName) {
    throw new Error("REVIEW_QUEUE_TABLE_NAME is not configured");
  }

  return tableName;
}

function getProjectStatusKey(projectId: string, status: ReviewStatus) {
  return `${projectId}#${status}`;
}

function getAccountStatusKey(accountId: string, status: ReviewStatus) {
  return `${accountId}#${status}`;
}

export function withReviewQueueKeys(record: ReviewQueueRecord) {
  return {
    ...record,
    projectStatus: getProjectStatusKey(record.projectId, record.status),
    accountStatus: getAccountStatusKey(record.accountId, record.status),
  };
}

export async function createReviewQueueItem(
  record: ReviewQueueRecord
): Promise<void> {
  await dynamoDbClient.send(
    new PutCommand({
      TableName: getReviewQueueTableName(),
      Item: withReviewQueueKeys(record),
      ConditionExpression: "attribute_not_exists(reviewId)",
    })
  );
}

export async function getReviewQueueItem(
  reviewId: string
): Promise<ReviewQueueRecord | null> {
  const result = await dynamoDbClient.send(
    new GetCommand({
      TableName: getReviewQueueTableName(),
      Key: { reviewId },
    })
  );

  return (result.Item as ReviewQueueRecord | undefined) ?? null;
}

export async function listReviewQueueByProject(params: {
  projectId: string;
  status?: ReviewStatus;
  limit?: number;
}): Promise<ReviewQueueRecord[]> {
  const status = params.status ?? "pending";
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getReviewQueueTableName(),
      IndexName: "projectStatus-createdAt-index",
      KeyConditionExpression: "projectStatus = :projectStatus",
      ExpressionAttributeValues: {
        ":projectStatus": getProjectStatusKey(params.projectId, status),
      },
      ScanIndexForward: false,
      Limit: params.limit ?? 50,
    })
  );

  return (result.Items as ReviewQueueRecord[] | undefined) ?? [];
}

export async function listReviewQueueByAccount(params: {
  accountId: string;
  status?: ReviewStatus;
  limit?: number;
}): Promise<ReviewQueueRecord[]> {
  const status = params.status ?? "pending";
  const result = await dynamoDbClient.send(
    new QueryCommand({
      TableName: getReviewQueueTableName(),
      IndexName: "accountStatus-createdAt-index",
      KeyConditionExpression: "accountStatus = :accountStatus",
      ExpressionAttributeValues: {
        ":accountStatus": getAccountStatusKey(params.accountId, status),
      },
      ScanIndexForward: false,
      Limit: params.limit ?? 50,
    })
  );

  return (result.Items as ReviewQueueRecord[] | undefined) ?? [];
}

export async function updateReviewQueueDecision(params: {
  reviewId: string;
  accountId: string;
  projectId: string;
  status: Extract<ReviewStatus, "approved" | "rejected" | "ignored">;
  reviewedBy: string;
  decisionReason?: string;
  reviewedAt: string;
}): Promise<ReviewQueueRecord> {
  const result = await dynamoDbClient.send(
    new UpdateCommand({
      TableName: getReviewQueueTableName(),
      Key: {
        reviewId: params.reviewId,
      },
      ConditionExpression:
        "attribute_exists(reviewId) AND #status = :pendingStatus",
      UpdateExpression:
        "SET #status = :status, reviewedAt = :reviewedAt, reviewedBy = :reviewedBy, updatedAt = :reviewedAt, decisionReason = :decisionReason, projectStatus = :projectStatus, accountStatus = :accountStatus",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":pendingStatus": "pending",
        ":status": params.status,
        ":reviewedAt": params.reviewedAt,
        ":reviewedBy": params.reviewedBy,
        ":decisionReason": params.decisionReason,
        ":projectStatus": getProjectStatusKey(params.projectId, params.status),
        ":accountStatus": getAccountStatusKey(params.accountId, params.status),
      },
      ReturnValues: "ALL_NEW",
    })
  );

  const updated = result.Attributes as ReviewQueueRecord | undefined;

  if (!updated) {
    throw new Error("Review queue decision update did not return a record");
  }

  return updated;
}
