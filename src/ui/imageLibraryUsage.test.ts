import { describe, expect, it } from "vitest";
import type { CardOverrideMap, NextHintConfig } from "../domain/types.js";
import { findImageLibraryUsage, isImageSafeToDelete } from "./imageLibraryUsage.js";

describe("image library usage detection", () => {
  it("detects badge, next-hint, and image layer references from current editor state", () => {
    const overrides: CardOverrideMap = {
      "1": {
        badge: { imageId: "img-badge" },
        layers: [
          {
            id: "layer-image",
            kind: "image",
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            backgroundId: "img-layer"
          }
        ]
      }
    };
    const nextHint: NextHintConfig = { kind: "image", imageId: "img-next" };

    expect(findImageLibraryUsage("img-badge", { nextHint, overrides })).toEqual([
      { imageId: "img-badge", label: "카드 1 배지 이미지", source: "badge", cardIndex: 1 }
    ]);
    expect(findImageLibraryUsage("img-next", { nextHint, overrides })).toEqual([
      { imageId: "img-next", label: "넘김 기호 이미지", source: "nextHint" }
    ]);
    expect(findImageLibraryUsage("img-layer", { nextHint, overrides })).toEqual([
      {
        imageId: "img-layer",
        label: "카드 1 이미지 레이어 layer-image",
        source: "imageLayer",
        cardIndex: 1,
        layerId: "layer-image"
      }
    ]);
  });

  it("reports unused images as safe to delete", () => {
    const overrides: CardOverrideMap = {
      "2": {
        badge: { imageId: "img-used" }
      }
    };

    expect(findImageLibraryUsage("img-unused", { overrides, nextHint: { kind: "none" } })).toEqual([]);
    expect(isImageSafeToDelete("img-unused", { overrides, nextHint: { kind: "none" } })).toBe(true);
    expect(isImageSafeToDelete("img-used", { overrides, nextHint: { kind: "none" } })).toBe(false);
  });
});
