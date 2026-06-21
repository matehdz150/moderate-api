// src/services/s3.service.ts
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});

interface S3RetentionTags {
  planId: string;
  retentionDays: number;
}

function buildTagging(tags: S3RetentionTags) {
  return new URLSearchParams({
    "visora-plan": tags.planId,
    "visora-retention-days": String(tags.retentionDays),
  }).toString();
}

function copyToStandardBuffer(buffer: Buffer) {
  const output = Buffer.alloc(buffer.length);
  buffer.copy(output);
  return output;
}

export async function createUploadUrl(
  bucketName: string,
  imageKey: string,
  retentionTags: S3RetentionTags
) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: imageKey,
    ContentType: "image/jpeg",
    Tagging: buildTagging(retentionTags),
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: 60 * 5,
  });
}

export async function createImageReadUrl(bucketName: string, imageKey: string) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: imageKey,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: 60 * 5,
  });
}

export async function uploadImageObject(params: {
  bucketName: string;
  imageKey: string;
  contentType: string;
  body: Buffer;
  retentionTags: S3RetentionTags;
}) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: params.bucketName,
      Key: params.imageKey,
      ContentType: params.contentType,
      Tagging: buildTagging(params.retentionTags),
      Body: copyToStandardBuffer(params.body),
    })
  );
}

export async function downloadImageObject(params: {
  bucketName: string;
  imageKey: string;
}): Promise<Buffer> {
  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: params.bucketName,
      Key: params.imageKey,
    })
  );

  const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;

  if (!body?.transformToByteArray) {
    throw new Error("S3 object body is not readable");
  }

  return Buffer.from(await body.transformToByteArray());
}
