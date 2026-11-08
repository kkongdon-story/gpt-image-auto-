import { describe, expect, it } from "vitest";
import { resolveEffectiveBackgroundMedia, resolveEffectiveCardBackgroundMedia } from "./mediaResolver.js";
import type { Card, Deck, MediaAssetRef } from "./types.js";

const imageA: MediaAssetRef = {
  id: "asset-a",
  kind: "image",
  displayName: "A.png",
  relativePath: "media/asset-a/A.png",
  mimeType: "image/png",
  bytes: 100,
  sha256: "a".repeat(64),
  width: 1080,
  height: 1920
};

const videoB: MediaAssetRef = {
  id: "asset-b",
  kind: "video",
  displayName: "B.mp4",
  relativePath: "media/asset-b/B.mp4",
  mimeType: "video/mp4",
  bytes: 1000,
  sha256: "b".repeat(64),
  width: 1080,
  height: 1920,
  durationMs: 3000,
  hasAudio: true
};

describe("M22 effective media resolver", () => {
  it("implements the card/global inheritance truth table", () => {
    expect(
      resolveEffectiveBackgroundMedia({
        deckBackgroundMedia: { mode: "asset", mediaId: "asset-a" },
        cardBackgroundMedia: { mode: "inherit" },
        assets: [imageA, videoB]
      })
    ).toMatchObject({ status: "asset", source: "deck", asset: imageA });

    expect(
      resolveEffectiveBackgroundMedia({
        deckBackgroundMedia: { mode: "none" },
        cardBackgroundMedia: { mode: "inherit" },
        assets: [imageA, videoB]
      })
    ).toEqual({ status: "none", source: "deck", warnings: [] });

    expect(
      resolveEffectiveBackgroundMedia({
        deckBackgroundMedia: { mode: "asset", mediaId: "asset-a" },
        cardBackgroundMedia: { mode: "none" },
        assets: [imageA, videoB]
      })
    ).toEqual({ status: "none", source: "card", warnings: [] });

    expect(
      resolveEffectiveBackgroundMedia({
        deckBackgroundMedia: { mode: "asset", mediaId: "asset-a" },
        cardBackgroundMedia: { mode: "asset", mediaId: "asset-b" },
        assets: [imageA, videoB]
      })
    ).toMatchObject({ status: "asset", source: "card", asset: videoB });
  });

  it("does not silently substitute global media when local media is missing", () => {
    const resolved = resolveEffectiveBackgroundMedia({
      deckBackgroundMedia: { mode: "asset", mediaId: "asset-a" },
      cardBackgroundMedia: { mode: "asset", mediaId: "missing-local" },
      assets: [imageA]
    });

    expect(resolved).toEqual({
      status: "missing",
      source: "card",
      mediaId: "missing-local",
      warnings: ["Missing card background media asset: missing-local"]
    });
  });

  it("maps legacy deck/card background IDs through the same resolver", () => {
    const deck: Pick<Deck, "backgroundId" | "mediaAssets"> = {
      backgroundId: "asset-a",
      mediaAssets: [imageA, videoB]
    };
    const card: Pick<Card, "backgroundId"> = {};

    expect(resolveEffectiveCardBackgroundMedia(deck, card)).toMatchObject({
      status: "asset",
      source: "deck",
      asset: imageA
    });

    expect(resolveEffectiveCardBackgroundMedia(deck, card, { backgroundId: null })).toEqual({
      status: "none",
      source: "card",
      warnings: []
    });

    expect(resolveEffectiveCardBackgroundMedia(deck, card, { backgroundId: "asset-b" })).toMatchObject({
      status: "asset",
      source: "card",
      asset: videoB
    });
  });
});
