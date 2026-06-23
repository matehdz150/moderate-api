# @visoracloud/client

Official Node.js and TypeScript client for the Visora Cloud image moderation and redaction API.

## Install

```bash
npm install @visoracloud/client
```

## Moderate an image

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

## Moderate an existing image key

```ts
const result = await visora.moderateImageKey({
  imageKey: "accounts/acc_123/projects/proj_123/uploads/image.jpg",
});
```

## Redact an image

Redaction is available for paid plans and API keys attached to redaction projects. The SDK uploads the image and returns a processed image URL with configured regions blurred or black-boxed.

```ts
import { readFile } from "node:fs/promises";
import { Visora } from "@visoracloud/client";

const visora = new Visora({
  apiKey: process.env.VISORA_REDACTION_API_KEY!,
});

const image = await readFile("./profile.jpg");

const result = await visora.redactImage({
  file: image,
  filename: "profile.jpg",
  contentType: "image/jpeg",
});

console.log(result.redactionId, result.redactedImageUrl);
console.log(result.facesBlurred, result.textBlurred, result.licensePlatesBlurred);
```

## Redact an existing image key

```ts
const result = await visora.redactImageKey({
  imageKey: "accounts/acc_123/projects/proj_123/uploads/image.jpg",
});
```

The `imageKey` must belong to the same account and project as the API key.

## Redaction response

```ts
interface RedactionResponse {
  redactionId: string;
  imageKey: string;
  redactedImageKey: string;
  redactedImageUrl: string;
  facesBlurred: number;
  textBlurred: number;
  licensePlatesBlurred: number;
  faces: RedactionFace[];
  regions: RedactionRegion[];
}
```

Region bounding boxes are normalized values from `0` to `1`:

```ts
type RedactionRegionType = "face" | "text" | "license_plate";

interface RedactionRegion {
  type: RedactionRegionType;
  text?: string;
  confidence: number;
  boundingBox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}
```

## Redaction project settings

Redaction behavior is configured per project from the Visora dashboard. The SDK exports these types for dashboard integrations and shared app types:

```ts
type RedactionStyle = "blur" | "black_box";
type RedactionTextCategory =
  | "id_document"
  | "pii"
  | "dates"
  | "financial"
  | "credentials"
  | "medical"
  | "sexual"
  | "profanity";

interface RedactionSettings {
  faceBlur: boolean;
  textBlur: boolean;
  licensePlateBlur: boolean;
  redactionStyle: RedactionStyle;
  textCategories: RedactionTextCategory[];
  customWords: string[];
  ignoredWords: string[];
  minConfidence: number;
}
```

Defaults are face blur on, text blur off, license plate blur off, `blur` style, no text categories, no custom/ignored words, and `minConfidence` of `80`.

### Detection categories

`textCategories` requires `textBlur` to be on. With `textBlur` on and **no** categories, all detected text is blurred. With categories, only the selected data types are redacted:

| Category | Detects |
| --- | --- |
| `id_document` | Identity-document fields (passport, license, national ID) — blurs sensitive **values** near their labels, not the whole document. |
| `pii` | Emails, phone numbers, addresses, IDs, and tax numbers (RFC, CURP, SSN). |
| `dates` | Dates in any format — DOB, issue, expiry (`01/02/2024`, `2024-01-02`, `Jan 5 2024`). |
| `financial` | Card numbers (Luhn-checked), bank accounts, IBAN, and CLABE. |
| `credentials` | Passwords, API keys (`sk_`, `ghp_`, AWS), tokens, JWTs, and secrets. |
| `medical` | Patient IDs, record numbers, and case numbers near their labels. |
| `sexual` / `profanity` | Explicit or offensive wording. |

`customWords` redacts exact words/phrases; `ignoredWords` prevents specific words (e.g. field labels) from being redacted.

## Verify an identity

Verify checks an identity document against a selfie in a single call: document authenticity (OCR), face match, and selfie quality / anti-spoof signals. It returns one decision — `verified`, `review`, or `rejected`. Use an API key attached to a **verify** project.

```ts
import { readFile } from "node:fs/promises";
import { Visora } from "@visoracloud/client";

const visora = new Visora({
  apiKey: process.env.VISORA_VERIFY_API_KEY!,
});

const [document, selfie] = await Promise.all([
  readFile("./id-document.jpg"),
  readFile("./selfie.jpg"),
]);

const result = await visora.verifyImage({
  document,
  selfie,
  contentType: "image/jpeg",
});

console.log(result.decision); // "verified" | "review" | "rejected"
console.log(result.faceMatch.similarity); // 0-100
console.log(result.reasons);
```

## Verify with existing image keys

