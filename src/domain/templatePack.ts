import type {
  CardLayer,
  CardLineLayer,
  CardShapeLayer,
  CardTextBoxLayer,
  CardType,
  CardnewsError,
  CardnewsResult,
  ChromeConfig,
  StylePresetRecord
} from "./types.js";
import { normalizeChromeConfig } from "./chromeConfig.js";

export const templatePackSchema = "kkongdon.cardnews.template-pack.v1";
export const maxTemplatePackCards = 50;
export const maxTemplatePackArchiveEntries = 200;
export const maxTemplatePackJsonBytes = 512 * 1024;
export const maxTemplatePackTotalUncompressedBytes = 120 * 1024 * 1024;
export const maxTemplatePackAssetBytes = 20 * 1024 * 1024;
export const maxTemplatePackImagePixels = 36_000_000;
export const maxTemplatePackImageSide = 8_000;
export const templatePackManifestPath = "template.json";

const allowedAssetRoots = ["backgrounds/", "assets/"] as const;
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export type TemplatePackArchiveEntry = {
  readonly path: string;
  readonly uncompressedSize: number;
  readonly isDirectory?: boolean;
};

export type TemplatePackArchiveSummary = {
  readonly manifestPath: string;
  readonly assetPaths: readonly string[];
  readonly totalUncompressedBytes: number;
};

export type NormalizedTemplatePackImageLayer = {
  readonly id: string;
  readonly kind: "image";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly imagePath: string;
  readonly objectFit?: "cover" | "contain";
  readonly zIndex?: number;
  readonly opacity?: number;
};

export type NormalizedTemplatePackLayer =
  | CardTextBoxLayer
  | CardShapeLayer
  | CardLineLayer
  | NormalizedTemplatePackImageLayer;

export type NormalizedTemplatePackCard = {
  readonly type: CardType;
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly body: readonly string[];
  readonly bullets: readonly string[];
  readonly source?: string;
  readonly emphasis?: string;
  readonly backgroundImage?: string;
  readonly layers: readonly NormalizedTemplatePackLayer[];
};

export type NormalizedTemplatePackManifest = {
  readonly schema: typeof templatePackSchema;
  readonly name: string;
  readonly style?: StylePresetRecord;
  readonly chrome?: {
    readonly header?: string;
    readonly footer?: string;
    readonly pageFormat?: string;
    readonly config?: ChromeConfig;
  };
  readonly cards: readonly NormalizedTemplatePackCard[];
  readonly referencedAssetPaths: readonly string[];
  readonly warnings: readonly string[];
};

export function normalizeTemplatePackAssetPath(input: string): string | undefined {
  const normalized = input.trim().replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return undefined;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }

  if (!allowedAssetRoots.some((root) => normalized.startsWith(root))) {
    return undefined;
  }

  const extension = extensionOf(normalized);
  if (!allowedImageExtensions.has(extension)) {
    return undefined;
  }

  return normalized;
}

