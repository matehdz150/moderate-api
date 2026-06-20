import type { APIGatewayProxyEvent } from "aws-lambda";

import {
  getReviewQueueItem,
  listReviewQueueByAccount,
  listReviewQueueByProject,
  updateReviewQueueDecision,
} from "../repositories/review-queue.repository.js";
import { getProjectById } from "../repositories/project.repository.js";
import { ensureAccountForUser } from "../services/account.service.js";
import { createImageReadUrl } from "../services/s3.service.js";
import { publishWebhookEvent } from "../services/webhook-event.service.js";
import type { CognitoAuthContext } from "../types/cognito.types.js";
import type {
  ReviewQueueItem,
  ReviewQueueRecord,
  ReviewStatus,
} from "../types/review.types.js";
import { HttpError, ok } from "../utils/http-response.js";
import { parseJsonObjectBody } from "../utils/request-body.js";

const BUCKET_NAME = process.env.IMAGES_BUCKET_NAME;
const REVIEW_STATUSES = new Set<ReviewStatus>([
  "pending",
  "approved",
  "rejected",
  "ignored",
]);
const REVIEW_DECISIONS = new Set<Extract<ReviewStatus, "approved" | "rejected" | "ignored">>([
  "approved",
  "rejected",
  "ignored",
]);

function parseStatus(value: string | undefined): ReviewStatus {
  if (!value) {
    return "pending";
  }

  if (!REVIEW_STATUSES.has(value as ReviewStatus)) {
    throw new HttpError(400, "status must be pending, approved, rejected, or ignored");
  }

  return value as ReviewStatus;
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

function parseDecision(value: unknown) {
  if (typeof value !== "string" || !REVIEW_DECISIONS.has(value as never)) {
    throw new HttpError(400, "decision must be approved, rejected, or ignored");
  }

  return value as Extract<ReviewStatus, "approved" | "rejected" | "ignored">;
}

function parseReviewId(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "reviewId must be a non-empty string");
  }

  return value.trim();
}

function isConditionalCheckFailed(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

async function withImageUrls(
  reviews: ReviewQueueRecord[]
): Promise<ReviewQueueItem[]> {
  if (!BUCKET_NAME) {
    return reviews;
  }

  return Promise.all(
    reviews.map(async (review) => ({
      ...review,
      imageUrl: await createImageReadUrl(BUCKET_NAME, review.imageKey),
    }))
  );
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

export async function listReviewQueueRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
  ) {
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const projectId = event.queryStringParameters?.projectId?.trim();
  const reviewId = event.queryStringParameters?.reviewId?.trim();
  const status = parseStatus(event.queryStringParameters?.status);
  const limit = parseLimit(event.queryStringParameters?.limit);

  if (reviewId) {
    const review = await getReviewQueueItem(reviewId);

    if (!review || review.accountId !== account.accountId) {
      throw new HttpError(404, "Review not found");
    }

    const [reviewWithImageUrl] = await withImageUrls([review]);

    return ok({ review: reviewWithImageUrl });
  }

  if (projectId) {
    await ensureProjectAccess({
      accountId: account.accountId,
      projectId,
    });

    const reviews = await listReviewQueueByProject({
      projectId,
      status,
      limit,
    });

    return ok({ reviews: await withImageUrls(reviews) });
  }

  const reviews = await listReviewQueueByAccount({
    accountId: account.accountId,
    status,
    limit,
  });

  return ok({ reviews: await withImageUrls(reviews) });
}

export async function decideReviewQueueRoute(
  event: APIGatewayProxyEvent,
  authContext: CognitoAuthContext
) {
  const body = parseJsonObjectBody(event.body);
  const reviewId = parseReviewId(body.reviewId);
  const decision = parseDecision(body.decision);
  const decisionReason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim()
      : undefined;
  const account = await ensureAccountForUser({
    userId: authContext.userId,
    email: authContext.email,
  });
  const review = await getReviewQueueItem(reviewId);

  if (!review || review.accountId !== account.accountId) {
    throw new HttpError(404, "Review not found");
  }

  try {
    const updatedReview = await updateReviewQueueDecision({
      reviewId,
      accountId: review.accountId,
      projectId: review.projectId,
      status: decision,
      reviewedAt: new Date().toISOString(),
      reviewedBy: authContext.userId,
      decisionReason: decisionReason ?? "",
    });
    if (decision === "approved" || decision === "rejected") {
      await publishWebhookEvent({
        type: decision === "approved" ? "review.approved" : "review.rejected",
        accountId: updatedReview.accountId,
        projectId: updatedReview.projectId,
        payload: {
          reviewId: updatedReview.reviewId,
          moderationId: updatedReview.moderationId,
          imageKey: updatedReview.imageKey,
          status: updatedReview.status,
          reviewedAt: updatedReview.reviewedAt,
          reviewedBy: updatedReview.reviewedBy,
          decisionReason: updatedReview.decisionReason,
          riskScore: updatedReview.riskScore,
          category: updatedReview.category,
          labels: updatedReview.labels,
          explanation: updatedReview.explanation,
          brandSafety: updatedReview.brandSafety,
          ...(updatedReview.compliance ? { compliance: updatedReview.compliance } : {}),
        },
      });
    }

    const [reviewWithImageUrl] = await withImageUrls([updatedReview]);

    return ok({ review: reviewWithImageUrl });
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new HttpError(409, "Review has already been resolved");
    }

    throw error;
  }
}
