import { describe, expect, it } from "vitest";
import { evaluateVisualContentGate } from "./visualContentGate.js";

function makeBitmap(width: number, height: number, fill: readonly [number, number, number, number]): Buffer {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    bitmap[offset] = fill[0];
    bitmap[offset + 1] = fill[1];
    bitmap[offset + 2] = fill[2];
    bitmap[offset + 3] = fill[3];
  }
  return bitmap;
}

function fillRect(
  bitmap: Buffer,
  width: number,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  color: readonly [number, number, number, number]
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * width + x) * 4;
      bitmap[offset] = color[0];
      bitmap[offset + 1] = color[1];
      bitmap[offset + 2] = color[2];
      bitmap[offset + 3] = color[3];
    }
  }
}

describe("evaluateVisualContentGate", () => {
  it("fails a mostly white frame with little rendered content", () => {
    const bitmap = makeBitmap(1080, 1350, [255, 255, 255, 255]);
    fillRect(bitmap, 1080, { x: 96, y: 795, width: 270, height: 65 }, [20, 20, 20, 255]);

    const result = evaluateVisualContentGate({ bitmap, cardIndex: 1, width: 1080, height: 1350 });

    expect(result.issues.some((issue) => issue.gate === "visual_artifact")).toBe(true);
    expect(result.metrics.nonWhiteRatio).toBeLessThan(0.02);
  });

  it("passes a frame with visible content distributed across the card", () => {
    const bitmap = makeBitmap(1080, 1350, [248, 248, 248, 255]);
    fillRect(bitmap, 1080, { x: 110, y: 180, width: 840, height: 180 }, [30, 30, 30, 255]);
    fillRect(bitmap, 1080, { x: 110, y: 460, width: 760, height: 280 }, [80, 110, 210, 255]);
    fillRect(bitmap, 1080, { x: 110, y: 860, width: 700, height: 170 }, [210, 70, 120, 255]);

    const result = evaluateVisualContentGate({ bitmap, cardIndex: 1, width: 1080, height: 1350 });

    expect(result.issues).toEqual([]);
    expect(result.metrics.coverageRatio).toBeGreaterThan(0.08);
  });

  it("passes sparse black text when it is distributed across a white card", () => {
    const bitmap = makeBitmap(1920, 1080, [255, 255, 255, 255]);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        fillRect(
          bitmap,
          1920,
          { x: 180 + column * 380, y: 160 + row * 190, width: 86, height: 18 },
          [20, 20, 20, 255]
        );
      }
    }

    const result = evaluateVisualContentGate({ bitmap, cardIndex: 1, width: 1920, height: 1080 });

    expect(result.issues).toEqual([]);
    expect(result.metrics.nonWhiteRatio).toBeLessThan(0.02);
    expect(result.metrics.coverageRatio).toBeGreaterThan(0.08);
  });
});
