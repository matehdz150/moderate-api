import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, waitUntilTableExists } from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION ?? "us-east-1";
const tableName = process.env.ACCOUNT_IDENTITIES_TABLE_NAME ?? "moderateapi-account-identities";
const dynamodb = new DynamoDBClient({ region });

async function tableExists() {
  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceNotFoundException") return false;
    throw error;
  }
}

async function main() {
  if (!(await tableExists())) {
    await dynamodb.send(new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "identityKey", AttributeType: "S" },
        { AttributeName: "email", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "identityKey", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "email-createdAt-index",
          KeySchema: [
            { AttributeName: "email", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }));

    await waitUntilTableExists({ client: dynamodb, maxWaitTime: 90 }, { TableName: tableName });
  }

  console.log(JSON.stringify({
    region,
    tableName,
    env: {
      ACCOUNT_IDENTITIES_TABLE_NAME: tableName,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
