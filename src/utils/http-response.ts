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
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,x-api-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

export function corsPreflight() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,x-api-key",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
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

export function notFound(message: string) {
  return jsonResponse(404, {
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
