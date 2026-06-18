export interface ProjectRecord {
  accountId: string;
  projectId: string;
  name: string;
  planId: string;
  monthlyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
}
