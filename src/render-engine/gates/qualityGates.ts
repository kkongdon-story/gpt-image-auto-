import type {
  QualityGateIssue,
  QualityGateReport,
  QualityGateStatus,
  RenderSlotMetric
} from "../../domain/types.js";

type RgbColor = {
  readonly blue: number;
  readonly green: number;
  readonly red: number;
};

export type CardDimensions = {
  readonly width: number;
  readonly height: number;
};

const defaultDimensions: CardDimensions = { width: 1080, height: 1350 };
const safeMargin = 72;
const minimumContrastRatio = 4.5;
const warningContrastRatio = 5.2;
const minimumFontSize = 18;
const maxFontSizeKinds = 4;
const maxTitleLineEstimate = 3;
const minimumSlotGap = 8;

export function evaluateQualityGates(
  metrics: readonly RenderSlotMetric[],
  dimensions: CardDimensions = defaultDimensions
): QualityGateReport {
  const issues: QualityGateIssue[] = [];

  for (const metric of metrics) {
    const contrastRatio = calculateContrastRatio(metric.color, metric.backgroundColor);
    if (contrastRatio < minimumContrastRatio) {
      issues.push({
        cardIndex: metric.cardIndex,
        gate: "contrast",
        measured: roundMeasurement(contrastRatio),
        message: `${metric.slot} contrast is ${roundMeasurement(contrastRatio)}:1; ${minimumContrastRatio}:1 is required.`,
        required: minimumContrastRatio,
        severity: "fail",
        slot: metric.slot
      });
    } else if (contrastRatio < warningContrastRatio) {
      issues.push({
        cardIndex: metric.cardIndex,
        gate: "filter_contrast",
        measured: roundMeasurement(contrastRatio),
        message: `${metric.slot} contrast is close to the minimum after color adjustment.`,
        required: warningContrastRatio,
        severity: "warn",
        slot: metric.slot
      });
    }

    if (!isInsideSafeZone(metric, dimensions)) {
      issues.push({
        cardIndex: metric.cardIndex,
        gate: "overflow",
        measured: roundMeasurement(metric.left),
        message: `${metric.slot} leaves the ${safeMargin}px safe zone.`,
        required: safeMargin,
        severity: "fail",
        slot: metric.slot
      });
    }

    if (metric.fontSize < minimumFontSize) {
      issues.push({
        cardIndex: metric.cardIndex,
        gate: "font_floor",
        measured: roundMeasurement(metric.fontSize),
        message: `${metric.slot} font size is ${roundMeasurement(metric.fontSize)}px; ${minimumFontSize}px is required.`,
        required: minimumFontSize,
        severity: "fail",
        slot: metric.slot
      });
    }

    if (metric.slot === "title") {
      const estimatedLines = estimateLineCount(metric);
      if (estimatedLines > maxTitleLineEstimate) {
        issues.push({
          cardIndex: metric.cardIndex,
          gate: "title_line_count",
          measured: roundMeasurement(estimatedLines),
          message: `${metric.slot} appears to use ${roundMeasurement(estimatedLines)} lines; ${maxTitleLineEstimate} lines is recommended.`,
          required: maxTitleLineEstimate,
          severity: "warn",
          slot: metric.slot
        });
      }
    }
  }

  issues.push(...evaluateCardLevelWarnings(metrics));
  issues.push(...evaluateSlotOverlapFailures(metrics));

  return {
    status: reportStatus(issues),
    issues
  };
}

function evaluateSlotOverlapFailures(metrics: readonly RenderSlotMetric[]): readonly QualityGateIssue[] {
  const failures: QualityGateIssue[] = [];
  const cardIndexes = new Set(metrics.map((metric) => metric.cardIndex));

  for (const cardIndex of cardIndexes) {
    const cardMetrics = metrics
      .filter((metric) => metric.cardIndex === cardIndex && metric.width > 0 && metric.height > 0)
      .sort((a, b) => a.top - b.top);

    for (let index = 0; index < cardMetrics.length - 1; index += 1) {
      const current = cardMetrics[index]!;
      const next = cardMetrics[index + 1]!;
      if (!slotsHorizontallyIntersect(current, next)) {
        continue;
      }

      const currentBottom = current.top + current.height;
      const measuredGap = next.top - currentBottom;
      if (measuredGap < minimumSlotGap) {
        failures.push({
          cardIndex,
          gate: "overlap",
          measured: roundMeasurement(measuredGap),
          message: `${current.slot} and ${next.slot} are too close or overlapping.`,
          required: minimumSlotGap,
          severity: "fail",
          slot: `${current.slot}/${next.slot}`
        });
      }
    }
  }

  return failures;
}

