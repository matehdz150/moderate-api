import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  type UpdateUserPoolCommandInput,
} from "@aws-sdk/client-cognito-identity-provider";

const USER_POOL_ID = process.env.USER_POOL_ID ?? "us-east-1_ks1RgiGTQ";
const APPLY = process.env.APPLY === "1";
const SUBJECT = process.env.EMAIL_SUBJECT ?? "Verify your Visora account";

const here = dirname(fileURLToPath(import.meta.url));
const EMAIL_HTML = readFileSync(join(here, "email-templates", "verification-email.html"), "utf8").trim();

// Fields UpdateUserPool accepts that must be re-passed or they revert to defaults.
const CARRY_FIELDS = [
  "Policies",
  "DeletionProtection",
  "LambdaConfig",
  "AutoVerifiedAttributes",
  "SmsVerificationMessage",
  "SmsAuthenticationMessage",
  "UserAttributeUpdateSettings",
  "MfaConfiguration",
  "DeviceConfiguration",
  "EmailConfiguration",
  "SmsConfiguration",
  "UserPoolTags",
  "AdminCreateUserConfig",
  "UserPoolAddOns",
  "AccountRecoverySetting",
] as const;

const client = new CognitoIdentityProviderClient({});

async function main() {
  if (!EMAIL_HTML.includes("{####}")) {
    throw new Error("Template must contain the Cognito {####} code placeholder.");
  }

  const desc = await client.send(
    new DescribeUserPoolCommand({ UserPoolId: USER_POOL_ID })
  );
  const pool = desc.UserPool;
  if (!pool) throw new Error(`User pool ${USER_POOL_ID} not found`);

  const input: UpdateUserPoolCommandInput = { UserPoolId: USER_POOL_ID };
  for (const key of CARRY_FIELDS) {
    const value = (pool as Record<string, unknown>)[key];
    if (value != null) (input as unknown as Record<string, unknown>)[key] = value;
  }

  // UnusedAccountValidityDays is deprecated and conflicts with
  // PasswordPolicy.TemporaryPasswordValidityDays on update — drop it.
  if (input.AdminCreateUserConfig) {
    delete (input.AdminCreateUserConfig as Record<string, unknown>).UnusedAccountValidityDays;
  }

  // Optionally switch the SES sender (e.g. to the verified visoracloud.com identity).
  if (process.env.EMAIL_FROM && process.env.EMAIL_SOURCE_ARN) {
    input.EmailConfiguration = {
      EmailSendingAccount: "DEVELOPER",
      From: process.env.EMAIL_FROM,
      SourceArn: process.env.EMAIL_SOURCE_ARN,
      ReplyToEmailAddress: process.env.EMAIL_REPLY_TO ?? process.env.EMAIL_FROM,
    };
  }

  input.VerificationMessageTemplate = {
    DefaultEmailOption: "CONFIRM_WITH_CODE",
    EmailSubject: SUBJECT,
    EmailMessage: EMAIL_HTML,
  };

  console.log(`Pool: ${USER_POOL_ID}`);
  console.log(`From: ${pool.EmailConfiguration?.From ?? "(none)"}`);
  console.log(`Subject: ${SUBJECT}`);
  console.log(`Template length: ${EMAIL_HTML.length} chars (Cognito limit 20000)`);

  if (!APPLY) {
    console.log("\nDRY-RUN only — no changes written. Set APPLY=1 to apply.");
    return;
  }

  await client.send(new UpdateUserPoolCommand(input));
  console.log("\nApplied: verification email template updated (SES config preserved).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
