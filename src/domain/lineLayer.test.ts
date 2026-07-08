import { describe, expect, it } from "vitest";
import {
  getLineLayerRenderGeometry,
  migrateLineLayer,
  normalizeLineLayer,
  rotateLineLayer
} from "./lineLayer.js";

const CARD_4_5 = { width: 1080, height: 1350 } as const;

describe("line layer endpoint model", () => {
  it("migrates a legacy horizontal line into endpoint coordinates", () => {
    const migrated = migrateLineLayer(
      {
        id: "legacy-horizontal",
        kind: "line",
        x: 40,
        y: 20,
        width: 30,
        height: 1,
        color: "#111111",
        strokeWidth: 5,
        rotation: 0,
        zIndex: 4,
        opacity: 0.8
      },
      CARD_4_5
    );

    expect(migrated).toMatchObject({
      id: "legacy-horizontal",
      kind: "line",
      x1: 40,
      y1: 20.5,
      x2: 70,
      y2: 20.5,
      thickness: 5,
      color: "#111111",
      zIndex: 4,
      opacity: 0.8
    });
    expect("strokeWidth" in migrated).toBe(false);
    expect("rotation" in migrated).toBe(false);
  });

  it("migrates legacy 90 degree and 45 degree lines around the old center", () => {
    const vertical = migrateLineLayer(
      {
        id: "legacy-vertical",
        kind: "line",
        x: 40,
        y: 20,
        width: 30,
        height: 1,
        color: "#111111",
        strokeWidth: 5,
        rotation: 90
      },
      CARD_4_5
    );
    expect(vertical.x1).toBeCloseTo(55, 3);
    expect(vertical.y1).toBeCloseTo(8.5, 3);
    expect(vertical.x2).toBeCloseTo(55, 3);
    expect(vertical.y2).toBeCloseTo(32.5, 3);

    const diagonal = migrateLineLayer(
      {
        id: "legacy-diagonal",
        kind: "line",
        x: 50,
        y: 50,
        width: 20,
        height: 1,
        color: "#111111",
        strokeWidth: 5,
        rotation: 45
      },
      CARD_4_5
    );
    expect(diagonal.x1).toBeCloseTo(52.929, 3);
    expect(diagonal.y1).toBeCloseTo(44.843, 3);
    expect(diagonal.x2).toBeCloseTo(67.071, 3);
    expect(diagonal.y2).toBeCloseTo(56.157, 3);
  });

  it("normalizes new endpoint lines and exposes pixel render geometry", () => {
    const line = normalizeLineLayer({
      id: "endpoint",
      kind: "line",
      x1: -10,
      y1: 25,
      x2: 110,
      y2: 25,
      thickness: 80,
      color: "not-a-color"
    });

    expect(line).toMatchObject({
      x1: 0,
      y1: 25,
      x2: 100,
      y2: 25,
      thickness: 40,
      color: "#111111"
    });

    const geometry = getLineLayerRenderGeometry(
      { ...line, x1: 55, y1: 8.5, x2: 55, y2: 32.5, thickness: 5 },
      CARD_4_5
    );
    expect(geometry.leftPx).toBeCloseTo(594, 3);
    expect(geometry.topPx).toBeCloseTo(114.75, 3);
    expect(geometry.widthPx).toBeCloseTo(324, 3);
    expect(geometry.heightPx).toBe(5);
    expect(geometry.angleDeg).toBeCloseTo(90, 3);
  });

  it("rotates endpoint lines around their center without changing length", () => {
    const rotated = rotateLineLayer(
      {
        id: "line",
        kind: "line",
        x1: 40,
        y1: 50,
        x2: 70,
        y2: 50,
        thickness: 5,
        color: "#111111"
      },
      90,
      CARD_4_5
    );

    expect(rotated.x1).toBeCloseTo(55, 3);
    expect(rotated.x2).toBeCloseTo(55, 3);
    expect(rotated.y1).toBeCloseTo(38, 3);
    expect(rotated.y2).toBeCloseTo(62, 3);
  });
});
