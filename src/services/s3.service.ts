// src/services/s3.service.ts
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({});

export async function createUploadUrl(bucketName: string, imageKey: string) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: imageKey,
    ContentType: "image/jpeg",
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: 60 * 5,
  });
}