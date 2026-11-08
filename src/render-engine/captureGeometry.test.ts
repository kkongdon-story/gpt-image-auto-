import { describe, expect, it } from "vitest";
import { aspectRatios, findAspectRatio } from "../domain/aspectRatios.js";
import {
  decideCaptureNormalization,
  planCardSurfaceCompensation,
  validateCardGeometry,
  type CardGeometryProbe
} from "./captureGeometry.js";

const portrait = findAspectRatio("4:5");

describe("validateCardGeometry", () => {
  it("accepts a card that fills the deterministic content frame", () => {
    const result = validateCardGeometry(probeFor(portrait.width, portrait.height), portrait);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rect).toEqual({ x: 0, y: 0, width: 1080, height: 1350 });
      expect(result.value.fillsFrame).toBe(true);
    }
  });

  it("rounds subpixel card geometry to the nearest CSS pixel", () => {
    const result = validateCardGeometry(
      probeFor(portrait.width, portrait.height, {
        rect: { x: 0.2, y: 0.2, width: 1079.8, height: 1349.8 },
        computedWidth: 1079.8,
        computedHeight: 1349.8
      }),
      portrait
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rect).toEqual({ x: 0, y: 0, width: 1080, height: 1350 });
    }
  });

  it("accepts all centralized aspect-ratio dimensions", () => {
    for (const ratio of aspectRatios) {
      const result = validateCardGeometry(probeFor(ratio.width, ratio.height), ratio);
      expect(result.ok, ratio.id).toBe(true);
    }
  });

  it("rejects a missing card root", () => {
    const result = validateCardGeometry(
      { ...probeFor(portrait.width, portrait.height), cardExists: false },
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CARD_RECT_MISSING" });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY]
  ])("rejects %s card dimensions", (_label, invalidWidth) => {
    const result = validateCardGeometry(
      probeFor(portrait.width, portrait.height, {
        rect: { x: 0, y: 0, width: invalidWidth, height: portrait.height }
      }),
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CARD_RECT_INVALID" });
  });

  it("rejects a finite but wrong-aspect card rectangle", () => {
    const result = validateCardGeometry(
      probeFor(portrait.width, portrait.height, {
        rect: { x: 0, y: 0, width: 1080, height: 1080 },
        computedHeight: 1080
      }),
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CARD_RECT_INVALID" });
  });

  it("rejects viewport whitespace around an otherwise correct card", () => {
    const result = validateCardGeometry(
      probeFor(1100, 1370, {
        rect: { x: 10, y: 10, width: portrait.width, height: portrait.height },
        documentWidth: 1100,
        documentHeight: 1370
      }),
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CARD_RECT_INVALID" });
  });

  it.each([
    ["fonts", { fontsReady: false }],
    ["images", { imagesReady: false }]
  ] as const)("rejects geometry before %s are ready", (_label, readiness) => {
    const result = validateCardGeometry(
      probeFor(portrait.width, portrait.height, readiness),
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CARD_RECT_INVALID" });
  });

  it("accepts a compensated card that fills a one-pixel DPI-rounded surface", () => {
    const result = validateCardGeometry(
      probeFor(1080, 1351, {
        rect: { x: 0, y: 0, width: 1080, height: 1351 },
        computedWidth: 1080,
        computedHeight: 1350
      }),
      portrait
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toEqual({ width: 1080, height: 1351 });
      expect(result.value.fillsFrame).toBe(true);
      expect(result.value.dpiSurfaceCompensated).toBe(true);
    }
  });

  it("accepts horizontal DPI rounding only when the compensated card fills it", () => {
    const result = validateCardGeometry(
      probeFor(1081, 1350, {
        rect: { x: 0, y: 0, width: 1081, height: 1350 },
        computedWidth: 1080,
        computedHeight: 1350
      }),
      portrait
    );

    expect(result.ok).toBe(true);
  });
});

describe("planCardSurfaceCompensation", () => {
  it("plans a card-only transform for a one-pixel DPI-rounded surface", () => {
    const result = planCardSurfaceCompensation(
      probeFor(1080, 1351, {
        rect: { x: 0, y: 0, width: 1080, height: 1350 },
        computedWidth: 1080,
        computedHeight: 1350
      }),
      portrait
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ scaleX: 1, source: { width: 1080, height: 1351 } });
      expect(result.value.scaleY).toBeCloseTo(1351 / 1350, 8);
    }
  });

  it("plans a horizontal one-pixel DPI surface transform", () => {
    const result = planCardSurfaceCompensation(
      probeFor(1081, 1350, {
        rect: { x: 0, y: 0, width: 1080, height: 1350 },
        computedWidth: 1080,
        computedHeight: 1350
      }),
      portrait
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scaleX).toBeCloseTo(1081 / 1080, 8);
      expect(result.value.scaleY).toBe(1);
    }
  });

  it("rejects compensation for viewport dimensions that are not a uniform DPI scale", () => {
    const result = planCardSurfaceCompensation(
      probeFor(1620, 1394, {
        rect: { x: 0, y: 0, width: 1080, height: 1350 },
        computedWidth: 1080,
        computedHeight: 1350
      }),
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CAPTURE_ASPECT_MISMATCH" });
  });

  it("rejects compensation when the original card is offset or not target-sized", () => {
    const result = planCardSurfaceCompensation(
      probeFor(1080, 1351, {
        rect: { x: 1, y: 0, width: 1080, height: 1350 },
        computedWidth: 1080,
        computedHeight: 1350
      }),
      portrait
    );

    expect(result).toMatchObject({ ok: false, code: "RENDER_CARD_RECT_INVALID" });
  });
});

describe("decideCaptureNormalization", () => {
  it.each([1, 1.25, 1.5, 1.75, 2])(
    "accepts a verified full-card frame at %sx scale",
    (scale) => {
      const geometry = requireGeometry(validateCardGeometry(probeFor(1080, 1350), portrait));
      const result = decideCaptureNormalization({
        geometry,
        hasUnexpectedBorder: false,
        source: { width: Math.round(1080 * scale), height: Math.round(1350 * scale) },
        target: portrait
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.decision).toBe(scale === 1 ? "exact" : "resize");
        expect(result.value.scale).toBeCloseTo(scale, 3);
      }
    }
  );

  it.each([
    ["DPI plus window chrome", 1620, 1394],
    ["cropped width", 1619, 2025],
    ["foreign aspect ratio", 1080, 1080],
    ["zero source", 0, 1350],
    ["non-finite source", Number.POSITIVE_INFINITY, 1350]
  ])("rejects %s instead of stretching it", (_label, width, height) => {
    const geometry = requireGeometry(validateCardGeometry(probeFor(1080, 1350), portrait));
    const result = decideCaptureNormalization({
      geometry,
      hasUnexpectedBorder: false,
      source: { width, height },
      target: portrait
    });

    expect(result.ok).toBe(false);
  });

  it("rejects normalization when a border detector reports viewport whitespace", () => {
    const geometry = requireGeometry(validateCardGeometry(probeFor(1080, 1350), portrait));
    const result = decideCaptureNormalization({
      geometry,
      hasUnexpectedBorder: true,
      source: { width: 2160, height: 2700 },
      target: portrait
    });

    expect(result).toMatchObject({ ok: false, code: "RENDER_CAPTURE_ASPECT_MISMATCH" });
  });

  it("normalizes a near-target DPI-rounded bitmap only when geometry proves compensation", () => {
    const geometry = requireGeometry(
      validateCardGeometry(
        probeFor(1081, 1350, {
          rect: { x: 0, y: 0, width: 1081, height: 1350 },
          computedWidth: 1080,
          computedHeight: 1350
        }),
        portrait
      )
    );
    const result = decideCaptureNormalization({
      geometry,
      hasUnexpectedBorder: false,
      source: { width: 1081, height: 1350 },
      target: portrait
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe("resize");
    }
  });
});

function probeFor(
  contentWidth: number,
  contentHeight: number,
  overrides: Partial<CardGeometryProbe> = {}
): CardGeometryProbe {
  return {
    cardExists: true,
    rect: { x: 0, y: 0, width: contentWidth, height: contentHeight },
    computedWidth: contentWidth,
    computedHeight: contentHeight,
    contentWidth,
    contentHeight,
    documentWidth: contentWidth,
    documentHeight: contentHeight,
    devicePixelRatio: 1,
    zoomFactor: 1,
    fontsReady: true,
    imagesReady: true,
    ...overrides
  };
}

function requireGeometry(result: ReturnType<typeof validateCardGeometry>) {
  if (!result.ok) {
    throw new Error(`Expected valid geometry, received ${result.code}`);
  }
  return result.value;
}
