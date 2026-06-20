import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import { CreateQueueCommand, GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient, SetQueueAttributesCommand } from "@aws-sdk/client-sqs";

const region = process.env.AWS_REGION ?? "us-east-1";
const endpointsTable = process.env.WEBHOOK_ENDPOINTS_TABLE_NAME ?? "moderateapi-webhook-endpoints";
const eventsTable = process.env.WEBHOOK_EVENTS_TABLE_NAME ?? "moderateapi-webhook-events";
const queueName = process.env.WEBHOOK_DELIVERY_QUEUE_NAME ?? "moderateapi-webhook-delivery";
const dlqName = process.env.WEBHOOK_DELIVERY_DLQ_NAME ?? "moderateapi-webhook-delivery-dlq";

const dynamodb = new DynamoDBClient({ region });
const sqs = new SQSClient({ region });

async function tableExists(tableName: string) {
  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") return false;
    throw error;
  }
}

async function ensureWebhookEndpointsTable() {
  if (await tableExists(endpointsTable)) return;

  await dynamodb.send(new CreateTableCommand({
    TableName: endpointsTable,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "webhookId", AttributeType: "S" },
      { AttributeName: "accountId", AttributeType: "S" },
      { AttributeName: "projectId", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "S" },
      { AttributeName: "status", AttributeType: "S" },
    ],
    KeySchema: [{ AttributeName: "webhookId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "accountId-createdAt-index",
        KeySchema: [
          { AttributeName: "accountId", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "projectId-status-index",
        KeySchema: [
          { AttributeName: "projectId", KeyType: "HASH" },
          { AttributeName: "status", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  }));

  await waitUntilTableExists({ client: dynamodb, maxWaitTime: 90 }, { TableName: endpointsTable });
}

async function ensureWebhookEventsTable() {
  if (await tableExists(eventsTable)) return;

  await dynamodb.send(new CreateTableCommand({
    TableName: eventsTable,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "eventId", AttributeType: "S" },
      { AttributeName: "projectId", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "S" },
    ],
    KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "projectId-createdAt-index",
        KeySchema: [
          { AttributeName: "projectId", KeyType: "HASH" },
          { AttributeName: "createdAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  }));

  await waitUntilTableExists({ client: dynamodb, maxWaitTime: 90 }, { TableName: eventsTable });
}

async function getQueueUrl(name: string) {
  try {
    const result = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return result.QueueUrl!;
  } catch (error) {
    if (error instanceof Error && error.name === "QueueDoesNotExist") return null;
    throw error;
  }
}

async function ensureQueue(name: string, attributes: Record<string, string> = {}) {
  const existingUrl = await getQueueUrl(name);
  if (existingUrl) return existingUrl;

  const result = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
  return result.QueueUrl!;
}

async function getQueueArn(queueUrl: string) {
  const result = await sqs.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: ["QueueArn"],
  }));

  return result.Attributes?.QueueArn;
}

async function main() {
  await ensureWebhookEndpointsTable();
  await ensureWebhookEventsTable();

  const dlqUrl = await ensureQueue(dlqName, {
    MessageRetentionPeriod: "1209600",
  });
  const dlqArn = await getQueueArn(dlqUrl);

  if (!dlqArn) throw new Error("Could not read DLQ ARN");

  const queueUrl = await ensureQueue(queueName, {
    VisibilityTimeout: "30",
    MessageRetentionPeriod: "345600",
  });

  await sqs.send(new SetQueueAttributesCommand({
    QueueUrl: queueUrl,
    Attributes: {
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: 5,
      }),
    },
  }));

  const queueArn = await getQueueArn(queueUrl);

  console.log(JSON.stringify({
    region,
    endpointsTable,
    eventsTable,
    queueName,
    queueUrl,
    queueArn,
    dlqName,
    dlqUrl,
    dlqArn,
    env: {
      WEBHOOK_ENDPOINTS_TABLE_NAME: endpointsTable,
      WEBHOOK_EVENTS_TABLE_NAME: eventsTable,
      WEBHOOK_DELIVERY_QUEUE_URL: queueUrl,
      WEBHOOK_HTTP_TIMEOUT_MS: "5000",
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
