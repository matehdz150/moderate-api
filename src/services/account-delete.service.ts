import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { getAccountById } from "../repositories/account.repository.js";
import { listProjectsByAccount } from "../repositories/project.repository.js";
import type { AccountRecord } from "../types/account.types.js";
import { HttpError } from "../utils/http-response.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const REVIEW_STATUSES = ["pending", "approved", "rejected", "ignored"];
const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due", "incomplete"]);

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(name + " is not configured");
  }

  return value;
}

function optionalEnv(name: string) {
  return process.env[name];
}

function hasPaidActiveStripeSubscription(account: AccountRecord) {
  if (account.planId === "free") {
    return false;
  }

  return Boolean(
    account.stripeSubscriptionId &&
      account.stripeSubscriptionStatus &&
      ACTIVE_STRIPE_STATUSES.has(account.stripeSubscriptionStatus)
  );
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function batchDelete(tableName: string, keys: Array<Record<string, string>>) {
  for (const keyChunk of chunk(keys, 25)) {
    if (keyChunk.length === 0) continue;

    await dynamoDbClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: keyChunk.map((key) => ({
            DeleteRequest: { Key: key },
          })),
        },
      })
    );
  }
}

async function scanKeys(params: {
  tableName: string;
  keyName: string;
  filterExpression: string;
  expressionAttributeValues: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
}) {
  const keys: Array<Record<string, string>> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoDbClient.send(
      new ScanCommand({
        TableName: params.tableName,
        FilterExpression: params.filterExpression,
        ProjectionExpression: params.keyName,
        ExpressionAttributeNames: params.expressionAttributeNames,
        ExpressionAttributeValues: params.expressionAttributeValues,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    for (const item of result.Items ?? []) {
      const value = item[params.keyName];

      if (typeof value === "string") {
        keys.push({ [params.keyName]: value });
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return keys;
}

async function queryKeys(params: {
  tableName: string;
  indexName?: string;
  keyName: string;
  keyConditionExpression: string;
  expressionAttributeValues: Record<string, unknown>;
}) {
  const keys: Array<Record<string, string>> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamoDbClient.send(
      new QueryCommand({
        TableName: params.tableName,
        IndexName: params.indexName,
        KeyConditionExpression: params.keyConditionExpression,
        ProjectionExpression: params.keyName,
        ExpressionAttributeValues: params.expressionAttributeValues,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    for (const item of result.Items ?? []) {
      const value = item[params.keyName];

      if (typeof value === "string") {
        keys.push({ [params.keyName]: value });
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return keys;
}

async function deleteS3AccountObjects(accountId: string) {
  const bucketName = optionalEnv("IMAGES_BUCKET_NAME");

  if (!bucketName) return 0;

  const prefix = `accounts/${accountId}/`;
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const objects = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));

    if (objects.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: objects.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      deleted += objects.length;
    }

    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);

  return deleted;
}

export async function deleteAccountData(params: {
  accountId: string;
  email: string;
}) {
  const account = await getAccountById(params.accountId);

  if (!account) {
    return { deleted: false };
  }

  if (account.email.toLowerCase() !== params.email.toLowerCase()) {
    throw new HttpError(403, "You do not have access to this account");
  }

  if (hasPaidActiveStripeSubscription(account)) {
    throw new HttpError(409, "Cancel your active subscription before deleting this account");
  }

  const projects = await listProjectsByAccount(params.accountId);
  const projectIds = projects.map((project) => project.projectId);

  const accountsTable = requiredEnv("ACCOUNTS_TABLE_NAME");
  const projectsTable = requiredEnv("PROJECTS_TABLE_NAME");
  const apiKeysTable = requiredEnv("API_KEYS_TABLE_NAME");
  const accountIdentitiesTable = requiredEnv("ACCOUNT_IDENTITIES_TABLE_NAME");
  const usageTable = requiredEnv("USAGE_TABLE_NAME");
  const policiesTable = requiredEnv("POLICIES_TABLE_NAME");
  const moderationLogsTable = requiredEnv("MODERATION_LOGS_TABLE_NAME");
  const reviewQueueTable = requiredEnv("REVIEW_QUEUE_TABLE_NAME");
  const webhookEndpointsTable = requiredEnv("WEBHOOK_ENDPOINTS_TABLE_NAME");
  const webhookEventsTable = requiredEnv("WEBHOOK_EVENTS_TABLE_NAME");

  const [apiKeyKeys, identityKeys, usageKeys, webhookEndpointKeys] = await Promise.all([
    scanKeys({
      tableName: apiKeysTable,
      keyName: "apiKeyHash",
      filterExpression: "accountId = :accountId",
      expressionAttributeValues: { ":accountId": params.accountId },
    }),
    scanKeys({
      tableName: accountIdentitiesTable,
      keyName: "identityKey",
      filterExpression: "accountId = :accountId",
      expressionAttributeValues: { ":accountId": params.accountId },
    }),
    scanKeys({
      tableName: usageTable,
      keyName: "usageKey",
      filterExpression: "accountId = :accountId",
      expressionAttributeValues: { ":accountId": params.accountId },
    }),
    queryKeys({
      tableName: webhookEndpointsTable,
      indexName: "accountId-createdAt-index",
      keyName: "webhookId",
      keyConditionExpression: "accountId = :accountId",
      expressionAttributeValues: { ":accountId": params.accountId },
    }),
  ]);

  const [moderationLogKeysByProject, webhookEventKeysByProject] = await Promise.all([
    Promise.all(
      projectIds.map((projectId) =>
        queryKeys({
          tableName: moderationLogsTable,
          indexName: "projectId-createdAt-index",
          keyName: "moderationId",
          keyConditionExpression: "projectId = :projectId",
          expressionAttributeValues: { ":projectId": projectId },
        })
      )
    ),
    Promise.all(
      projectIds.map((projectId) =>
        queryKeys({
          tableName: webhookEventsTable,
          indexName: "projectId-createdAt-index",
          keyName: "eventId",
          keyConditionExpression: "projectId = :projectId",
          expressionAttributeValues: { ":projectId": projectId },
        })
      )
    ),
  ]);

  const reviewKeysByStatus = await Promise.all(
    REVIEW_STATUSES.map((status) =>
      queryKeys({
        tableName: reviewQueueTable,
        indexName: "accountStatus-createdAt-index",
        keyName: "reviewId",
        keyConditionExpression: "accountStatus = :accountStatus",
        expressionAttributeValues: {
          ":accountStatus": `${params.accountId}#${status}`,
        },
      })
    )
  );

  const moderationLogKeys = moderationLogKeysByProject.flat();
  const webhookEventKeys = webhookEventKeysByProject.flat();
  const reviewKeys = reviewKeysByStatus.flat();
  const policyKeys = projectIds.map((projectId) => ({ projectId }));
  const projectKeys = projects.map((project) => ({
    accountId: project.accountId,
    projectId: project.projectId,
  }));

  const deletedS3Objects = await deleteS3AccountObjects(params.accountId);

  await Promise.all([
    batchDelete(moderationLogsTable, moderationLogKeys),
    batchDelete(reviewQueueTable, reviewKeys),
    batchDelete(webhookEventsTable, webhookEventKeys),
    batchDelete(webhookEndpointsTable, webhookEndpointKeys),
    batchDelete(apiKeysTable, apiKeyKeys),
    batchDelete(usageTable, usageKeys),
    batchDelete(accountIdentitiesTable, identityKeys),
    batchDelete(policiesTable, policyKeys),
    batchDelete(projectsTable, projectKeys),
  ]);

  await dynamoDbClient.send(
    new DeleteCommand({
      TableName: accountsTable,
      Key: { accountId: params.accountId },
      ConditionExpression: "accountId = :accountId",
      ExpressionAttributeValues: {
        ":accountId": params.accountId,
      },
    })
  );

  return {
    deleted: true,
    deletedCounts: {
      projects: projectKeys.length,
      apiKeys: apiKeyKeys.length,
      identities: identityKeys.length,
      usageRecords: usageKeys.length,
      policies: policyKeys.length,
      moderationLogs: moderationLogKeys.length,
      reviewItems: reviewKeys.length,
      webhookEndpoints: webhookEndpointKeys.length,
      webhookEvents: webhookEventKeys.length,
      s3Objects: deletedS3Objects,
    },
  };
}
