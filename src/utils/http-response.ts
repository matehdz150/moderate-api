export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

export function ok(body: unknown) {
  return jsonResponse(200, body);
}

export function badRequest(message: string) {
  return jsonResponse(400, {
    error: message,
  });
}

export function internalServerError() {
  return jsonResponse(500, {
    error: "Internal server error",
  });
}

export function errorResponse(error: HttpError) {
  return jsonResponse(error.statusCode, {
    error: error.message,
  });
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
