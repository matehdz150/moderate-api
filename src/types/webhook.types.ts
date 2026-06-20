export type WebhookEventType =
  | "moderation.completed"
  | "moderation.review_required"
  | "review.approved"
  | "review.rejected";

export type WebhookEndpointStatus = "active" | "disabled";
export type WebhookEventStatus = "pending" | "delivered" | "failed" | "skipped";

export interface WebhookEndpointRecord {
  webhookId: string;
  accountId: string;
  projectId: string;
  name?: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  status: WebhookEndpointStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PublicWebhookEndpoint {
  webhookId: string;
  accountId: string;
  projectId: string;
  name?: string;
  url: string;
  events: WebhookEventType[];
  status: WebhookEndpointStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEventRecord {
  eventId: string;
  type: WebhookEventType;
  accountId: string;
  projectId: string;
  payload: Record<string, unknown>;
  status: WebhookEventStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  deliveredAt?: string;
  skippedAt?: string;
}

export interface WebhookQueueMessage {
  eventId: string;
}
