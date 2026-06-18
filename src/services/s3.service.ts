// src/services/s3.service.ts
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
}) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: params.bucketName,
      Key: params.imageKey,
      ContentType: params.contentType,
      Body: params.body,
    })
  );
}
