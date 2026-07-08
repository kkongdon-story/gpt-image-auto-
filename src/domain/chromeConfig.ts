import type { ChromeConfig, ChromePageNumberStyle, ChromeSlotStyle } from "./types.js";

const minFontSize = 18;
const maxFontSize = 48;
const minFontWeight = 100;
const maxFontWeight = 950;
const maxOffset = 40;
const defaultInk = "#141414";

export const defaultChromeConfig: ChromeConfig = {
  header: {
    visible: true,
    color: defaultInk,
    fontSize: 30,
    fontWeight: 800,
    offsetX: 0,
    offsetY: 0,
    useDeckFont: true
  },
  footer: {
    visible: true,
    color: defaultInk,
    fontSize: 30,
    fontWeight: 800,
    offsetX: 0,
    offsetY: 0,
    useDeckFont: true
  },
  pageNumber: {
    visible: true,
    color: defaultInk,
    fontSize: 30,
    fontWeight: 700,
    offsetX: 0,
    offsetY: 0,
    useDeckFont: true,
    template: "{n} / {total}"
  }
};

type PartialChromeSlot = Partial<ChromeSlotStyle>;
type PartialChromePageNumber = Partial<ChromePageNumberStyle>;

export function normalizeChromeConfig(input: unknown): ChromeConfig {
  const record = isRecord(input) ? input : {};
  return {
    header: normalizeChromeSlot(record["header"], defaultChromeConfig.header),
    footer: normalizeChromeSlot(record["footer"], defaultChromeConfig.footer),
    pageNumber: normalizePageNumberSlot(record["pageNumber"], defaultChromeConfig.pageNumber)
  };
}

export function renderPageNumber(template: string, cardNumber: number, totalCards: number): string {
  const safeTemplate = template.trim().length > 0 ? template : defaultChromeConfig.pageNumber.template;
  const number = Math.max(1, Math.floor(cardNumber));
  const total = Math.max(1, Math.floor(totalCards));
  return safeTemplate
    .replaceAll("{n2}", number.toString().padStart(2, "0"))
    .replaceAll("{n}", number.toString())
    .replaceAll("{total}", total.toString());
}

function normalizeChromeSlot(input: unknown, fallback: ChromeSlotStyle): ChromeSlotStyle {
  const record = (isRecord(input) ? input : {}) as PartialChromeSlot;
  return {
    visible: typeof record.visible === "boolean" ? record.visible : fallback.visible,
    color: normalizeHexColor(record.color) ?? fallback.color,
    fontSize: clampNumber(record.fontSize, minFontSize, maxFontSize, fallback.fontSize),
    fontWeight: clampNumber(record.fontWeight, minFontWeight, maxFontWeight, fallback.fontWeight),
    offsetX: clampNumber(record.offsetX, -maxOffset, maxOffset, fallback.offsetX),
    offsetY: clampNumber(record.offsetY, -maxOffset, maxOffset, fallback.offsetY),
    useDeckFont: typeof record.useDeckFont === "boolean" ? record.useDeckFont : fallback.useDeckFont
  };
}

function normalizePageNumberSlot(
  input: unknown,
  fallback: ChromePageNumberStyle
): ChromePageNumberStyle {
  const record = (isRecord(input) ? input : {}) as PartialChromePageNumber;
  return {
    ...normalizeChromeSlot(record, fallback),
    template:
      typeof record.template === "string" && record.template.trim().length > 0
        ? record.template.slice(0, 48)
        : fallback.template
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
