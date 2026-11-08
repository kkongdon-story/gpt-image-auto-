import { describe, expect, it } from "vitest";
import {
  clientDeltaToEditorPercent,
  clientPointToEditorPercent,
  domRectToEditorRect,
  type RectLike
} from "./editorGeometry.js";

function scaledRect(rect: RectLike, scale: number, offsetX: number, offsetY: number): RectLike {
  return {
    left: rect.left * scale + offsetX,
    top: rect.top * scale + offsetY,
    width: rect.width * scale,
    height: rect.height * scale
  };
}

describe("editor coordinate space", () => {
  const card = { left: 120, top: 80, width: 1080, height: 1350 };
  const element = { left: 390, top: 350, width: 540, height: 270 };

  it("measures an element relative to the rendered card DOMRect", () => {
    expect(domRectToEditorRect(element, card)).toEqual({
      x: 25,
      y: 20,
      width: 50,
      height: 20
    });
  });

  it.each([0.5, 0.75, 1, 1.25, 2])("cancels display scale exactly once at %s zoom", (scale) => {
    const measured = domRectToEditorRect(
      scaledRect(element, scale, 37, -19),
      scaledRect(card, scale, 37, -19)
    );
    expect(measured?.x).toBeCloseTo(25, 8);
    expect(measured?.y).toBeCloseTo(20, 8);
    expect(measured?.width).toBeCloseTo(50, 8);
    expect(measured?.height).toBeCloseTo(20, 8);
  });

  it("uses viewport-relative rectangles so page scroll and DPR do not enter the calculation", () => {
    const scrolledCard = { ...card, left: -280, top: -920 };
    const scrolledElement = { ...element, left: -10, top: -650 };
    expect(domRectToEditorRect(scrolledElement, scrolledCard)).toEqual({
      x: 25,
      y: 20,
      width: 50,
      height: 20
    });
  });

  it("converts pointer movement and absolute pointer positions through the same displayed card rect", () => {
    const viewport = { left: 300, top: 150, width: 540, height: 675 };
    expect(clientDeltaToEditorPercent(400, 250, 454, 317.5, viewport)).toEqual({ x: 10, y: 10 });
    expect(clientPointToEditorPercent(570, 487.5, viewport)).toEqual({ x: 50, y: 50 });
  });

  it("rejects unrendered rectangles instead of manufacturing fallback geometry", () => {
    expect(domRectToEditorRect(element, { ...card, width: 0 })).toBeUndefined();
    expect(clientDeltaToEditorPercent(0, 0, 10, 10, { ...card, height: 0 })).toBeUndefined();
    expect(clientPointToEditorPercent(10, 10, { ...card, width: 0 })).toBeUndefined();
  });
});
