import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { ulid } from "ulid";

import {
  createWebhookEndpoint,
  disableWebhookEndpoint,
  listWebhookEndpointsByAccount,
  toPublicWebhookEndpoint,
} from "../repositories/webhook-endpoint.repository.js";
import { listWebhookEventsByProject } from "../repositories/webhook-event.repository.js";
import { getProjectById, listProjectsByAccount } from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type { WebhookEventStatus, WebhookEventType } from "../types/webhook.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";

const SUPPORTED_EVENTS = new Set<WebhookEventType>([
  "moderation.completed",
  "moderation.review_required",
  "review.approved",
  "review.rejected",
]);

const DEFAULT_EVENTS: WebhookEventType[] = [
  "moderation.completed",
  "moderation.review_required",
  "review.approved",
  "review.rejected",
];

const SUPPORTED_EVENT_STATUSES = new Set<WebhookEventStatus>([
  "pending",
  "delivered",
  "failed",
  "skipped",
]);

function parseProjectId(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "projectId must be a non-empty string");
  }

  return value.trim();
}

function parseWebhookId(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "webhookId must be a non-empty string");
  }

  return value.trim();
}

function parseLimit(value: string | undefined) {
  if (!value) {
    return 50;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "limit must be an integer between 1 and 100");
  }

  return limit;
}

function parseOptionalEventType(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (!SUPPORTED_EVENTS.has(value as WebhookEventType)) {
    throw new HttpError(400, "eventType is not supported");
  }

  return value as WebhookEventType;
}

function parseOptionalEventStatus(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  if (!SUPPORTED_EVENT_STATUSES.has(value as WebhookEventStatus)) {
    throw new HttpError(400, "status must be pending, delivered, failed, or skipped");
  }

  return value as WebhookEventStatus;
}

function parseUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "url must be a non-empty string");
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, "url must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "url must use http or https");
  }

  return url.toString();
}

function parseEvents(value: unknown): WebhookEventType[] {
  if (value === undefined) {
    return DEFAULT_EVENTS;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "events must be a non-empty array");
  }

  const events = value.map((item) => {
    if (typeof item !== "string" || !SUPPORTED_EVENTS.has(item as WebhookEventType)) {
      throw new HttpError(400, "events contains an unsupported event type");
    }

    return item as WebhookEventType;
  });

  return Array.from(new Set(events));
}

function createWebhookSecret() {
  return "whsec_" + randomBytes(32).toString("hex");
}

async function ensureProjectAccess(params: {
  accountId: string;
  projectId: string;
}) {
  const project = await getProjectById(params);

  if (!project) {
    throw new HttpError(404, "Project not found");
  }
}

export async function listWebhooksRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const projectId = event.queryStringParameters?.projectId?.trim();

  if (projectId) {
    await ensureProjectAccess({ accountId: account.accountId, projectId });
  }

  const webhooks = await listWebhookEndpointsByAccount({
    accountId: account.accountId,
    projectId,
  });

  return ok({ webhooks: webhooks.map(toPublicWebhookEndpoint) });
}

export async function createWebhookRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const projectId = parseProjectId(body.projectId);
  const url = parseUrl(body.url);
  const events = parseEvents(body.events);
  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim()
      : undefined;
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });

  await ensureProjectAccess({ accountId: account.accountId, projectId });

  const now = new Date().toISOString();
  const secret = createWebhookSecret();
  const webhook = {
    webhookId: "wh_" + ulid(),
    accountId: account.accountId,
    projectId,
    name,
    url,
    secret,
    events,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  };

  await createWebhookEndpoint(webhook);

  return ok({
    webhook: toPublicWebhookEndpoint(webhook),
    secret,
  });
}

export async function deleteWebhookRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = event.body ? parseJsonObjectBody(event.body) : {};
  const webhookId = parseWebhookId(
    body.webhookId ?? event.queryStringParameters?.webhookId
  );
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const webhook = await disableWebhookEndpoint({
    webhookId,
    accountId: account.accountId,
    updatedAt: new Date().toISOString(),
  });

  if (!webhook) {
    throw new HttpError(404, "Webhook not found");
  }

  return ok({ webhook: toPublicWebhookEndpoint(webhook) });
}

export async function listWebhookEventsRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const projectId = event.queryStringParameters?.projectId?.trim();
  const limit = parseLimit(event.queryStringParameters?.limit);
  const eventType = parseOptionalEventType(event.queryStringParameters?.eventType);
  const status = parseOptionalEventStatus(event.queryStringParameters?.status);

  const project = projectId
    ? await getProjectById({ accountId: account.accountId, projectId })
    : null;
  const projects = projectId
    ? project
      ? [project]
      : []
    : await listProjectsByAccount(account.accountId);

  if (projectId && projects.length === 0) {
    throw new HttpError(404, "Project not found");
  }

  const eventsByProject = await Promise.all(
    projects.map((project) =>
      listWebhookEventsByProject({
        projectId: project.projectId,
        limit,
      })
    )
  );
  const webhookEvents = eventsByProject
    .flat()
    .filter((webhookEvent) => webhookEvent.accountId === account.accountId)
    .filter((webhookEvent) => (eventType ? webhookEvent.type === eventType : true))
    .filter((webhookEvent) => (status ? webhookEvent.status === status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return ok({ events: webhookEvents });
}
