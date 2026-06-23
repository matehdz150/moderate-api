import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION ?? "us-east-1";
const verifyLogsTable =
  process.env.VERIFY_LOGS_TABLE_NAME ?? "moderateapi-verify-logs";
const dynamodb = new DynamoDBClient({ region });

async function tableExists(tableName: string) {
  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") return false;
    throw error;
  }
}

async function main() {
  if (!(await tableExists(verifyLogsTable))) {
    await dynamodb.send(
      new CreateTableCommand({
        TableName: verifyLogsTable,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "verificationId", AttributeType: "S" },
          { AttributeName: "projectId", AttributeType: "S" },
          { AttributeName: "createdAt", AttributeType: "S" },
        ],
        KeySchema: [{ AttributeName: "verificationId", KeyType: "HASH" }],
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
      })
    );

    await waitUntilTableExists(
      { client: dynamodb, maxWaitTime: 120 },
      { TableName: verifyLogsTable }
    );

    console.log(`Created table ${verifyLogsTable}`);
  } else {
    console.log(`Table ${verifyLogsTable} already exists`);
  }

  console.log(
    JSON.stringify(
      { region, env: { VERIFY_LOGS_TABLE_NAME: verifyLogsTable } },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
