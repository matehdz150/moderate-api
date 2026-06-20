import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import type { BillingEventRecord } from "../types/billing.types.js";

const dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getBillingEventsTableName() {
  const tableName = process.env.BILLING_EVENTS_TABLE_NAME;

  if (!tableName) {
    throw new Error("BILLING_EVENTS_TABLE_NAME is not configured");
  }

  return tableName;
}

export async function markBillingEventProcessed(
  record: BillingEventRecord
): Promise<boolean> {
  try {
    await dynamoDbClient.send(
      new PutCommand({
        TableName: getBillingEventsTableName(),
        Item: record,
        ConditionExpression: "attribute_not_exists(stripeEventId)",
      })
    );

    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return false;
    }

    throw error;
  }
}