export function validateTemplatePackArchiveEntries(
  entries: readonly TemplatePackArchiveEntry[]
): CardnewsResult<TemplatePackArchiveSummary> {
  if (entries.length === 0) {
    return invalidInput("템플릿팩 ZIP이 비어 있습니다.");
  }
  if (entries.length > maxTemplatePackArchiveEntries) {
    return invalidInput(`템플릿팩 항목은 ${maxTemplatePackArchiveEntries}개 이하만 사용할 수 있습니다.`);
  }

  let hasManifest = false;
  let totalUncompressedBytes = 0;
  const seen = new Set<string>();
  const assetPaths: string[] = [];

  for (const entry of entries) {
    const entryPath = entry.path.replaceAll("\\", "/");
    if (entryPath.startsWith("/") || entryPath.startsWith("./") || /^[A-Za-z]:/.test(entryPath)) {
      return invalidInput(`허용되지 않는 경로입니다: ${entry.path}`);
    }
    if (entryPath.split("/").some((segment) => segment === "..")) {
      return invalidInput(`상위 폴더 이동 경로는 사용할 수 없습니다: ${entry.path}`);
    }
    if (!Number.isFinite(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      return invalidInput(`압축 해제 크기를 확인할 수 없습니다: ${entry.path}`);
    }

    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > maxTemplatePackTotalUncompressedBytes) {
      return invalidInput("템플릿팩 전체 크기가 120MB 제한을 넘었습니다.");
    }

    const duplicateKey = entryPath.toLowerCase();
    if (seen.has(duplicateKey)) {
      return invalidInput(`중복된 파일 경로가 있습니다: ${entryPath}`);
    }
    seen.add(duplicateKey);

    if (entry.isDirectory || entryPath.endsWith("/")) {
      if (entryPath !== "backgrounds/" && entryPath !== "assets/") {
        return invalidInput(`허용되지 않는 폴더입니다: ${entryPath}`);
      }
      continue;
    }

    if (entryPath === templatePackManifestPath) {
      hasManifest = true;
      if (entry.uncompressedSize > maxTemplatePackJsonBytes) {
        return invalidInput("template.json은 512KiB 이하만 사용할 수 있습니다.");
      }
      continue;
    }

    const assetPath = normalizeTemplatePackAssetPath(entryPath);
    if (!assetPath) {
      return invalidInput(`허용되지 않는 이미지 경로 또는 확장자입니다: ${entryPath}`);
    }
    if (entry.uncompressedSize > maxTemplatePackAssetBytes) {
      return invalidInput(`이미지 파일은 20MB 이하만 사용할 수 있습니다: ${entryPath}`);
    }
    assetPaths.push(assetPath);
  }

  if (!hasManifest) {
    return invalidInput("템플릿팩에는 루트의 template.json이 필요합니다.");
  }

  return {
    manifestPath: templatePackManifestPath,
    assetPaths,
    totalUncompressedBytes
  };
}

export function parseTemplatePackManifest(
  rawManifest: string | unknown,
  options: { readonly availableAssetPaths?: ReadonlySet<string> } = {}
): CardnewsResult<NormalizedTemplatePackManifest> {
  const parsed =
    typeof rawManifest === "string" ? parseJson(rawManifest) : rawManifest;
  if (isCardnewsError(parsed)) {
    return parsed;
  }

  const manifest = asRecord(parsed);
  if (!manifest) {
    return invalidInput("template.json은 JSON 객체여야 합니다.");
  }

  if (manifest["schema"] !== templatePackSchema) {
    return invalidInput(`지원하지 않는 템플릿팩 schema입니다. ${templatePackSchema}만 사용할 수 있습니다.`);
  }

  const cardsRaw = manifest["cards"];
  if (!Array.isArray(cardsRaw) || cardsRaw.length === 0) {
    return invalidInput("cards 배열에는 1장 이상의 카드가 필요합니다.");
  }
  if (cardsRaw.length > maxTemplatePackCards) {
    return invalidInput(`템플릿팩 카드는 ${maxTemplatePackCards}장 이하만 사용할 수 있습니다.`);
  }

  const warnings: string[] = [];
  const referencedAssetPaths = new Set<string>();
  const cards: NormalizedTemplatePackCard[] = [];
  for (let index = 0; index < cardsRaw.length; index += 1) {
    const parsedCard = normalizeCard(cardsRaw[index], index, options, warnings);
    if (isCardnewsError(parsedCard)) {
      return parsedCard;
    }
    if (parsedCard.backgroundImage) {
      referencedAssetPaths.add(parsedCard.backgroundImage);
    }
    for (const layer of parsedCard.layers) {
      if (layer.kind === "image") {
        referencedAssetPaths.add(layer.imagePath);
      }
    }
    cards.push(parsedCard);
  }

  const style = normalizeStyle(manifest["style"], manifest["name"]);
  if (isCardnewsError(style)) {
    return style;
  }

  const chrome = normalizeChrome(manifest["chrome"]);

  return {
    schema: templatePackSchema,
    name: stringOr(manifest["name"], "템플릿팩").trim() || "템플릿팩",
    ...(style ? { style } : {}),
    ...(chrome ? { chrome } : {}),
    cards,
    referencedAssetPaths: [...referencedAssetPaths],
    warnings
  };
}

