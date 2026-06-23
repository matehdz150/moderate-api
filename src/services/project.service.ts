import { ulid } from "ulid";

import { createProjectRecord } from "../repositories/project.repository.js";
import { savePolicy } from "../repositories/policy.repository.js";
import type { ProjectRecord, ProjectType, RedactionSettings } from "../types/project.types.js";
import { normalizeRedactionSettings } from "../utils/redaction-settings.js";
import { normalizeVerifySettings } from "../utils/verify-settings.js";
import { getDefaultModerationPolicy } from "./policy-engine.service.js";

export async function createProject(params: {
  accountId: string;
  name: string;
  planId: string;
  monthlyLimit: number;
  projectType?: ProjectType;
  redactionSettings?: Partial<RedactionSettings>;
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const projectId = `proj_${ulid().toLowerCase()}`;
  const projectType = params.projectType ?? "moderation";
  const project: ProjectRecord = {
    accountId: params.accountId,
    projectId,
    name: params.name,
    projectType,
    ...(projectType === "redaction"
      ? { redactionSettings: normalizeRedactionSettings(params.redactionSettings) }
      : {}),
    ...(projectType === "verify"
      ? { verifySettings: normalizeVerifySettings() }
      : {}),
    planId: params.planId,
    monthlyLimit: params.monthlyLimit,
    createdAt: now,
    updatedAt: now,
  };

  await createProjectRecord(project);

  if (projectType === "moderation") {
    await savePolicy({
      ...getDefaultModerationPolicy(projectId),
      createdAt: now,
      updatedAt: now,
    });
  }

  return project;
}