function slotsHorizontallyIntersect(left: RenderSlotMetric, right: RenderSlotMetric): boolean {
  return Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left) > 24;
}

function evaluateCardLevelWarnings(metrics: readonly RenderSlotMetric[]): readonly QualityGateIssue[] {
  const warnings: QualityGateIssue[] = [];
  const cardIndexes = new Set(metrics.map((metric) => metric.cardIndex));

  for (const cardIndex of cardIndexes) {
    const cardMetrics = metrics.filter((metric) => metric.cardIndex === cardIndex);
    const fontKinds = new Set(cardMetrics.map((metric) => Math.round(metric.fontSize)));
    if (fontKinds.size > maxFontSizeKinds) {
      warnings.push({
        cardIndex,
        gate: "font_variety",
        measured: fontKinds.size,
        message: `Card uses ${fontKinds.size} font sizes; ${maxFontSizeKinds} or fewer is recommended.`,
        required: maxFontSizeKinds,
        severity: "warn",
        slot: "card"
      });
    }

    const accentLikeSlots = cardMetrics.filter((metric) => metric.slot === "emphasis").length;
    if (accentLikeSlots > 2) {
      warnings.push({
        cardIndex,
        gate: "accent_overuse",
        measured: accentLikeSlots,
        message: `Card uses ${accentLikeSlots} emphasis blocks; keep accent use to 2 or fewer.`,
        required: 2,
        severity: "warn",
        slot: "card"
      });
    }
  }

  return warnings;
}

function reportStatus(issues: readonly QualityGateIssue[]): QualityGateStatus {
  if (issues.some((issue) => issue.severity === "fail")) {
    return "fail";
  }

  return issues.length > 0 ? "warn" : "pass";
}

function estimateLineCount(metric: RenderSlotMetric): number {
  if (metric.fontSize <= 0) {
    return 0;
  }

  return metric.height / (metric.fontSize * 1.18);
}

function isInsideSafeZone(metric: RenderSlotMetric, dimensions: CardDimensions): boolean {
  return (
    metric.left >= safeMargin &&
    metric.top >= safeMargin &&
    metric.left + metric.width <= dimensions.width - safeMargin &&
    metric.top + metric.height <= dimensions.height - safeMargin
  );
}

function calculateContrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);

  if (!foregroundColor || !backgroundColor) {
    return 0;
  }

  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(value: string): RgbColor | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("#")) {
    return parseHexColor(normalized);
  }

  if (normalized.startsWith("rgb(") || normalized.startsWith("rgba(")) {
    return parseRgbColor(normalized);
  }

  return undefined;
}

function parseHexColor(value: string): RgbColor | undefined {
  if (value.length === 4) {
    const red = parseHexPair(`${value[1]}${value[1]}`);
    const green = parseHexPair(`${value[2]}${value[2]}`);
    const blue = parseHexPair(`${value[3]}${value[3]}`);

    return buildRgbColor(red, green, blue);
  }

  if (value.length !== 7) {
    return undefined;
  }

  return buildRgbColor(
    parseHexPair(value.slice(1, 3)),
    parseHexPair(value.slice(3, 5)),
    parseHexPair(value.slice(5, 7))
  );
}

function parseRgbColor(value: string): RgbColor | undefined {
  const openIndex = value.indexOf("(");
  const closeIndex = value.indexOf(")");
  if (openIndex < 0 || closeIndex <= openIndex) {
    return undefined;
  }

  const parts = value
    .slice(openIndex + 1, closeIndex)
    .split(",")
    .map((part) => Number(part.trim()));

  return buildRgbColor(parts[0], parts[1], parts[2]);
}

function buildRgbColor(
  red: number | undefined,
  green: number | undefined,
  blue: number | undefined
): RgbColor | undefined {
  if (!isColorComponent(red) || !isColorComponent(green) || !isColorComponent(blue)) {
    return undefined;
  }

  return { red, green, blue };
}

function parseHexPair(value: string): number | undefined {
  const parsed = Number.parseInt(value, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isColorComponent(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 255;
}

function relativeLuminance(color: RgbColor): number {
  const red = linearizeColorComponent(color.red);
  const green = linearizeColorComponent(color.green);
  const blue = linearizeColorComponent(color.blue);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearizeColorComponent(value: number): number {
  const normalized = value / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function roundMeasurement(value: number): number {
  return Math.round(value * 100) / 100;
}
