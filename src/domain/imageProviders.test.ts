import { describe, expect, it } from "vitest";
import { createPixabayApiUrl, createPixabayFallbackUrl, parsePixabayImages } from "./imageProviders.js";

describe("Pixabay image provider helpers", () => {
  it("builds Korean fallback search URLs", () => {
    expect(createPixabayFallbackUrl("money note")).toBe(
      "https://pixabay.com/ko/images/search/money%20note/"
    );
  });

  it("builds API URLs without exposing keys to the renderer", () => {
    const url = createPixabayApiUrl("key-123", "finance", 2);

    expect(url.hostname).toBe("pixabay.com");
    expect(url.searchParams.get("key")).toBe("key-123");
    expect(url.searchParams.get("q")).toBe("finance");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("parses valid hits and drops incomplete entries", () => {
    const images = parsePixabayImages({
      hits: [
        {
          id: 123,
          previewURL: "https://cdn.example/preview.jpg",
          largeImageURL: "https://cdn.example/large.jpg",
          pageURL: "https://pixabay.com/photos/test-123/",
          user: "maker",
          imageWidth: 1920,
          imageHeight: 1080
        },
        { id: 456, previewURL: "missing-large" }
      ]
    });

    expect(images).toHaveLength(1);
    expect(images[0]?.id).toBe("123");
    expect(images[0]?.author).toBe("maker");
  });
});
