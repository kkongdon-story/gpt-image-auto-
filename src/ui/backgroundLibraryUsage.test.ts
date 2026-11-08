import { describe, expect, it } from "vitest";
import type { CardOverrideMap } from "../domain/types.js";
import { findBackgroundLibraryUsage, isBackgroundSafeToDelete } from "./backgroundLibraryUsage.js";

describe("background library usage detection", () => {
  it("detects global, card, and image-layer references from current editor state", () => {
    const overrides: CardOverrideMap = {
      "2": { backgroundId: "bg-card" },
      "3": {
        layers: [
          {
            id: "layer-background",
            kind: "image",
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            backgroundId: "bg-layer"
          }
        ]
      }
    };

    expect(findBackgroundLibraryUsage("bg-global", { backgroundId: "bg-global", overrides })).toEqual([
      { backgroundId: "bg-global", label: "전역 배경", source: "global" }
    ]);
    expect(findBackgroundLibraryUsage("bg-card", { backgroundId: "bg-global", overrides })).toEqual([
      { backgroundId: "bg-card", label: "카드 2 배경", source: "card", cardIndex: 2 }
    ]);
    expect(findBackgroundLibraryUsage("bg-layer", { backgroundId: "bg-global", overrides })).toEqual([
      {
        backgroundId: "bg-layer",
        label: "카드 3 이미지 레이어 layer-background",
        source: "imageLayer",
        cardIndex: 3,
        layerId: "layer-background"
      }
    ]);
  });

  it("reports only unreferenced backgrounds as safe to delete", () => {
    const state = {
      backgroundId: "bg-global",
      overrides: { "1": { backgroundId: "bg-card" } }
    } satisfies { readonly backgroundId: string | null; readonly overrides: CardOverrideMap };

    expect(isBackgroundSafeToDelete("bg-unused", state)).toBe(true);
    expect(isBackgroundSafeToDelete("bg-global", state)).toBe(false);
    expect(isBackgroundSafeToDelete("bg-card", state)).toBe(false);
  });
});
