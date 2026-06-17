import { HttpError } from "./http-response.js";

export function parseJsonObjectBody(body: string | null) {
  if (!body) {
    throw new HttpError(400, "Request body is required");
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  if (
    !parsedBody ||
    typeof parsedBody !== "object" ||
    Array.isArray(parsedBody)
  ) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  return parsedBody as Record<string, unknown>;
}
