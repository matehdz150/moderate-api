import {
  AnalyzeIDCommand,
  TextractClient,
} from "@aws-sdk/client-textract";

const textractClient = new TextractClient({});

export interface AnalyzeIdField {
  key: string;
  value: string;
  confidence: number;
}

export interface AnalyzeIdResult {
  detected: boolean;
  fields: AnalyzeIdField[];
}

/** Runs Textract AnalyzeID over an identity document in S3 and returns the
 *  normalized fields (FIRST_NAME, LAST_NAME, DATE_OF_BIRTH, DOCUMENT_NUMBER,
 *  EXPIRATION_DATE, ID_TYPE, ...) with per-field confidence. */
export async function analyzeIdDocument(
  bucketName: string,
  imageKey: string
): Promise<AnalyzeIdResult> {
  const command = new AnalyzeIDCommand({
    DocumentPages: [{ S3Object: { Bucket: bucketName, Name: imageKey } }],
  });

  const result = await textractClient.send(command);
  const document = result.IdentityDocuments?.[0];
  const rawFields = document?.IdentityDocumentFields ?? [];

  const fields: AnalyzeIdField[] = [];

  for (const field of rawFields) {
    const key = field.Type?.Text;
    const value = field.ValueDetection?.Text?.trim();
    const confidence = field.ValueDetection?.Confidence ?? 0;

    if (!key || !value) continue;

    fields.push({ key, value, confidence });
  }

  return { detected: fields.length > 0, fields };
}
