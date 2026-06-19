# @visoracloud/client

Official Node.js and TypeScript client for the Visora Cloud image moderation API.

## Install

```bash
npm install @visoracloud/client
```

## Usage

```ts
import { readFile } from "node:fs/promises";
import { Visora } from "@visoracloud/client";

const visora = new Visora({
  apiKey: process.env.VISORA_API_KEY!,
});

const image = await readFile("./image.jpg");

const result = await visora.moderateImage({
  file: image,
  filename: "image.jpg",
  contentType: "image/jpeg",
});

console.log(result.action, result.riskScore, result.labels);
```

## Moderate an Existing Image Key

```ts
const result = await visora.moderateImageKey({
  imageKey: "accounts/acc_123/projects/proj_123/uploads/image.jpg",
});
```

## Errors

```ts
import { VisoraRateLimitError } from "@visoracloud/client";

try {
  await visora.moderateImage({ file: image });
} catch (error) {
  if (error instanceof VisoraRateLimitError) {
    console.log("Monthly limit exceeded");
  }
}
```

This SDK is Node-first. Do not expose secret API keys in browser code.
