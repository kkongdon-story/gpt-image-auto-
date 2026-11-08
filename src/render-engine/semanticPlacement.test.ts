import { describe, expect, it } from "vitest";
import {
  buildSemanticPlacementRuntimeScript,
  prepareSemanticItemPlacements,
  resolveSemanticPlacementStyle
} from "./semanticPlacement.js";

describe("semantic placement coordinate conversion", () => {
  it("maps card percentages into an offset parent's local coordinate space", () => {
    const placement = resolveSemanticPlacementStyle({
      cardRect: { left: 50, top: 60, width: 540, height: 675 },
      parentRect: { left: 70, top: 80, width: 400, height: 500 },
      parentOffsetWidth: 200,
      parentOffsetHeight: 250,
      parentClientLeft: 4,
      parentClientTop: 6,
      parentScrollLeft: 10,
      parentScrollTop: 5,
      leftPercent: 15,
      topPercent: 20,
      widthPercent: 60,
      heightPercent: 12
    });

    expect(placement).toEqual({
      left: 36.5,
      top: 56.5,
      width: 162,
      height: 40.5
    });
  });

  it("does not introduce device pixel ratio into CSS-pixel placement", () => {
    const placement = resolveSemanticPlacementStyle({
      cardRect: { left: 0, top: 0, width: 1080, height: 1350 },
      parentRect: { left: 0, top: 0, width: 1080, height: 1350 },
      parentOffsetWidth: 1080,
      parentOffsetHeight: 1350,
      parentClientLeft: 0,
      parentClientTop: 0,
      parentScrollLeft: 0,
      parentScrollTop: 0,
      leftPercent: 25,
      topPercent: 30,
      widthPercent: 50,
      heightPercent: 10
    });

    expect(placement).toEqual({
      left: 270,
      top: 405,
      width: 540,
      height: 135
    });
  });

  it("rejects a collapsed card coordinate space", () => {
    expect(
      resolveSemanticPlacementStyle({
        cardRect: { left: 0, top: 0, width: 0, height: 1350 },
        parentRect: { left: 0, top: 0, width: 1080, height: 1350 },
        parentOffsetWidth: 1080,
        parentOffsetHeight: 1350,
        parentClientLeft: 0,
        parentClientTop: 0,
        parentScrollLeft: 0,
        parentScrollTop: 0,
        leftPercent: 25,
        topPercent: 30,
        widthPercent: 50,
        heightPercent: 10
      })
    ).toBeUndefined();
  });

  it("serializes the same shared converter into standalone render HTML", () => {
    const runtime = buildSemanticPlacementRuntimeScript();

    expect(runtime).toContain("resolveSemanticPlacementStyle");
    expect(runtime).toContain("syncSemanticItemPlacements");
    expect(runtime).toContain("__CARDNEWS_SYNC_SEMANTIC_PLACEMENTS__");
  });

  it("does not miss an image that completes immediately after listeners are attached", async () => {
    let completeChecks = 0;
    const image = {
      get complete() {
        completeChecks += 1;
        return completeChecks > 1;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      decode: async () => undefined
    };
    const root = {
      images: [image],
      defaultView: null
    } as unknown as Document;

    await prepareSemanticItemPlacements(root);

    expect(completeChecks).toBeGreaterThanOrEqual(2);
  });
});
