import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  isAllowedPixabayImageUrl,
  isAllowedPixabayPageUrl
} from "../src/domain/imageProviders.js";
import type { StockImageDownloadInput } from "../src/domain/types.js";

export const maxStockImageBytes = 20 * 1024 * 1024;
export const stockImageDownloadTimeoutMs = 30_000;

const pixabayImageIdPattern = /^\d{1,20}$/;
const supportedImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);

export function isSafeStockImageDownloadInput(input: unknown): input is StockImageDownloadInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    record["provider"] === "pixabay" &&
    typeof record["id"] === "string" &&
    pixabayImageIdPattern.test(record["id"]) &&
    typeof record["imageUrl"] === "string" &&
    isAllowedPixabayImageUrl(record["imageUrl"]) &&
    typeof record["pageUrl"] === "string" &&
    isAllowedPixabayPageUrl(record["pageUrl"]) &&
    typeof record["author"] === "string" &&
    record["author"].trim().length > 0 &&
    record["author"].length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(record["author"])
  );
}

export async function fetchAllowedPixabayImage(
  input: string | URL,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = stockImageDownloadTimeoutMs
): Promise<Response> {
  const parsedUrl = parseUrl(input);
  if (!parsedUrl || !isAllowedPixabayImageUrl(parsedUrl)) {
    throw new Error("Pixabay 이미지 URL만 다운로드할 수 있습니다.");
  }
  let currentUrl: URL = parsedUrl;

  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  try {
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const response: Response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: abortController.signal
      });
      if (response.status < 300 || response.status >= 400) {
        return response;
      }

      const location: string | null = response.headers.get("location");
      if (!location) {
        throw new Error("이미지 리다이렉트 위치가 없습니다.");
      }

      const nextUrl: URL = new URL(location, currentUrl);
      if (!isAllowedPixabayImageUrl(nextUrl)) {
        throw new Error("Pixabay 외부 주소로 이동하는 이미지는 다운로드할 수 없습니다.");
      }
      currentUrl = nextUrl;
    }

    throw new Error("이미지 리다이렉트 횟수가 너무 많습니다.");
  } catch (error) {
    if (timedOut) {
      throw new Error("이미지 서버 응답 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readResponseBytesWithLimit(
  response: Response,
  maximumBytes = maxStockImageBytes,
  timeoutMs = stockImageDownloadTimeoutMs
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`이미지 크기는 ${formatMegabytes(maximumBytes)}MB 이하여야 합니다.`);
  }
  if (!response.body) {
    throw new Error("이미지 응답 본문이 없습니다.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error("이미지 데이터 수신 시간이 초과되었습니다.");
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error(`이미지 크기는 ${formatMegabytes(maximumBytes)}MB 이하여야 합니다.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export function createStockDownloadPath(downloadDirectory: string, extension: string): string {
  const normalizedExtension = extension.toLowerCase();
  if (!supportedImageExtensions.has(normalizedExtension)) {
    throw new Error("지원하지 않는 이미지 확장자입니다.");
  }

  const resolvedDirectory = path.resolve(downloadDirectory);
  const targetPath = path.resolve(
    resolvedDirectory,
    `pixabay-${randomUUID()}.${normalizedExtension}`
  );
  if (path.dirname(targetPath) !== resolvedDirectory) {
    throw new Error("이미지 다운로드 경로가 안전하지 않습니다.");
  }
  return targetPath;
}

function parseUrl(input: string | URL): URL | undefined {
  try {
    return input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    return undefined;
  }
}

function formatMegabytes(bytes: number): number {
  return Math.floor(bytes / (1024 * 1024));
}
