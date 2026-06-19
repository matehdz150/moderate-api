import {
  createVisoraError,
  VisoraTimeoutError,
} from "./errors.js";
import type {
  BinaryImageInput,
  ModerateImageKeyParams,
  ModerateImageParams,
  ModerationLogsResponse,
  ModerationResponse,
  UploadUrlResponse,
  VisoraClientOptions,
} from "./types.js";

export const DEFAULT_VISORA_BASE_URL =
  "https://6p0ws7vu2f.execute-api.us-east-1.amazonaws.com/dev";

const DEFAULT_TIMEOUT_MS = 30_000;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  return fallback;
}

function toBlobPart(file: Exclude<BinaryImageInput, Blob>): BlobPart {
  if (file instanceof ArrayBuffer) {
    return file;
  }

  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);

  return new Uint8Array(bytes);
}

function toImageBlob(file: BinaryImageInput, contentType: string) {
  if (file instanceof Blob) {
    return file;
  }

  return new Blob([toBlobPart(file)], { type: contentType });
}

export class Visora {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: VisoraClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("Visora apiKey is required");
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_VISORA_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async moderateImage(params: ModerateImageParams): Promise<ModerationResponse> {
    const contentType = params.contentType ?? "image/jpeg";
    const filename = params.filename ?? "image.jpg";
    const formData = new FormData();

    formData.append("image", toImageBlob(params.file, contentType), filename);

    return this.request<ModerationResponse>("/moderate", {
      method: "POST",
      body: formData,
    });
  }

  async moderateImageKey(
    params: ModerateImageKeyParams
  ): Promise<ModerationResponse> {
    return this.request<ModerationResponse>("/moderate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageKey: params.imageKey }),
    });
  }

  async createUploadUrl(): Promise<UploadUrlResponse> {
    return this.request<UploadUrlResponse>("/upload-url", {
      method: "POST",
    });
  }

  async listModerationLogs(): Promise<ModerationLogsResponse> {
    return this.request<ModerationLogsResponse>("/moderation-logs", {
      method: "GET",
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "x-api-key": this.apiKey,
          ...init.headers,
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as T | { error?: string; message?: string } | null;

      if (!response.ok) {
        throw createVisoraError({
          statusCode: response.status,
          message: getErrorMessage(payload, response.statusText),
          responseBody: payload,
        });
      }

      return payload as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new VisoraTimeoutError(this.timeoutMs);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
