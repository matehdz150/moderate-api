import {
  DetectModerationLabelsCommand,
  RekognitionClient,
  type ModerationLabel as AwsModerationLabel,
} from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient({});
const REKOGNITION_MIN_CONFIDENCE = 40;

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
    MinConfidence: REKOGNITION_MIN_CONFIDENCE,
  });

  const result = await rekognitionClient.send(command);

  return result.ModerationLabels ?? [];
}