```ts
const result = await visora.verifyImageKey({
  documentImageKey: "accounts/acc_123/projects/proj_123/uploads/document.jpg",
  selfieImageKey: "accounts/acc_123/projects/proj_123/uploads/selfie.jpg",
});
```

Both keys must belong to the same account and project as the API key.

## Verify response

```ts
interface VerifyResponse {
  verificationId: string;
  decision: "verified" | "review" | "rejected";
  confidence: number; // 0-100, confidence in the decision
  reasons: string[]; // human-readable flags, empty when fully verified
  document: {
    detected: boolean;
    type?: string; // e.g. "DRIVER LICENSE", "PASSPORT"
    fields: { key: string; value: string; confidence: number }[];
    expired: boolean;
    expirationDate?: string;
  };
  faceMatch: { matched: boolean; similarity: number };
  selfie: {
    quality: "pass" | "fail";
    faceCount: number;
    checks: {
      singleFace: boolean;
      eyesOpen: boolean;
      noSunglasses: boolean;
      sharp: boolean;
      wellLit: boolean;
    };
  };
  documentImageKey: string;
  selfieImageKey: string;
  createdAt: string;
}
```

How the decision is reached:

- **rejected** — no document detected, no face in either image, document expired (if required), or face match below the project's reject cutoff.
- **verified** — face match at/above the auto-approve threshold, a valid document, and a passing selfie.
- **review** — anything in between (e.g. a borderline face match or a low-quality selfie).

## Verify project settings

Thresholds are configured per project from the Visora dashboard:

```ts
interface VerifySettings {
  faceMatchThreshold: number;    // auto-approve at/above this similarity (default 90)
  faceMatchRejectBelow: number;  // reject below this similarity (default 60)
  requireUnexpiredDocument: boolean; // reject expired documents (default true)
}
```

## Webhook signatures

Visora signs every webhook delivery with:

- `visora-timestamp`
- `visora-signature`
- HMAC SHA-256 over `timestamp.rawBody`
- signature format `v1=<hex>`

```ts
import { verifyWebhookSignature } from "@visoracloud/client";

const valid = verifyWebhookSignature({
  secret: process.env.VISORA_WEBHOOK_SECRET!,
  payload: rawBody,
  timestamp: request.headers["visora-timestamp"] as string,
  signature: request.headers["visora-signature"] as string,
});
```

During secret rotation, pass the current and previous secret:

```ts
const valid = verifyWebhookSignature({
  secret: [process.env.VISORA_WEBHOOK_SECRET!, process.env.VISORA_PREVIOUS_WEBHOOK_SECRET!],
  payload: rawBody,
  timestamp,
  signature,
});
```

## Next.js webhook route

```ts
import { createNextWebhookHandler } from "@visoracloud/client";

export const POST = createNextWebhookHandler({
  secret: process.env.VISORA_WEBHOOK_SECRET!,
  async onEvent(event) {
    switch (event.type) {
      case "moderation.completed":
        await updateImageModeration(event.data.moderationId, event.data.action);
        break;
      case "moderation.review_required":
        await notifyReviewTeam(event.data.reviewId);
        break;
      case "review.approved":
      case "review.rejected":
        await syncReviewDecision(event.data.reviewId, event.type);
        break;
      case "redaction.completed":
        // event.data is narrowed to VisoraRedactionCompletedData
        await storeRedactedImage(event.data.redactionId, event.data.redactedImageKey);
        break;
      case "verification.completed":
        // event.data is narrowed to VisoraVerificationCompletedData
        await storeVerification(event.data.verificationId, event.data.decision);
        break;
    }
  },
});
```

## Express webhook route

Use `express.raw()` so the SDK can verify the exact payload Visora signed.

```ts
import express from "express";
import { createExpressWebhookHandler } from "@visoracloud/client";

const app = express();

app.post(
  "/webhooks/visora",
  express.raw({ type: "application/json" }),
  createExpressWebhookHandler({
    secret: process.env.VISORA_WEBHOOK_SECRET!,
    async onEvent(event) {
      if (event.type === "moderation.completed") {
        await updateImageModeration(event.data.moderationId, event.data.action);
      }
    },
  })
);
```

## Webhook event types

```ts
import type { VisoraWebhookEvent, VisoraWebhookEventType } from "@visoracloud/client";

const eventTypes: VisoraWebhookEventType[] = [
  "moderation.completed",
  "moderation.review_required",
  "review.approved",
  "review.rejected",
  "redaction.completed",
  "verification.completed",
];

function handleEvent(event: VisoraWebhookEvent) {
  if (event.type === "moderation.completed") {
    console.log(event.data.moderationId, event.data.action);
  }
}
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

This SDK is Node-first. Do not expose secret API keys or webhook signing secrets in browser code.
