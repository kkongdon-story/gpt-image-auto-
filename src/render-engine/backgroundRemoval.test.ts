import { describe, expect, it } from "vitest";
import { removeBackground } from "./backgroundRemoval.js";

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function fillBitmap(width: number, height: number, color: readonly [number, number, number, number]): Uint8Array {
  const bitmap = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = pixelOffset(width, x, y);
      bitmap[offset] = color[0];
      bitmap[offset + 1] = color[1];
      bitmap[offset + 2] = color[2];
      bitmap[offset + 3] = color[3];
    }
  }
  return bitmap;
}

describe("removeBackground", () => {
  it("removes only the connected corner background while preserving foreground and enclosed holes", () => {
    const width = 8;
    const height = 8;
    const bitmap = fillBitmap(width, height, [255, 255, 255, 255]);

    for (let y = 2; y <= 5; y += 1) {
      for (let x = 2; x <= 5; x += 1) {
        const offset = pixelOffset(width, x, y);
        bitmap[offset] = 20;
        bitmap[offset + 1] = 20;
        bitmap[offset + 2] = 20;
      }
    }
    const enclosed = pixelOffset(width, 3, 3);
    bitmap[enclosed] = 255;
    bitmap[enclosed + 1] = 255;
    bitmap[enclosed + 2] = 255;

    const output = removeBackground(bitmap, width, height, 18);

    expect(output[pixelOffset(width, 0, 0) + 3]).toBe(0);
    expect(output[pixelOffset(width, 2, 2) + 3]).toBe(255);
    expect(output[enclosed + 3]).toBe(255);
  });

  it("uses tolerance to include or preserve near-background edge pixels", () => {
    const width = 5;
    const height = 3;
    const bitmap = fillBitmap(width, height, [255, 255, 255, 255]);
    const nearBackground = pixelOffset(width, 2, 0);
    bitmap[nearBackground] = 220;
    bitmap[nearBackground + 1] = 220;
    bitmap[nearBackground + 2] = 220;

    const lowTolerance = removeBackground(bitmap, width, height, 10);
    const highTolerance = removeBackground(bitmap, width, height, 80);

    expect(lowTolerance[nearBackground + 3]).toBe(255);
    expect(highTolerance[nearBackground + 3]).toBe(0);
  });
});
