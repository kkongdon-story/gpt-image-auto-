import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { getMediaAsset, type MediaLibraryError } from "../src/storage/mediaLibrary.js";

export const CARDNEWS_MEDIA_SCHEME = "cardnews-media";
const mediaAssetHost = "asset";

export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CARDNEWS_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ]);
}

export function installMediaProtocolHandler(storageRoot: () => string): void {
  protocol.handle(CARDNEWS_MEDIA_SCHEME, createMediaProtocolHandler(storageRoot));
}

export function createMediaAssetUrl(mediaId: string): string {
  return `${CARDNEWS_MEDIA_SCHEME}://${mediaAssetHost}/${encodeURIComponent(mediaId)}`;
}

export function createMediaProtocolHandler(
  storageRoot: () => string
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return responseWithStatus(405, "Method Not Allowed");
    }

    const mediaId = parseMediaId(request.url);
    if (!mediaId) {
      return responseWithStatus(400, "Invalid media asset URL");
    }

    const asset = await getMediaAsset(storageRoot(), mediaId);
    if (isMediaLibraryError(asset) || asset.missing) {
      return responseWithStatus(404, "Media asset not found");
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(asset.absolutePath);
    } catch {
      return responseWithStatus(404, "Media asset not found");
    }
    if (!stat.isFile()) {
      return responseWithStatus(404, "Media asset not found");
    }

    const range = parseByteRange(request.headers.get("range"), stat.size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${stat.size}`
        }
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, stat.size - 1);
    const contentLength = stat.size === 0 ? 0 : end - start + 1;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(contentLength),
      "Content-Type": asset.mimeType,
      "Cross-Origin-Resource-Policy": "same-origin"
    });
    if (range) {
      headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    }

    if (request.method === "HEAD" || stat.size === 0) {
      return new Response(null, { status: range ? 206 : 200, headers });
    }

    const nodeStream = createReadStream(asset.absolutePath, { start, end });
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  };
}

function parseMediaId(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== `${CARDNEWS_MEDIA_SCHEME}:` ||
      url.hostname !== mediaAssetHost ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (pathSegments.length !== 1) {
      return undefined;
    }
    const mediaId = decodeURIComponent(pathSegments[0] ?? "");
    return /^(image|video)-[a-f0-9]{20}-[A-Za-z0-9-]{8}$/.test(mediaId)
      ? mediaId
      : undefined;
  } catch {
    return undefined;
  }
}

function parseByteRange(
  rangeHeader: string | null,
  size: number
): { readonly start: number; readonly end: number } | "invalid" | undefined {
  if (!rangeHeader) {
    return undefined;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || size <= 0) {
    return "invalid";
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) {
    return "invalid";
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function isMediaLibraryError(value: unknown): value is MediaLibraryError {
  return Boolean(value && typeof value === "object" && "ok" in value && value.ok === false);
}

function responseWithStatus(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
