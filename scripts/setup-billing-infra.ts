import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, waitUntilTableExists } from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION ?? "us-east-1";
const billingEventsTable = process.env.BILLING_EVENTS_TABLE_NAME ?? "moderateapi-billing-events";
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
  if (!(await tableExists(billingEventsTable))) {
    await dynamodb.send(new CreateTableCommand({
      TableName: billingEventsTable,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "stripeEventId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "stripeEventId", KeyType: "HASH" }],
    }));

    await waitUntilTableExists({ client: dynamodb, maxWaitTime: 90 }, { TableName: billingEventsTable });
  }

  console.log(JSON.stringify({
    region,
    billingEventsTable,
    env: {
      BILLING_EVENTS_TABLE_NAME: billingEventsTable,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
