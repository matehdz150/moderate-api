export interface StructuredLogContext {
  requestId?: string;
  route?: string;
  accountId?: string;
  projectId?: string;
  [key: string]: unknown;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export function logError(
  event: string,
  context: StructuredLogContext & { error?: unknown }
) {
  const { error, ...rest } = context;

  console.error(
    JSON.stringify({
      level: "error",
      event,
      timestamp: new Date().toISOString(),
      ...rest,
      ...(error ? { error: normalizeError(error) } : {}),
    })
  );
}