function normalizeCard(
  input: unknown,
  index: number,
  options: { readonly availableAssetPaths?: ReadonlySet<string> },
  warnings: string[]
): CardnewsResult<NormalizedTemplatePackCard> {
  const record = asRecord(input);
  if (!record) {
    return invalidInput(`cards[${index}]는 객체여야 합니다.`);
  }

  const backgroundImage = normalizeOptionalAssetReference(record["backgroundImage"], options);
  if (isCardnewsError(backgroundImage)) {
    return invalidInput(`cards[${index}].backgroundImage: ${backgroundImage.message}`);
  }

  const layersRaw = record["layers"];
  const layers: NormalizedTemplatePackLayer[] = [];
  if (layersRaw !== undefined) {
    if (!Array.isArray(layersRaw)) {
      return invalidInput(`cards[${index}].layers는 배열이어야 합니다.`);
    }
    for (let layerIndex = 0; layerIndex < layersRaw.length; layerIndex += 1) {
      const layer = normalizeLayer(layersRaw[layerIndex], index, layerIndex, options, warnings);
      if (isCardnewsError(layer)) {
        return layer;
      }
      layers.push(layer);
    }
  }

  const subtitle = stringOrUndefined(record["subtitle"]);
  const badge = stringOrUndefined(record["badge"]);
  const source = stringOrUndefined(record["source"]);
  const emphasis = stringOrUndefined(record["emphasis"] ?? record["highlight"]);

  return {
    type: normalizeCardType(record["type"]),
    title: stringOr(record["title"], `카드 ${index + 1}`),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(badge !== undefined ? { badge } : {}),
    body: normalizeStringList(record["body"] ?? record["paragraphs"]),
    bullets: normalizeStringList(record["bullets"]),
    ...(source !== undefined ? { source } : {}),
    ...(emphasis !== undefined ? { emphasis } : {}),
    ...(backgroundImage ? { backgroundImage } : {}),
    layers
  };
}

