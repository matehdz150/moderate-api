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