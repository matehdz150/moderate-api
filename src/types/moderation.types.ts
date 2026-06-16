export interface ModerateImageRequest {
  imageKey: string;
}

export interface ModerationLabel {
  name: string;
  confidence: number;
}

export type ModerationAction =
  | "allow"
  | "reject";

export interface ModerationResponse {
  moderationId: string;
  safe: boolean;
  action: ModerationAction;
  labels: ModerationLabel[];
}

export interface UploadUrlResponse {
  uploadUrl: string;
  imageKey: string;
}
