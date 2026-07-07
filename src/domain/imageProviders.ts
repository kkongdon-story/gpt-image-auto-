import type { StockImage } from "./types.js";

export function createPixabayFallbackUrl(query: string): string {
  return `https://pixabay.com/ko/images/search/${encodeURIComponent(query)}/`;
}

export function createPixabayApiUrl(apiKey: string, query: string, page: number): URL {
  const endpoint = new URL("https://pixabay.com/api/");
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("image_type", "photo");
  endpoint.searchParams.set("safesearch", "true");
  endpoint.searchParams.set("per_page", "24");
  endpoint.searchParams.set("page", String(Math.max(1, Math.floor(page))));
  return endpoint;
}

export function parsePixabayImages(parsed: unknown): readonly StockImage[] {
  if (typeof parsed !== "object" || parsed === null || !("hits" in parsed) || !Array.isArray(parsed.hits)) {
    return [];
  }

  return parsed.hits
    .map(parsePixabayHit)
    .filter((image): image is StockImage => image !== undefined);
}

function parsePixabayHit(hit: unknown): StockImage | undefined {
  if (typeof hit !== "object" || hit === null || Array.isArray(hit)) {
    return undefined;
  }

  const record = hit as Record<string, unknown>;
  const id = typeof record["id"] === "number" ? String(record["id"]) : undefined;
  const previewUrl = typeof record["previewURL"] === "string" ? record["previewURL"] : undefined;
  const imageUrl =
    typeof record["largeImageURL"] === "string"
      ? record["largeImageURL"]
      : typeof record["webformatURL"] === "string"
        ? record["webformatURL"]
        : undefined;
  const pageUrl = typeof record["pageURL"] === "string" ? record["pageURL"] : undefined;
  const author = typeof record["user"] === "string" ? record["user"] : "Pixabay";
  const width = typeof record["imageWidth"] === "number" ? record["imageWidth"] : 0;
  const height = typeof record["imageHeight"] === "number" ? record["imageHeight"] : 0;

  if (!id || !previewUrl || !imageUrl || !pageUrl) {
    return undefined;
  }

  return { id, provider: "pixabay", previewUrl, imageUrl, pageUrl, author, width, height };
}
