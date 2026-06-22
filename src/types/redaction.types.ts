export interface RedactImageRequest {
  imageKey: string;
}

export interface RedactionFace {
  confidence: number;
  boundingBox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export type RedactionRegionType = "face" | "text" | "license_plate";

export interface RedactionRegion {
  type: RedactionRegionType;
  text?: string;
  confidence: number;
  boundingBox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface RedactionResponse {
  redactionId: string;
  imageKey: string;
  redactedImageKey: string;
  redactedImageUrl: string;
  facesBlurred: number;
  textBlurred: number;
  licensePlatesBlurred: number;
  faces: RedactionFace[];
  regions: RedactionRegion[];
}

export interface RedactionLogRecord {
  redactionId: string;
  accountId: string;
  projectId: string;
  planId: string;
  imageKey: string;
  redactedImageKey: string;
  style: "blur" | "black_box";
  facesBlurred: number;
  textBlurred: number;
  licensePlatesBlurred: number;
  regions: RedactionRegion[];
  createdAt: string;
}

export interface RedactionLogEntry extends RedactionLogRecord {
  imageUrl?: string;
  redactedImageUrl?: string;
}