function normalizeLayer(
  input: unknown,
  cardIndex: number,
  layerIndex: number,
  options: { readonly availableAssetPaths?: ReadonlySet<string> },
  warnings: string[]
): CardnewsResult<NormalizedTemplatePackLayer> {
  const record = asRecord(input);
  if (!record) {
    return invalidInput(`cards[${cardIndex}].layers[${layerIndex}]는 객체여야 합니다.`);
  }
  const kind = record["kind"];
  const id = stringOr(record["id"], `tp-${cardIndex + 1}-${layerIndex + 1}`);

  if (kind === "text") {
    const color = stringOrUndefined(record["color"]);
    const backgroundColor = stringOrUndefined(record["backgroundColor"]);
    const fontSize = numberOrUndefined(record["fontSize"]);
    const fontWeight = numberOrUndefined(record["fontWeight"] ?? record["weight"]);
    const align = normalizeTextAlign(record["align"]);
    const zIndex = numberOrUndefined(record["zIndex"]);
    const opacity = numberOrUndefined(record["opacity"]);

    return {
      id,
      kind,
      x: numberOr(record["x"], 10),
      y: numberOr(record["y"], 10),
      width: numberOr(record["width"], 80),
      height: numberOr(record["height"], 10),
      text: stringOr(record["text"], ""),
      ...(color !== undefined ? { color } : {}),
      ...(backgroundColor !== undefined ? { backgroundColor } : {}),
      ...(fontSize !== undefined ? { fontSize } : {}),
      ...(fontWeight !== undefined ? { fontWeight } : {}),
      ...(typeof record["italic"] === "boolean" ? { italic: record["italic"] } : {}),
      ...(align !== undefined ? { align } : {}),
      ...(zIndex !== undefined ? { zIndex } : {}),
      ...(opacity !== undefined ? { opacity } : {})
    };
  }

  if (kind === "shape") {
    const rotation = numberOrUndefined(record["rotation"]);
    if (rotation !== undefined) {
      warnings.push(`cards[${cardIndex}].layers[${layerIndex}] shape rotation은 v1에서 무시됩니다.`);
    }
    const stroke = stringOrUndefined(record["stroke"]);
    const strokeWidth = numberOrUndefined(record["strokeWidth"]);
    const radius = numberOrUndefined(record["radius"]);
    const zIndex = numberOrUndefined(record["zIndex"]);
    const opacity = numberOrUndefined(record["opacity"]);

    return {
      id,
      kind,
      x: numberOr(record["x"], 0),
      y: numberOr(record["y"], 0),
      width: numberOr(record["width"], 20),
      height: numberOr(record["height"], 8),
      shape: record["shape"] === "ellipse" ? "ellipse" : "rect",
      fill: stringOr(record["fill"] ?? record["color"], "#ffd23c"),
      ...(stroke !== undefined ? { stroke } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(zIndex !== undefined ? { zIndex } : {}),
      ...(opacity !== undefined ? { opacity } : {})
    };
  }

  if (kind === "line") {
    const zIndex = numberOrUndefined(record["zIndex"]);
    const opacity = numberOrUndefined(record["opacity"]);

    return {
      id,
      kind,
      x1: numberOr(record["x1"] ?? record["x"], 10),
      y1: numberOr(record["y1"] ?? record["y"], 80),
      x2: numberOr(record["x2"], numberOr(record["x"], 10) + numberOr(record["width"], 24)),
      y2: numberOr(record["y2"], numberOr(record["y"], 80) + numberOr(record["height"], 0)),
      thickness: numberOr(record["thickness"] ?? record["strokeWidth"], 4),
      color: stringOr(record["color"] ?? record["stroke"], "#ffffff"),
      ...(zIndex !== undefined ? { zIndex } : {}),
      ...(opacity !== undefined ? { opacity } : {})
    };
  }

  if (kind === "image") {
    const imagePath = normalizeOptionalAssetReference(
      record["image"] ?? record["asset"] ?? record["src"] ?? record["imagePath"],
      options
    );
    if (isCardnewsError(imagePath)) {
      return invalidInput(`cards[${cardIndex}].layers[${layerIndex}].image: ${imagePath.message}`);
    }
    if (!imagePath) {
      return invalidInput(`cards[${cardIndex}].layers[${layerIndex}] 이미지 경로가 필요합니다.`);
    }
    const zIndex = numberOrUndefined(record["zIndex"]);
    const opacity = numberOrUndefined(record["opacity"]);

    return {
      id,
      kind,
      imagePath,
      x: numberOr(record["x"], 10),
      y: numberOr(record["y"], 10),
      width: numberOr(record["width"], 20),
      height: numberOr(record["height"], 20),
      ...(record["objectFit"] === "contain" ? { objectFit: "contain" } : { objectFit: "cover" }),
      ...(zIndex !== undefined ? { zIndex } : {}),
      ...(opacity !== undefined ? { opacity } : {})
    };
  }

  return invalidInput(`지원하지 않는 레이어 kind입니다: ${String(kind)}`);
}

function normalizeOptionalAssetReference(
  value: unknown,
  options: { readonly availableAssetPaths?: ReadonlySet<string> }
): CardnewsResult<string | undefined> {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return invalidInput("이미지 경로는 문자열이어야 합니다.");
  }
  const normalized = normalizeTemplatePackAssetPath(value);
  if (!normalized) {
    return invalidInput(`허용되지 않는 이미지 경로입니다: ${value}`);
  }
  if (options.availableAssetPaths && !options.availableAssetPaths.has(normalized)) {
    return invalidInput(`템플릿팩에 없는 이미지입니다: ${normalized}`);
  }
  return normalized;
}

