import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createStockDownloadPath,
  fetchAllowedPixabayImage,
  isSafeStockImageDownloadInput,
  readResponseBytesWithLimit
} from "./stockImageDownload.js";
import { isAllowedPixabayImageUrl } from "../src/domain/imageProviders.js";

describe("stock image download boundary", () => {
  it("accepts only well-formed Pixabay download records", () => {
    expect(
      isSafeStockImageDownloadInput({
        provider: "pixabay",
        id: "12345",
        imageUrl: "https://cdn.pixabay.com/photo/example.jpg",
        pageUrl: "https://pixabay.com/photos/example-12345/",
        author: "maker"
      })
    ).toBe(true);

    expect(
      isSafeStockImageDownloadInput({
        provider: "pixabay",
        id: "../../outside",
        imageUrl: "https://cdn.pixabay.com/photo/example.jpg",
        pageUrl: "https://pixabay.com/photos/example-12345/",
        author: "maker"
      })
    ).toBe(false);
    expect(
      isSafeStockImageDownloadInput({
        provider: "pixabay",
        id: "12345",
        imageUrl: "https://example.com/image.jpg",
        pageUrl: "https://pixabay.com/photos/example-12345/",
        author: "maker"
      })
    ).toBe(false);
  });

  it("rejects host spoofing, credentials, and nonstandard ports", () => {
    expect(isAllowedPixabayImageUrl("https://cdn.pixabay.com/photo/example.jpg")).toBe(true);
    expect(isAllowedPixabayImageUrl("https://pixabay.com/get/example.jpg")).toBe(true);
    expect(isAllowedPixabayImageUrl("https://pixabay.com.evil.test/image.jpg")).toBe(false);
    expect(isAllowedPixabayImageUrl("https://user@pixabay.com/image.jpg")).toBe(false);
    expect(isAllowedPixabayImageUrl("https://pixabay.com:444/image.jpg")).toBe(false);
  });

  it("blocks redirects outside Pixabay before following them", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } })
    );

    await expect(
      fetchAllowedPixabayImage("https://pixabay.com/get/example.jpg", fetchImpl as typeof fetch)
    ).rejects.toThrow("Pixabay 외부 주소");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a stock-image request when response headers stall", async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );

    await expect(
      fetchAllowedPixabayImage(
        "https://cdn.pixabay.com/photo/example.jpg",
        fetchImpl as typeof fetch,
        5
      )
    ).rejects.toThrow("응답 시간이 초과");
  });

  it("rejects declared and streamed bodies above the size limit", async () => {
    await expect(
      readResponseBytesWithLimit(
        new Response("small", { headers: { "content-length": "100" } }),
        10
      )
    ).rejects.toThrow("0MB 이하");

    await expect(readResponseBytesWithLimit(new Response("01234567890"), 10)).rejects.toThrow(
      "0MB 이하"
    );
    await expect(readResponseBytesWithLimit(new Response("0123456789"), 10)).resolves.toEqual(
      Buffer.from("0123456789")
    );
  });

  it("cancels a stock-image body when the stream stalls", async () => {
    const stalledBody = new ReadableStream<Uint8Array>({});

    await expect(
      readResponseBytesWithLimit(new Response(stalledBody), 1024, 5)
    ).rejects.toThrow("수신 시간이 초과");
  });

  it("creates randomized paths contained by the stock download directory", () => {
    const directory = path.resolve("C:/safe/stock-downloads");
    const first = createStockDownloadPath(directory, "jpg");
    const second = createStockDownloadPath(directory, "jpg");

    expect(path.dirname(first)).toBe(directory);
    expect(path.dirname(second)).toBe(directory);
    expect(first).not.toBe(second);
    expect(() => createStockDownloadPath(directory, "../exe")).toThrow("지원하지 않는");
  });
});
