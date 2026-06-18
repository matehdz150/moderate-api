import { ulid } from "ulid";

import { createProjectRecord } from "../repositories/project.repository.js";
import { savePolicy } from "../repositories/policy.repository.js";
import type { ProjectRecord } from "../types/project.types.js";
import { getDefaultModerationPolicy } from "./policy-engine.service.js";

export async function createProject(params: {
  accountId: string;
  name: string;
  planId: string;
  monthlyLimit: number;
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const projectId = `proj_${ulid().toLowerCase()}`;
  const project: ProjectRecord = {
    accountId: params.accountId,
    projectId,
    name: params.name,
    planId: params.planId,
    monthlyLimit: params.monthlyLimit,
    createdAt: now,
    updatedAt: now,
  };

  await createProjectRecord(project);
  await savePolicy({
    ...getDefaultModerationPolicy(projectId),
    createdAt: now,
    updatedAt: now,
  });

  return project;
}
