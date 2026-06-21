import {
  DetectFacesCommand,
  DetectLabelsCommand,
  DetectModerationLabelsCommand,
  DetectTextCommand,
  RekognitionClient,
  type FaceDetail as AwsFaceDetail,
  type Label as AwsLabel,
  type ModerationLabel as AwsModerationLabel,
  type TextDetection as AwsTextDetection,
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

export async function detectFaces(
  bucketName: string,
  imageKey: string
): Promise<AwsFaceDetail[]> {
  const command = new DetectFacesCommand({
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: imageKey,
      },
    },
    Attributes: ["DEFAULT"],
  });

  const result = await rekognitionClient.send(command);

  return result.FaceDetails ?? [];
}

export async function detectText(
  bucketName: string,
  imageKey: string
): Promise<AwsTextDetection[]> {
  const command = new DetectTextCommand({
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: imageKey,
      },
    },
  });

  const result = await rekognitionClient.send(command);

  return result.TextDetections ?? [];
}
