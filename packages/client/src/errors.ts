export interface VisoraApiErrorOptions {
  statusCode: number;
  message: string;
  responseBody?: unknown;
}

export class VisoraApiError extends Error {
  readonly statusCode: number;
  readonly responseBody?: unknown;

  constructor(options: VisoraApiErrorOptions) {
    super(options.message);
    this.name = "VisoraApiError";
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
  }
}

export class VisoraAuthError extends VisoraApiError {
  constructor(options: VisoraApiErrorOptions) {
    super(options);
    this.name = "VisoraAuthError";
  }
}

export class VisoraRateLimitError extends VisoraApiError {
  constructor(options: VisoraApiErrorOptions) {
    super(options);
    this.name = "VisoraRateLimitError";
  }
}

export class VisoraValidationError extends VisoraApiError {
  constructor(options: VisoraApiErrorOptions) {
    super(options);
    this.name = "VisoraValidationError";
  }
}

export class VisoraTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Visora request timed out after ${timeoutMs}ms`);
    this.name = "VisoraTimeoutError";
  }
}

export function createVisoraError(options: VisoraApiErrorOptions) {
  if (options.statusCode === 401 || options.statusCode === 403) {
    return new VisoraAuthError(options);
  }

  if (options.statusCode === 429) {
    return new VisoraRateLimitError(options);
  }

  if (options.statusCode >= 400 && options.statusCode < 500) {
    return new VisoraValidationError(options);
  }

  return new VisoraApiError(options);
}
