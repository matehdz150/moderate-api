import {
  DetectLabelsCommand,
  DetectModerationLabelsCommand,
  RekognitionClient,
  type Label as AwsLabel,
  type ModerationLabel as AwsModerationLabel,
} from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient({});
const REKOGNITION_MIN_CONFIDENCE = 40;
const REKOGNITION_GENERAL_LABEL_LIMIT = 50;

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

export async function detectGeneralLabels(
  bucketName: string,
  imageKey: string
): Promise<AwsLabel[]> {
  const command = new DetectLabelsCommand({
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: imageKey,
      },
    },
    MaxLabels: REKOGNITION_GENERAL_LABEL_LIMIT,
    MinConfidence: REKOGNITION_MIN_CONFIDENCE,
  });

  const result = await rekognitionClient.send(command);

  return result.Labels ?? [];
}
