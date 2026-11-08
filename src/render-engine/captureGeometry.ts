import type { AspectRatio } from "../domain/aspectRatios.js";

const MAX_ROUNDING_ERROR_PX = 0.51;
const MAX_DPI_SURFACE_ERROR_PX = 0.75;
const MAX_DPI_SURFACE_DELTA_PX = 2;

export type CaptureGeometryErrorCode =
  | "RENDER_CARD_RECT_MISSING"
  | "RENDER_CARD_RECT_INVALID"
  | "RENDER_CAPTURE_ASPECT_MISMATCH";

export type CaptureRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CaptureSize = {
  readonly width: number;
  readonly height: number;
};

export type CardGeometryProbe = {
  readonly cardExists: boolean;
  readonly rect: CaptureRect;
  readonly computedWidth: number;
  readonly computedHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly devicePixelRatio: number;
  readonly zoomFactor: number;
  readonly fontsReady: boolean;
  readonly imagesReady: boolean;
};

export type ValidatedCardGeometry = {
  readonly rect: CaptureRect;
  readonly content: CaptureSize;
  readonly document: CaptureSize;
  readonly devicePixelRatio: number;
  readonly zoomFactor: number;
  readonly fontsReady: boolean;
  readonly imagesReady: boolean;
  readonly fillsFrame: true;
  readonly dpiSurfaceCompensated: boolean;
};

export type CaptureNormalizationDecision = {
  readonly decision: "exact" | "resize";
  readonly scale: number;
  readonly source: CaptureSize;
  readonly target: CaptureSize;
};

export type CardSurfaceCompensation = {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly source: CaptureSize;
  readonly target: CaptureSize;
};

type PolicySuccess<T> = {
  readonly ok: true;
  readonly value: T;
};

type PolicyFailure = {
  readonly ok: false;
  readonly code: CaptureGeometryErrorCode;
  readonly reason: string;
};

export type PolicyResult<T> = PolicySuccess<T> | PolicyFailure;

export function validateCardGeometry(
  probe: CardGeometryProbe,
  target: Pick<AspectRatio, "width" | "height">
): PolicyResult<ValidatedCardGeometry> {
  if (!probe.cardExists) {
    return failure("RENDER_CARD_RECT_MISSING", "The rendered document does not contain a .card root.");
  }

  if (!probe.fontsReady || !probe.imagesReady) {
    return failure(
      "RENDER_CARD_RECT_INVALID",
      "The rendered card assets are not ready for deterministic capture."
    );
  }

  const numericValues = [
    probe.rect.x,
    probe.rect.y,
    probe.rect.width,
    probe.rect.height,
    probe.computedWidth,
    probe.computedHeight,
    probe.contentWidth,
    probe.contentHeight,
    probe.documentWidth,
    probe.documentHeight,
    probe.devicePixelRatio,
    probe.zoomFactor,
    target.width,
    target.height
  ];
  if (!numericValues.every(Number.isFinite)) {
    return failure("RENDER_CARD_RECT_INVALID", "Card geometry contains a non-finite value.");
  }

  const positiveDimensions = [
    probe.rect.width,
    probe.rect.height,
    probe.computedWidth,
    probe.computedHeight,
    probe.contentWidth,
    probe.contentHeight,
    probe.documentWidth,
    probe.documentHeight,
    probe.devicePixelRatio,
    probe.zoomFactor,
    target.width,
    target.height
  ];
  if (positiveDimensions.some((value) => value <= 0)) {
    return failure("RENDER_CARD_RECT_INVALID", "Card geometry contains a non-positive dimension.");
  }

  const rect = roundRect(probe.rect);
  const content = {
    width: Math.round(probe.contentWidth),
    height: Math.round(probe.contentHeight)
  };
  const document = {
    width: Math.round(probe.documentWidth),
    height: Math.round(probe.documentHeight)
  };
  const dimensionsMatch =
    rect.x === 0 &&
    rect.y === 0 &&
    Math.round(probe.computedWidth) === target.width &&
    Math.round(probe.computedHeight) === target.height &&
    rect.width === content.width &&
    rect.height === content.height &&
    document.width === content.width &&
    document.height === content.height;
  const exactScale = uniformScaleFor(content, target);
  const dpiSurfaceScale = isNearTargetSurface(content, target)
    ? uniformScaleFor(content, target, MAX_DPI_SURFACE_ERROR_PX)
    : undefined;
  if (!dimensionsMatch || (!exactScale && !dpiSurfaceScale)) {
    return failure(
      "RENDER_CARD_RECT_INVALID",
      "The .card root does not start at the frame origin and fill the deterministic content surface."
    );
  }

  return {
    ok: true,
    value: {
      rect,
      content,
      document,
      devicePixelRatio: probe.devicePixelRatio,
      zoomFactor: probe.zoomFactor,
      fontsReady: probe.fontsReady,
      imagesReady: probe.imagesReady,
      fillsFrame: true,
      dpiSurfaceCompensated:
        content.width !== target.width || content.height !== target.height
    }
  };
}