function normalizeStyle(input: unknown, fallbackName: unknown): CardnewsResult<StylePresetRecord | undefined> {
  if (input === undefined || input === null) {
    return undefined;
  }
  const record = asRecord(input);
  if (!record) {
    return invalidInput("style은 객체여야 합니다.");
  }
  const name = stringOr(record["name"], stringOr(fallbackName, "GPTs 템플릿 스타일"));
  const id = stringOr(record["id"], `custom-template-pack-${slugify(name)}`);
  const numberInk = stringOrUndefined(record["numberInk"]);
  return {
    id,
    name,
    usesPhoto: booleanOr(record["usesPhoto"], true),
    pageBackground: stringOr(record["pageBackground"], "#111111"),
    textBackdrop: stringOr(record["textBackdrop"], "rgba(0,0,0,0)"),
    chromeBackdrop: stringOr(record["chromeBackdrop"], "rgba(0,0,0,0)"),
    ink: stringOr(record["ink"], "#ffffff"),
    inkSub: stringOr(record["inkSub"], "#f5f5f5"),
    inkMuted: stringOr(record["inkMuted"], "#d6d6d6"),
    accentDefault: stringOr(record["accentDefault"], "#ffd23c"),
    badgeBackground: stringOr(record["badgeBackground"], "#ffd23c"),
    badgeInk: stringOr(record["badgeInk"], "#111111"),
    fontTitle: stringOr(record["fontTitle"], "\"Pretendard\", \"Noto Sans KR\", sans-serif"),
    fontBody: stringOr(record["fontBody"], "\"Pretendard\", \"Noto Sans KR\", sans-serif"),
    usesSurface: booleanOr(record["usesSurface"], false),
    defaultDim: numberOr(record["defaultDim"], 0.42),
    ...(numberInk !== undefined ? { numberInk } : {})
  };
}

function normalizeChrome(input: unknown): NormalizedTemplatePackManifest["chrome"] | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  const header = stringOrUndefined(record["header"]);
  const footer = stringOrUndefined(record["footer"]);
  const pageFormat = stringOrUndefined(record["pageFormat"]);
  const config = asRecord(record["config"]) ? normalizeChromeConfig(record["config"]) : undefined;
  const chrome = {
    ...(header !== undefined ? { header } : {}),
    ...(footer !== undefined ? { footer } : {}),
    ...(pageFormat !== undefined ? { pageFormat } : {}),
    ...(config !== undefined ? { config } : {})
  };
  return Object.keys(chrome).length > 0 ? chrome : undefined;
}

function normalizeCardType(input: unknown): CardType {
  if (input === "body" || input === "cta") {
    return input;
  }
  if (input === "closing") {
    return "cta";
  }
  return "cover";
}

function normalizeStringList(input: unknown): readonly string[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTextAlign(input: unknown): "left" | "center" | "right" | undefined {
  return input === "left" || input === "center" || input === "right" ? input : undefined;
}

function parseJson(input: string): CardnewsResult<unknown> {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return invalidInput("template.json을 JSON으로 읽을 수 없습니다.");
  }
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function stringOr(input: unknown, fallback: string): string {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : fallback;
}

function stringOrUndefined(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined;
}

function booleanOr(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function numberOr(input: unknown, fallback: number): number {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback;
}

function numberOrUndefined(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function extensionOf(input: string): string {
  const lastDot = input.lastIndexOf(".");
  return lastDot >= 0 ? input.slice(lastDot).toLowerCase() : "";
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "style";
}

function isCardnewsError<T>(input: CardnewsResult<T>): input is CardnewsError {
  return typeof input === "object" && input !== null && "ok" in input && input.ok === false;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}
