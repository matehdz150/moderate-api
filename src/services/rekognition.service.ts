import {
  CompareFacesCommand,
  DetectFacesCommand,
  DetectLabelsCommand,
  DetectModerationLabelsCommand,
  DetectTextCommand,
  RekognitionClient,
  type CompareFacesMatch as AwsCompareFacesMatch,
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

/** Full-attribute face detection (EyesOpen, Sunglasses, Quality, ...), used by
 *  the Verify product for selfie quality / anti-spoof checks. */
export async function detectFacesDetailed(
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
    Attributes: ["ALL"],
  });

  const result = await rekognitionClient.send(command);

  return result.FaceDetails ?? [];
}

export interface CompareFacesResult {
  /** Best similarity (0-100) of any matched face; 0 when nothing matched. */
  bestSimilarity: number;
  /** Whether the source image contained a detectable face to compare. */
  sourceFaceFound: boolean;
  /** Whether the target image contained any face. */
  targetFaceFound: boolean;
}

/** Compares the largest face in `source` (the selfie) against faces in
 *  `target` (the document portrait). Returns the best similarity score. */
export async function compareFaces(
  sourceBucket: string,
  sourceKey: string,
  targetBucket: string,
  targetKey: string,
  similarityThreshold = 1
): Promise<CompareFacesResult> {
  const command = new CompareFacesCommand({
    SourceImage: { S3Object: { Bucket: sourceBucket, Name: sourceKey } },
    TargetImage: { S3Object: { Bucket: targetBucket, Name: targetKey } },
    SimilarityThreshold: similarityThreshold,
    QualityFilter: "AUTO",
  });

  const result = await rekognitionClient.send(command);

  const matches = (result.FaceMatches ?? []) as AwsCompareFacesMatch[];
  const bestSimilarity = matches.reduce(
    (best, match) => Math.max(best, match.Similarity ?? 0),
    0
  );
  const targetFaceFound =
    matches.length > 0 || (result.UnmatchedFaces?.length ?? 0) > 0;

  return {
    bestSimilarity,
    sourceFaceFound: Boolean(result.SourceImageFace),
    targetFaceFound,
  };
}