export function planCardSurfaceCompensation(
  probe: CardGeometryProbe,
  target: Pick<AspectRatio, "width" | "height">
): PolicyResult<CardSurfaceCompensation> {
  if (!probe.cardExists) {
    return failure("RENDER_CARD_RECT_MISSING", "The rendered document does not contain a .card root.");
  }

  const numericValues = [
    probe.rect.x,
    probe.rect.y,
    probe.rect.width,
    probe.rect.height,
    probe.computedWidth,
    probe.computedHeight,
    probe.contentWidth,
    probe.contentHeight,
    probe.documentWidth,
    probe.documentHeight,
    target.width,
    target.height
  ];
  if (!numericValues.every(Number.isFinite)) {
    return failure("RENDER_CARD_RECT_INVALID", "Card surface compensation contains a non-finite value.");
  }

  const rect = roundRect(probe.rect);
  const source = {
    width: Math.round(probe.contentWidth),
    height: Math.round(probe.contentHeight)
  };
  const document = {
    width: Math.round(probe.documentWidth),
    height: Math.round(probe.documentHeight)
  };
  const startsAsTargetCard =
    rect.x === 0 &&
    rect.y === 0 &&
    rect.width === target.width &&
    rect.height === target.height &&
    Math.round(probe.computedWidth) === target.width &&
    Math.round(probe.computedHeight) === target.height;
  if (
    !startsAsTargetCard ||
    !isPositiveInteger(source.width) ||
    !isPositiveInteger(source.height) ||
    source.width !== document.width ||
    source.height !== document.height
  ) {
    return failure(
      "RENDER_CARD_RECT_INVALID",
      "The uncompensated card is not a target-sized root at the deterministic frame origin."
    );
  }

  if (
    !isNearTargetSurface(source, target) ||
    !uniformScaleFor(source, target, MAX_DPI_SURFACE_ERROR_PX)
  ) {
    return failure(
      "RENDER_CAPTURE_ASPECT_MISMATCH",
      "The content surface dimensions do not imply one uniform DPI scale factor."
    );
  }

  return {
    ok: true,
    value: {
      scaleX: source.width / target.width,
      scaleY: source.height / target.height,
      source,
      target: { width: target.width, height: target.height }
    }
  };
}

export function decideCaptureNormalization(input: {
  readonly geometry: ValidatedCardGeometry;
  readonly hasUnexpectedBorder: boolean;
  readonly source: CaptureSize;
  readonly target: Pick<AspectRatio, "width" | "height">;
}): PolicyResult<CaptureNormalizationDecision> {
  if (
    input.hasUnexpectedBorder ||
    !input.geometry.fillsFrame ||
    !isPositiveInteger(input.source.width) ||
    !isPositiveInteger(input.source.height) ||
    !isPositiveInteger(input.target.width) ||
    !isPositiveInteger(input.target.height)
  ) {
    return failure(
      "RENDER_CAPTURE_ASPECT_MISMATCH",
      "The captured bitmap is not a verified positive full-card frame."
    );
  }

  const scale =
    input.geometry.dpiSurfaceCompensated &&
    input.source.width === input.geometry.content.width &&
    input.source.height === input.geometry.content.height &&
    isNearTargetSurface(input.source, input.target)
      ? uniformScaleFor(input.source, input.target, MAX_DPI_SURFACE_ERROR_PX)
      : uniformScaleFor(input.source, input.target);
  if (!scale) {
    return failure(
      "RENDER_CAPTURE_ASPECT_MISMATCH",
      "The captured bitmap dimensions do not imply one uniform scale factor."
    );
  }

  return {
    ok: true,
    value: {
      decision:
        input.source.width === input.target.width && input.source.height === input.target.height
          ? "exact"
          : "resize",
      scale,
      source: input.source,
      target: { width: input.target.width, height: input.target.height }
    }
  };
}

function uniformScaleFor(
  source: CaptureSize,
  target: CaptureSize,
  maxErrorPx = MAX_ROUNDING_ERROR_PX
): number | undefined {
  if (
    !isPositiveInteger(source.width) ||
    !isPositiveInteger(source.height) ||
    !isPositiveInteger(target.width) ||
    !isPositiveInteger(target.height)
  ) {
    return undefined;
  }

  const widthScale = source.width / target.width;
  const heightScale = source.height / target.height;
  const scale = (widthScale + heightScale) / 2;
  const widthError = Math.abs(source.width - target.width * scale);
  const heightError = Math.abs(source.height - target.height * scale);
  return widthError <= maxErrorPx && heightError <= maxErrorPx
    ? scale
    : undefined;
}

function isNearTargetSurface(source: CaptureSize, target: CaptureSize): boolean {
  return (
    Math.abs(source.width - target.width) <= MAX_DPI_SURFACE_DELTA_PX &&
    Math.abs(source.height - target.height) <= MAX_DPI_SURFACE_DELTA_PX
  );
}

function failure(code: CaptureGeometryErrorCode, reason: string): PolicyFailure {
  return { ok: false, code, reason };
}

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function roundRect(rect: CaptureRect): CaptureRect {
  return {
    x: normalizeZero(Math.round(rect.x)),
    y: normalizeZero(Math.round(rect.y)),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
