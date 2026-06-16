import { randomBytes } from "node:crypto";

import { hashApiKey } from "../src/utils/crypto.js";

const rawApiKey = `sk_test_${randomBytes(24).toString("hex")}`;
const apiKeyHash = hashApiKey(rawApiKey);

console.log(
  JSON.stringify(
    {
      rawApiKey,
      apiKeyHash,
    },
    null,
    2
  )
);
