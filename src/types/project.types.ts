export type ProjectType = "moderation" | "redaction" | "verify";
export type RedactionStyle = "blur" | "black_box";
export type RedactionTextCategory =
  | "sexual"
  | "profanity"
  | "credentials"
  | "id_document"
  | "pii"
  | "financial"
  | "medical"
  | "dates";

export interface RedactionSettings {
  faceBlur: boolean;
  textBlur: boolean;
  licensePlateBlur: boolean;
  redactionStyle: RedactionStyle;
  textCategories: RedactionTextCategory[];
  customWords: string[];
  ignoredWords: string[];
  minConfidence: number;
}

export interface ProjectRecord {
  accountId: string;
  projectId: string;
  name: string;
  projectType: ProjectType;
  redactionSettings?: RedactionSettings;
  planId: string;
  monthlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  projectType?: ProjectType;
  redactionSettings?: Partial<RedactionSettings>;
}
