import { describe, expect, it } from "vitest";
import {
  createPixabayApiUrl,
  createPixabayFallbackUrl,
  isAllowedPixabayImageUrl,
  parsePixabayImages
} from "./imageProviders.js";

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
          previewURL: "https://cdn.pixabay.com/preview.jpg",
          largeImageURL: "https://cdn.pixabay.com/large.jpg",
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

  it("drops hits with unsafe preview, download, or page URLs", () => {
    const base = {
      id: 123,
      previewURL: "https://cdn.pixabay.com/preview.jpg",
      largeImageURL: "https://cdn.pixabay.com/large.jpg",
      pageURL: "https://pixabay.com/photos/test-123/"
    };

    expect(
      parsePixabayImages({
        hits: [
          { ...base, previewURL: "https://127.0.0.1/private.jpg" },
          { ...base, largeImageURL: "https://example.com/large.jpg" },
          { ...base, pageURL: "https://pixabay.com.evil.test/photos/test-123/" },
          { ...base, previewURL: "https://user@cdn.pixabay.com/preview.jpg" },
          { ...base, largeImageURL: "https://cdn.pixabay.com:444/large.jpg" }
        ]
      })
    ).toEqual([]);
    expect(isAllowedPixabayImageUrl("https://cdn.pixabay.com/preview.jpg")).toBe(true);
  });
});
