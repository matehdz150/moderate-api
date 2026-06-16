import {
  DetectModerationLabelsCommand,
  RekognitionClient,
  type ModerationLabel as AwsModerationLabel,
} from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient({});

export async function detectModerationLabels(
  bucketName: string,
  imageKey: string
): Promise<AwsModerationLabel[]> {
  const command = new DetectModerationLabelsCommand({
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: imageKey,
      },
    },
    MinConfidence: 70,
  });

  const result = await rekognitionClient.send(command);

  return result.ModerationLabels ?? [];
}