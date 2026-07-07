import type { QualityGateIssue } from "../../domain/types.js";

export type VisualContentMetrics = {
  readonly contentRatio: number;
  readonly coverageRatio: number;
  readonly luminanceStdDev: number;
  readonly nonWhiteRatio: number;
  readonly sampledPixels: number;
  readonly visibleRatio: number;
};

type BitmapVisualInput = {
  readonly bitmap: Buffer;
  readonly cardIndex: number;
  readonly height: number;
  readonly width: number;
};

const bytesPerPixel = 4;
const minNonWhiteRatio = 0.02;
const minCoverageRatio = 0.08;
const minLuminanceStdDev = 8;
const sampleTarget = 160000;
const transparentAlphaThreshold = 16;
const whiteDistanceThreshold = 18;
const coverageColumns = 12;
const coverageRows = 12;

export function evaluateVisualContentGate(input: BitmapVisualInput): {
  readonly issues: readonly QualityGateIssue[];
  readonly metrics: VisualContentMetrics;
} {
  const metrics = analyzeBgraBitmap(input);
  const issues: QualityGateIssue[] = [];

  if (metrics.visibleRatio < 0.95) {
    issues.push(makeIssue(input.cardIndex, metrics.visibleRatio, 0.95, "image has too many transparent pixels"));
  }

  if (metrics.nonWhiteRatio < minNonWhiteRatio && metrics.coverageRatio < minCoverageRatio) {
    issues.push(
      makeIssue(
        input.cardIndex,
        metrics.nonWhiteRatio,
        minNonWhiteRatio,
        "mostly blank or low-content image"
      )
    );
  }

  if (metrics.coverageRatio < minCoverageRatio) {
    issues.push(
      makeIssue(input.cardIndex, metrics.coverageRatio, minCoverageRatio, "content coverage too low")
    );
  }

  if (metrics.luminanceStdDev < minLuminanceStdDev) {
    issues.push(
      makeIssue(
        input.cardIndex,
        metrics.luminanceStdDev,
        minLuminanceStdDev,
        "pixel variation too low for a rendered card"
      )
    );
  }

  return { issues, metrics };
}

function analyzeBgraBitmap(input: BitmapVisualInput): VisualContentMetrics {
  const pixelCount = input.width * input.height;
  const expectedBytes = pixelCount * bytesPerPixel;
  if (pixelCount <= 0 || input.bitmap.byteLength < expectedBytes) {
    return {
      contentRatio: 0,
      coverageRatio: 0,
      luminanceStdDev: 0,
      nonWhiteRatio: 0,
      sampledPixels: 0,
      visibleRatio: 0
    };
  }

  const step = Math.max(1, Math.ceil(pixelCount / sampleTarget));
  const coverageCells = new Set<number>();
  let visiblePixels = 0;
  let nonWhitePixels = 0;
  let sampledPixels = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += step) {
    const offset = pixelIndex * bytesPerPixel;
    const blue = input.bitmap[offset] ?? 0;
    const green = input.bitmap[offset + 1] ?? 0;
    const red = input.bitmap[offset + 2] ?? 0;
    const alpha = input.bitmap[offset + 3] ?? 255;
    sampledPixels += 1;

    if (alpha < transparentAlphaThreshold) {
      continue;
    }

    visiblePixels += 1;
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luminanceSum += luminance;
    luminanceSquareSum += luminance * luminance;

    if (Math.max(Math.abs(255 - red), Math.abs(255 - green), Math.abs(255 - blue)) > whiteDistanceThreshold) {
      nonWhitePixels += 1;
      coverageCells.add(coverageCellForPixel(pixelIndex, input.width, input.height));
    }
  }

  const luminanceMean = visiblePixels > 0 ? luminanceSum / visiblePixels : 0;
  const luminanceVariance =
    visiblePixels > 0 ? Math.max(0, luminanceSquareSum / visiblePixels - luminanceMean * luminanceMean) : 0;
  const visibleRatio = sampledPixels > 0 ? visiblePixels / sampledPixels : 0;
  const nonWhiteRatio = visiblePixels > 0 ? nonWhitePixels / visiblePixels : 0;

  return {
    contentRatio: nonWhiteRatio * visibleRatio,
    coverageRatio: coverageCells.size / (coverageColumns * coverageRows),
    luminanceStdDev: Math.sqrt(luminanceVariance),
    nonWhiteRatio,
    sampledPixels,
    visibleRatio
  };
}

function coverageCellForPixel(pixelIndex: number, width: number, height: number): number {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  const column = Math.min(coverageColumns - 1, Math.floor((x / width) * coverageColumns));
  const row = Math.min(coverageRows - 1, Math.floor((y / height) * coverageRows));
  return row * coverageColumns + column;
}

function makeIssue(
  cardIndex: number,
  measured: number,
  required: number,
  message: string
): QualityGateIssue {
  return {
    cardIndex,
    gate: "visual_artifact",
    measured: roundMeasurement(measured),
    message: `${message}: ${roundMeasurement(measured)} is below ${required}.`,
    required,
    severity: "fail",
    slot: "card"
  };
}

function roundMeasurement(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}
