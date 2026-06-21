export type ProjectType = "moderation" | "redaction";

export interface RedactionSettings {
  faceBlur: boolean;
  textBlur: boolean;
  licensePlateBlur: boolean;
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
