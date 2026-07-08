import type { StylePresetRecord } from "../domain/types.js";

const unsafeCssTextPattern =
  /[<>;{}\\]|[\u0000-\u001f\u007f]|<\/style|<script|javascript:|expression\s*\(|@import|url\s*\(/iu;
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
const rgbColorPattern =
  /^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/;
const safeGradientPattern = /^linear-gradient\(\s*(?:-?\d+(?:\.\d+)?deg|to\s+(?:top|bottom|left|right)(?:\s+(?:top|bottom|left|right))?)\s*,\s*[#A-Za-z0-9_(),.%\s+-]+\)$/;
const safeFontStackPattern = /^[\p{L}\p{N}\s"',.-]+$/u;
const safeCssLengthPattern = /^(?:0|(?:\d+(?:\.\d+)?)(?:px|rem|em|%))$/;

export function isSafeStylePresetRecord(candidate: unknown): candidate is StylePresetRecord {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  const stringFields = [
    "id",
    "name",
    "pageBackground",
    "textBackdrop",
    "chromeBackdrop",
    "ink",
    "inkSub",
    "inkMuted",
    "accentDefault",
    "badgeBackground",
    "badgeInk",
    "fontTitle",
    "fontBody"
  ];

  if (
    !stringFields.every((field) => typeof record[field] === "string") ||
    typeof record["usesPhoto"] !== "boolean" ||
    typeof record["usesSurface"] !== "boolean" ||
    typeof record["defaultDim"] !== "number" ||
    (record["numberInk"] !== undefined && typeof record["numberInk"] !== "string") ||
    (record["surfaceLadder"] !== undefined && !isStringTuple3(record["surfaceLadder"])) ||
    (record["inkScale"] !== undefined && !isInkScaleShape(record["inkScale"])) ||
    (record["hairline"] !== undefined && typeof record["hairline"] !== "string") ||
    (record["eyebrowStyle"] !== undefined &&
      record["eyebrowStyle"] !== "pill" &&
      record["eyebrowStyle"] !== "bar" &&
      record["eyebrowStyle"] !== "plain") ||
    (record["titleTracking"] !== undefined && typeof record["titleTracking"] !== "number") ||
    (record["badgeRadius"] !== undefined && typeof record["badgeRadius"] !== "string") ||
    (record["bulletShape"] !== undefined &&
      record["bulletShape"] !== "dot" &&
      record["bulletShape"] !== "square" &&
      record["bulletShape"] !== "dash") ||
    (record["scrimStops"] !== undefined && !isStringArray(record["scrimStops"]))
  ) {
    return false;
  }

  return validateStylePresetSafety(record as StylePresetRecord) === undefined;
}

export function validateStylePresetSafety(preset: StylePresetRecord): string | undefined {
  const unsafeField = [
    "id",
    "name",
    "pageBackground",
    "textBackdrop",
    "chromeBackdrop",
    "ink",
    "inkSub",
    "inkMuted",
    "accentDefault",
    "badgeBackground",
    "badgeInk",
    "fontTitle",
    "fontBody",
    "numberInk",
    "hairline",
    "badgeRadius"
  ].find((field) => {
    const value = preset[field as keyof StylePresetRecord];
    return typeof value === "string" && hasUnsafeCssText(value);
  });
  if (unsafeField) {
    return `${unsafeField}에 허용되지 않는 CSS/HTML 토큰이 포함되어 있습니다.`;
  }

  if (!isSafeCssBackground(preset.pageBackground)) {
    return "pageBackground는 #rrggbb 또는 안전한 linear-gradient(...)만 허용됩니다.";
  }

  const colorFields: Array<keyof StylePresetRecord> = [
    "textBackdrop",
    "chromeBackdrop",
    "ink",
    "inkSub",
    "inkMuted",
    "accentDefault",
    "badgeBackground",
    "badgeInk"
  ];
  for (const field of colorFields) {
    const value = preset[field];
    if (typeof value !== "string" || !isSafeCssColor(value)) {
      return `${field}는 #rrggbb, rgb(...), rgba(...) 형식만 허용됩니다.`;
    }
  }

  if (preset.numberInk !== undefined && !isSafeCssColor(preset.numberInk)) {
    return "numberInk는 #rrggbb, rgb(...), rgba(...) 형식만 허용됩니다.";
  }
  if (preset.hairline !== undefined && !isSafeCssColor(preset.hairline)) {
    return "hairline은 #rrggbb, rgb(...), rgba(...) 형식만 허용됩니다.";
  }
  if (!isSafeFontStack(preset.fontTitle) || !isSafeFontStack(preset.fontBody)) {
    return "fontTitle/fontBody는 안전한 font-family 토큰만 허용됩니다.";
  }
  if (preset.badgeRadius !== undefined && !safeCssLengthPattern.test(preset.badgeRadius)) {
    return "badgeRadius는 0 또는 px/rem/em/% 길이만 허용됩니다.";
  }
  if (preset.surfaceLadder && !preset.surfaceLadder.every(isSafeCssColor)) {
    return "surfaceLadder는 안전한 CSS 색상 3개여야 합니다.";
  }
  if (
    preset.inkScale &&
    ![preset.inkScale.ink, preset.inkScale.body, preset.inkScale.mute, preset.inkScale.faint].every(isSafeCssColor)
  ) {
    return "inkScale은 안전한 CSS 색상만 허용됩니다.";
  }
  if (preset.scrimStops && !preset.scrimStops.every(isSafeScrimStop)) {
    return "scrimStops는 안전한 rgb/rgba/#rrggbb 색상 stop만 허용됩니다.";
  }

  return undefined;
}

function hasUnsafeCssText(value: string): boolean {
  return value.trim().length === 0 || unsafeCssTextPattern.test(value);
}

function isSafeCssBackground(value: string): boolean {
  const trimmed = value.trim();
  return isSafeCssColor(trimmed) || (safeGradientPattern.test(trimmed) && !hasUnsafeCssText(trimmed));
}

function isSafeCssColor(value: string): boolean {
  const trimmed = value.trim();
  return (hexColorPattern.test(trimmed) || rgbColorPattern.test(trimmed)) && !hasUnsafeCssText(trimmed);
}

function isSafeFontStack(value: string): boolean {
  const trimmed = value.trim();
  return safeFontStackPattern.test(trimmed) && !hasUnsafeCssText(trimmed);
}

function isSafeScrimStop(value: string): boolean {
  const [color, stop] = splitColorStop(value.trim());
  if (!color || !isSafeCssColor(color)) {
    return false;
  }
  return stop === undefined || /^-?\d+(?:\.\d+)?%$/.test(stop);
}

function splitColorStop(value: string): readonly [string, string | undefined] {
  const rgbaMatch = /^(rgba?\([^)]*\))(?:\s+(.+))?$/.exec(value);
  if (rgbaMatch?.[1]) {
    return [rgbaMatch[1], rgbaMatch[2]?.trim()];
  }

  const [color, stop] = value.split(/\s+/, 2);
  return [color ?? "", stop?.trim()];
}

function isStringTuple3(value: unknown): value is readonly [string, string, string] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "string");
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isInkScaleShape(value: unknown): value is StylePresetRecord["inkScale"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["ink"] === "string" &&
    typeof record["body"] === "string" &&
    typeof record["mute"] === "string" &&
    typeof record["faint"] === "string"
  );
}
