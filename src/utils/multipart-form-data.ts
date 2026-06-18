import type { APIGatewayProxyEvent } from "aws-lambda";

import { HttpError } from "./http-response.js";

export interface MultipartFile {
  fieldName: string;
  filename?: string;
  contentType: string;
  content: Buffer;
}

function getHeader(event: APIGatewayProxyEvent, headerName: string) {
  const normalizedHeaderName = headerName.toLowerCase();

  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }

  return undefined;
}

function getBoundary(contentType: string) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];

  if (!boundary) {
    throw new HttpError(400, "multipart/form-data boundary is required");
  }

  return boundary.trim();
}

function parsePartHeaders(rawHeaders: string) {
  const headers: Record<string, string> = {};

  for (const line of rawHeaders.split("\r\n")) {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    headers[key] = value;
  }

  return headers;
}

function parseContentDisposition(value: string | undefined) {
  if (!value) {
    throw new HttpError(400, "Content-Disposition is required for file uploads");
  }

  const name = value.match(/name="([^"]+)"/)?.[1];
  const filename = value.match(/filename="([^"]*)"/)?.[1];

  if (!name) {
    throw new HttpError(400, "File field name is required");
  }

  return { name, filename };
}

export function parseMultipartFiles(event: APIGatewayProxyEvent): MultipartFile[] {
  const contentType = getHeader(event, "content-type");

  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(400, "Content-Type must be multipart/form-data");
  }

  if (!event.body) {
    throw new HttpError(400, "Request body is required");
  }

  const boundary = getBoundary(contentType);
  const bodyBuffer = Buffer.from(
    event.body,
    event.isBase64Encoded ? "base64" : "binary"
  );
  const rawBody = bodyBuffer.toString("binary");
  const parts = rawBody.split(`--${boundary}`);
  const files: MultipartFile[] = [];

  for (const rawPart of parts) {
    if (!rawPart || rawPart === "--\r\n" || rawPart === "--") continue;

    const normalizedPart = rawPart.replace(/^\r\n/, "").replace(/\r\n--$/, "");
    const separatorIndex = normalizedPart.indexOf("\r\n\r\n");

    if (separatorIndex === -1) continue;

    const rawHeaders = normalizedPart.slice(0, separatorIndex);
    let rawContent = normalizedPart.slice(separatorIndex + 4);

    if (rawContent.endsWith("\r\n")) {
      rawContent = rawContent.slice(0, -2);
    }

    const headers = parsePartHeaders(rawHeaders);
    const disposition = parseContentDisposition(headers["content-disposition"]);

    if (!disposition.filename) continue;

    files.push({
      fieldName: disposition.name,
      filename: disposition.filename,
      contentType: headers["content-type"] ?? "application/octet-stream",
      content: Buffer.from(rawContent, "binary"),
    });
  }

  return files;
}
