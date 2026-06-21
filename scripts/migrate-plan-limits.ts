import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// Table names default to the deployed names; override via env if needed.
// Set before the imported repositories read them at call-time.
process.env.ACCOUNTS_TABLE_NAME ??= "moderateapi-accounts";
process.env.PROJECTS_TABLE_NAME ??= "moderateapi-projects";
process.env.API_KEYS_TABLE_NAME ??= "moderateapi-api-keys";

import { PLAN_CONFIGS } from "../src/services/plan.service.js";
import type { AccountRecord } from "../src/types/account.types.js";
import { updateProjectsPlanByAccount } from "../src/repositories/project.repository.js";
import { updateApiKeysPlanByAccount } from "../src/auth/api-key.repository.js";

const APPLY = process.env.APPLY === "1";
const INCLUDE_DOWNGRADES = process.env.INCLUDE_DOWNGRADES === "1";
const ACCOUNTS_TABLE = process.env.ACCOUNTS_TABLE_NAME as string;

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function scanAllAccounts(): Promise<AccountRecord[]> {
  const items: AccountRecord[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new ScanCommand({ TableName: ACCOUNTS_TABLE, ExclusiveStartKey })
    );
    items.push(...((res.Items ?? []) as AccountRecord[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return items;
}

async function main() {
  const accounts = await scanAllAccounts();
  console.log(
    `Scanned ${accounts.length} accounts. APPLY=${APPLY} INCLUDE_DOWNGRADES=${INCLUDE_DOWNGRADES}\n`
  );

  let applied = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const acc of accounts) {
    const cfg = PLAN_CONFIGS[acc.planId as keyof typeof PLAN_CONFIGS];

    if (!cfg) {
      console.log(`  ! ${acc.accountId} unknown plan "${acc.planId}" — skip`);
      skipped++;
      continue;
    }

    const changes: string[] = [];
    if (acc.monthlyLimit !== cfg.monthlyLimit)
      changes.push(`monthlyLimit ${acc.monthlyLimit}->${cfg.monthlyLimit}`);
    if (acc.projectLimit !== cfg.projectLimit)
      changes.push(`projectLimit ${acc.projectLimit}->${cfg.projectLimit}`);
    if (acc.apiKeyLimit !== cfg.apiKeyLimit)
      changes.push(`apiKeyLimit ${acc.apiKeyLimit}->${cfg.apiKeyLimit}`);
    if (acc.logRetentionDays !== cfg.logRetentionDays)
      changes.push(`retention ${acc.logRetentionDays}->${cfg.logRetentionDays}`);

    if (changes.length === 0) {
      unchanged++;
      continue;
    }

    const isDowngrade = cfg.monthlyLimit < acc.monthlyLimit;
    const tag = isDowngrade ? "DOWNGRADE" : "increase";
    console.log(`  [${acc.planId}] ${acc.accountId} (${acc.email}) ${tag}: ${changes.join(", ")}`);

    if (isDowngrade && !INCLUDE_DOWNGRADES) {
      console.log("     -> skipped (downgrade; grandfathered). Re-run with INCLUDE_DOWNGRADES=1 to force.");
      skipped++;
      continue;
    }

    if (!APPLY) continue;

    const updatedAt = new Date().toISOString();

    await doc.send(
      new UpdateCommand({
        TableName: ACCOUNTS_TABLE,
        Key: { accountId: acc.accountId },
        UpdateExpression:
          "SET monthlyLimit = :ml, projectLimit = :pl, apiKeyLimit = :al, logRetentionDays = :lr, updatedAt = :u",
        ExpressionAttributeValues: {
          ":ml": cfg.monthlyLimit,
          ":pl": cfg.projectLimit,
          ":al": cfg.apiKeyLimit,
          ":lr": cfg.logRetentionDays,
          ":u": updatedAt,
        },
      })
    );

    await updateProjectsPlanByAccount({
      accountId: acc.accountId,
      planId: acc.planId,
      monthlyLimit: cfg.monthlyLimit,
      updatedAt,
    });
    await updateApiKeysPlanByAccount({
      accountId: acc.accountId,
      planId: acc.planId,
      monthlyLimit: cfg.monthlyLimit,
    });

    applied++;
    console.log("     -> applied (account + projects + api keys)");
  }

  console.log(`\nDone. applied=${applied} skipped=${skipped} unchanged=${unchanged}`);
  if (!APPLY) console.log("DRY-RUN only — no writes. Set APPLY=1 to write.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
