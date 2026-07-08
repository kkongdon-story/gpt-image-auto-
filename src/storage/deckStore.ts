// noqa: SIZE_OK - v4 release preserves one storage boundary for migration safety; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import fs from "node:fs/promises";
import path from "node:path";
import { parseCardText } from "../domain/cardParser.js";
import { normalizeChromeConfig } from "../domain/chromeConfig.js";
import {
  migrateLineLayer,
  normalizeLineLayer,
  type LegacyLineLayer
} from "../domain/lineLayer.js";
import type {
  AppSettings,
  BackgroundLibraryItem,
  Card,
  CardBadgeOverride,
  CardImageAdjust,
  CardLayer,
  CardLayoutOverride,
  CardOverride,
  CardOverrideMap,
  CardTypographyOverride,
  CardnewsError,
  CardnewsResult,
  Deck,
  DeckDraft,
  DeckPreset,
  FontLibraryItem,
  ImageLibraryItem,
  LocalImageRef,
  NextHintConfig,
  StylePresetRecord,
  StyleProfile,
  WorkspaceState
} from "../domain/types.js";
import { isSafeStylePresetRecord } from "../render-engine/styleSafety.js";

export type StoredLocalImage = {
  readonly absolutePath: string;
  readonly extension: string;
  readonly ref: LocalImageRef;
};

export type ImageAssetRole = "background" | "style-reference";

export const currentDeckId = "current";

const maxImageSizeBytes = 25 * 1024 * 1024;
const maxFontSizeBytes = 25 * 1024 * 1024;

export function getCardnewsStorageRoot(userDataPath: string): string {
  return path.join(userDataPath, "gpt-cardnews-auto");
}

export async function saveDeckDraft(
  storageRoot: string,
  input: DeckDraft,
  styleProfile: StyleProfile | undefined
): Promise<CardnewsResult<Deck>> {
  const deck = buildDeckFromDraft(currentDeckId, input, styleProfile);
  if (isCardnewsError(deck)) {
    return deck;
  }

  await fs.mkdir(getDeckDirectory(storageRoot, deck.id), { recursive: true });
  await fs.writeFile(getDeckPath(storageRoot, deck.id), JSON.stringify(deck, null, 2), "utf8");

  return deck;
}

export function buildDeckFromDraft(
  deckId: string,
  input: DeckDraft,
  styleProfile: StyleProfile | undefined
): CardnewsResult<Deck> {
  const cards: Card[] = [];

  for (const cardDraft of input.cards) {
    const parsed = parseCardText(cardDraft.rawText, cardDraft.index);
    if (isCardnewsError(parsed)) {
      return invalidInput(`카드 ${cardDraft.index}: ${parsed.message}`);
    }

    cards.push(parsed);
  }

  const deck: Deck = {
    id: deckId,
    headerLabel: normalizeRequiredText(input.headerLabel, "MONEY NOTE"),
    footerAccount: normalizeFooterAccount(input.footerAccount),
    cards,
    ...(styleProfile ? { styleProfile } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(typeof input.backgroundDim === "number" ? { backgroundDim: input.backgroundDim } : {}),
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.backgroundId ? { backgroundId: input.backgroundId } : {}),
    ...(input.fontId ? { fontId: input.fontId } : {}),
    ...(input.chrome ? { chrome: normalizeChromeConfig(input.chrome) } : {}),
    ...(input.nextHint ? { nextHint: normalizeNextHintConfig(input.nextHint) } : {}),
    ...(input.overrides ? { overrides: sanitizeOverrideMap(input.overrides) } : {})
  };

  return deck;
}

export async function loadDeck(storageRoot: string, deckId: string): Promise<CardnewsResult<Deck>> {
  if (deckId !== currentDeckId) {
    return invalidInput("알 수 없는 deck id입니다.");
  }

  try {
    const deckText = await fs.readFile(getDeckPath(storageRoot, deckId), "utf8");
    return parseStoredDeck(deckText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 저장소 오류";

    return storageFailed(`저장된 deck을 불러오지 못했습니다: ${message}`);
  }
}

export async function copyImageToDeckAssets(
  storageRoot: string,
  sourcePath: string,
  role: ImageAssetRole,
  sequence: number
): Promise<CardnewsResult<StoredLocalImage>> {
  const metadata = await readImageMetadata(sourcePath);
  if (isCardnewsError(metadata)) {
    return metadata;
  }

  const assetId = role === "background" ? "background" : `style-reference-${sequence}`;
  const assetDirectory = getAssetDirectory(storageRoot, currentDeckId);
  const assetPath = path.join(assetDirectory, `${assetId}.${metadata.extension}`);
  const ref: LocalImageRef = {
    id: assetId,
    displayName: path.basename(sourcePath),
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes
  };

  await fs.mkdir(assetDirectory, { recursive: true });
  if (role === "background") {
    // 확장자가 다른 이전 배경(background.png vs background.jpg)이 남아
    // findDeckAssetPath가 옛 파일을 먼저 찾는 문제를 막는다.
    await removeAssetVariants(assetDirectory, "background");
  }
  await fs.copyFile(sourcePath, assetPath);

  return {
    absolutePath: assetPath,
    extension: metadata.extension,
    ref
  };
}

export async function removeDeckBackgroundAsset(
  storageRoot: string,
  deckId: string
): Promise<void> {
  await removeAssetVariants(getAssetDirectory(storageRoot, deckId), "background");
}

async function removeAssetVariants(assetDirectory: string, assetId: string): Promise<void> {
  for (const extension of ["png", "jpg", "jpeg", "webp"]) {
    const candidate = path.join(assetDirectory, `${assetId}.${extension}`);
    try {
      await fs.unlink(candidate);
    } catch {
      // 없는 파일은 무시
    }
  }
}

export async function findDeckAssetPath(
  storageRoot: string,
  deckId: string,
  assetId: string
): Promise<string | undefined> {
  const assetDirectory = getAssetDirectory(storageRoot, deckId);

  for (const extension of ["png", "jpg", "jpeg", "webp"]) {
    const assetPath = path.join(assetDirectory, `${assetId}.${extension}`);
    if (await pathExists(assetPath)) {
      return assetPath;
    }
  }

  return undefined;
}

export function getRenderOutputDirectory(storageRoot: string, jobId: string): string {
  return path.join(storageRoot, "renders", jobId);
}

function getDeckDirectory(storageRoot: string, deckId: string): string {
  return path.join(storageRoot, "decks", deckId);
}

function getAssetDirectory(storageRoot: string, deckId: string): string {
  return path.join(getDeckDirectory(storageRoot, deckId), "assets");
}

function getDeckPath(storageRoot: string, deckId: string): string {
  return path.join(getDeckDirectory(storageRoot, deckId), "deck.json");
}

async function readImageMetadata(sourcePath: string): Promise<
  CardnewsResult<{
    readonly extension: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
  }>
> {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  const mimeType = mimeTypeForExtension(extension);
  if (!mimeType) {
    return invalidInput("지원하지 않는 이미지 형식입니다. png, jpg, jpeg, webp만 사용할 수 있습니다.");
  }

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    return invalidInput("선택한 경로가 파일이 아닙니다.");
  }

  if (stat.size > maxImageSizeBytes) {
    return invalidInput("이미지 파일은 25MB 이하만 사용할 수 있습니다.");
  }

  return { extension, mimeType, sizeBytes: stat.size };
}

function mimeTypeForExtension(extension: string): string | undefined {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function parseStoredDeck(deckText: string): CardnewsResult<Deck> {
  const parsed: unknown = JSON.parse(deckText);
  if (typeof parsed !== "object" || parsed === null) {
    return storageFailed("deck.json 형식이 올바르지 않습니다.");
  }

  if (!("id" in parsed) || parsed.id !== currentDeckId) {
    return storageFailed("deck id가 올바르지 않습니다.");
  }

  if (!("headerLabel" in parsed) || typeof parsed.headerLabel !== "string") {
    return storageFailed("deck headerLabel이 올바르지 않습니다.");
  }

  if (!("footerAccount" in parsed) || typeof parsed.footerAccount !== "string") {
    return storageFailed("deck footerAccount가 올바르지 않습니다.");
  }

  if (!("cards" in parsed) || !Array.isArray(parsed.cards)) {
    return storageFailed("deck cards가 올바르지 않습니다.");
  }

  const cards = parseStoredCards(parsed.cards);
  if (isCardnewsError(cards)) {
    return cards;
  }

  return {
    id: parsed.id,
    headerLabel: parsed.headerLabel,
    footerAccount: normalizeFooterAccount(parsed.footerAccount),
    cards,
    ...("styleProfile" in parsed && isStyleProfile(parsed.styleProfile)
      ? { styleProfile: parsed.styleProfile }
      : {}),
    ...("styleId" in parsed && typeof parsed.styleId === "string"
      ? { styleId: parsed.styleId }
      : {}),
    ...("accentColor" in parsed && typeof parsed.accentColor === "string"
      ? { accentColor: parsed.accentColor }
      : {}),
    ...("backgroundDim" in parsed && typeof parsed.backgroundDim === "number"
      ? { backgroundDim: parsed.backgroundDim }
      : {}),
    ...("aspectRatio" in parsed && typeof parsed.aspectRatio === "string"
      ? { aspectRatio: parsed.aspectRatio }
      : {}),
    ...("backgroundId" in parsed && typeof parsed.backgroundId === "string"
      ? { backgroundId: parsed.backgroundId }
      : {}),
    ...("fontId" in parsed && typeof parsed.fontId === "string"
      ? { fontId: parsed.fontId }
      : {}),
    ...("chrome" in parsed && isChromeConfigCandidate(parsed.chrome)
      ? { chrome: normalizeChromeConfig(parsed.chrome) }
      : {}),
    ...("nextHint" in parsed && isNextHintConfig(parsed.nextHint)
      ? { nextHint: normalizeNextHintConfig(parsed.nextHint) }
      : {}),
    ...("overrides" in parsed && isCardOverrideMap(parsed.overrides)
      ? { overrides: sanitizeOverrideMap(parsed.overrides) }
      : {})
  };
}

function parseStoredCards(cards: readonly unknown[]): CardnewsResult<readonly Card[]> {
  const parsedCards: Card[] = [];

  for (const candidate of cards) {
    if (!isStoredCard(candidate)) {
      return storageFailed("저장된 카드 형식이 올바르지 않습니다.");
    }

    parsedCards.push(candidate);
  }

  return parsedCards;
}

function isStoredCard(candidate: unknown): candidate is Card {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  return (
    "index" in candidate &&
    typeof candidate.index === "number" &&
    "type" in candidate &&
    (candidate.type === "cover" || candidate.type === "body" || candidate.type === "cta") &&
    "title" in candidate &&
    typeof candidate.title === "string" &&
    "paragraphs" in candidate &&
    Array.isArray(candidate.paragraphs) &&
    "bullets" in candidate &&
    Array.isArray(candidate.bullets)
  );
}

function isLocalImageRef(candidate: unknown): candidate is LocalImageRef {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  return (
    "id" in candidate &&
    typeof candidate.id === "string" &&
    "displayName" in candidate &&
    typeof candidate.displayName === "string" &&
    "mimeType" in candidate &&
    typeof candidate.mimeType === "string" &&
    "sizeBytes" in candidate &&
    typeof candidate.sizeBytes === "number"
  );
}

function isCardOverrideMap(candidate: unknown): candidate is CardOverrideMap {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  return Object.entries(candidate).every(
    ([key, value]) => /^\d+$/.test(key) && isCardOverride(value)
  );
}

function isCardOverride(candidate: unknown): candidate is CardOverride {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["backgroundId"] === undefined ||
      record["backgroundId"] === null ||
      typeof record["backgroundId"] === "string") &&
    (record["adjust"] === undefined || isCardImageAdjust(record["adjust"])) &&
    (record["layout"] === undefined || isCardLayoutOverride(record["layout"])) &&
    (record["dim"] === undefined || typeof record["dim"] === "number") &&
    (record["badge"] === undefined || isCardBadgeOverride(record["badge"])) &&
    (record["typography"] === undefined || isCardTypographyOverride(record["typography"])) &&
    (record["layers"] === undefined ||
      (Array.isArray(record["layers"]) && record["layers"].every(isCardLayer)))
  );
}

function isCardImageAdjust(candidate: unknown): candidate is CardImageAdjust {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    typeof record["brightness"] === "number" &&
    typeof record["contrast"] === "number" &&
    typeof record["saturation"] === "number"
  );
}

function isCardLayoutOverride(candidate: unknown): candidate is CardLayoutOverride {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["align"] === "left" || record["align"] === "center") &&
    typeof record["offsetY"] === "number" &&
    typeof record["gapBadge"] === "number" &&
    typeof record["gapSubtitle"] === "number"
  );
}

function isCardTypographyOverride(candidate: unknown): candidate is CardTypographyOverride {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["sizeScale"] === undefined || typeof record["sizeScale"] === "number") &&
    (record["weight"] === undefined || typeof record["weight"] === "number") &&
    (record["italic"] === undefined || typeof record["italic"] === "boolean") &&
    (record["letterSpacing"] === undefined || typeof record["letterSpacing"] === "number") &&
    (record["lineHeight"] === undefined || typeof record["lineHeight"] === "number") &&
    (record["scope"] === undefined ||
      record["scope"] === "all" ||
      record["scope"] === "title" ||
      record["scope"] === "body")
  );
}

function isCardBadgeOverride(candidate: unknown): candidate is CardBadgeOverride {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["shape"] === undefined ||
      record["shape"] === "pill" ||
      record["shape"] === "rect" ||
      record["shape"] === "none") &&
    (record["imageId"] === undefined || typeof record["imageId"] === "string") &&
    (record["imageHeight"] === undefined || typeof record["imageHeight"] === "number")
  );
}

function isChromeConfigCandidate(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}

function isNextHintConfig(candidate: unknown): candidate is NextHintConfig {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["kind"] === "arrows" || record["kind"] === "image" || record["kind"] === "none") &&
    (record["imageId"] === undefined || typeof record["imageId"] === "string") &&
    (record["height"] === undefined || typeof record["height"] === "number")
  );
}

function normalizeNextHintConfig(input: NextHintConfig): NextHintConfig {
  if (input.kind !== "image") {
    return { kind: input.kind };
  }

  const imageId = input.imageId?.trim();
  const height = typeof input.height === "number" ? Math.round(Math.min(72, Math.max(24, input.height))) : 40;
  return {
    kind: "image",
    ...(imageId ? { imageId } : {}),
    height
  };
}

function isCardLayer(candidate: unknown): candidate is CardLayer {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  const hasCommon =
    typeof record["id"] === "string" &&
    (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
    (record["opacity"] === undefined || typeof record["opacity"] === "number");
  if (!hasCommon) {
    return false;
  }

  if (record["kind"] === "line") {
    return isEndpointLineLayerRecord(record) || isLegacyLineLayerRecord(record);
  }

  const hasBox =
    typeof record["x"] === "number" &&
    typeof record["y"] === "number" &&
    typeof record["width"] === "number" &&
    typeof record["height"] === "number";
  if (!hasBox) {
    return false;
  }

  switch (record["kind"]) {
    case "text":
      return (
        typeof record["text"] === "string" &&
        (record["color"] === undefined || typeof record["color"] === "string") &&
        (record["backgroundColor"] === undefined || typeof record["backgroundColor"] === "string") &&
        (record["fontSize"] === undefined || typeof record["fontSize"] === "number") &&
        (record["fontWeight"] === undefined || typeof record["fontWeight"] === "number") &&
        (record["italic"] === undefined || typeof record["italic"] === "boolean") &&
        (record["align"] === undefined ||
          record["align"] === "left" ||
          record["align"] === "center" ||
          record["align"] === "right")
      );
    case "shape":
      return (
        (record["shape"] === "rect" || record["shape"] === "ellipse") &&
        typeof record["fill"] === "string" &&
        (record["stroke"] === undefined || typeof record["stroke"] === "string") &&
        (record["strokeWidth"] === undefined || typeof record["strokeWidth"] === "number") &&
        (record["radius"] === undefined || typeof record["radius"] === "number")
      );
    case "image":
      return (
        typeof record["backgroundId"] === "string" &&
        (record["objectFit"] === undefined ||
          record["objectFit"] === "cover" ||
          record["objectFit"] === "contain")
      );
    default:
      return false;
  }
}

function sanitizeOverrideMap(overrides: CardOverrideMap): CardOverrideMap {
  const entries = Object.entries(overrides)
    .map(([key, override]) => [key, sanitizeOverride(override)] as const)
    .filter(([, override]) => !isEmptyOverride(override));
  return Object.fromEntries(entries);
}

function sanitizeOverride(override: CardOverride): CardOverride {
  const layers = override.layers?.map(sanitizeCardLayer);
  return {
    ...override,
    ...(layers ? { layers } : {})
  };
}

function sanitizeCardLayer(layer: CardLayer): CardLayer {
  const record = layer as unknown as Record<string, unknown>;
  if (isEndpointLineLayerRecord(record)) {
    return normalizeLineLayer({
      id: record["id"],
      kind: "line",
      x1: record["x1"],
      y1: record["y1"],
      x2: record["x2"],
      y2: record["y2"],
      thickness: record["thickness"],
      color: record["color"],
      ...(record["zIndex"] !== undefined ? { zIndex: record["zIndex"] } : {}),
      ...(record["opacity"] !== undefined ? { opacity: record["opacity"] } : {})
    });
  }
  if (isLegacyLineLayerRecord(record)) {
    return migrateLineLayer({
      id: record["id"],
      kind: "line",
      x: record["x"],
      y: record["y"],
      width: record["width"],
      height: record["height"],
      color: record["color"],
      ...(record["strokeWidth"] !== undefined ? { strokeWidth: record["strokeWidth"] } : {}),
      ...(record["rotation"] !== undefined ? { rotation: record["rotation"] } : {}),
      ...(record["zIndex"] !== undefined ? { zIndex: record["zIndex"] } : {}),
      ...(record["opacity"] !== undefined ? { opacity: record["opacity"] } : {})
    });
  }

  return layer;
}

function isEndpointLineLayerRecord(record: Record<string, unknown>): record is {
  readonly id: string;
  readonly kind: "line";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly thickness: number;
  readonly color: string;
  readonly zIndex?: number;
  readonly opacity?: number;
} {
  return (
    record["kind"] === "line" &&
    typeof record["id"] === "string" &&
    typeof record["x1"] === "number" &&
    typeof record["y1"] === "number" &&
    typeof record["x2"] === "number" &&
    typeof record["y2"] === "number" &&
    typeof record["thickness"] === "number" &&
    typeof record["color"] === "string" &&
    (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
    (record["opacity"] === undefined || typeof record["opacity"] === "number")
  );
}

function isLegacyLineLayerRecord(record: Record<string, unknown>): record is LegacyLineLayer {
  return (
    record["kind"] === "line" &&
    typeof record["id"] === "string" &&
    typeof record["x"] === "number" &&
    typeof record["y"] === "number" &&
    typeof record["width"] === "number" &&
    typeof record["height"] === "number" &&
    typeof record["color"] === "string" &&
    (record["strokeWidth"] === undefined || typeof record["strokeWidth"] === "number") &&
    (record["rotation"] === undefined || typeof record["rotation"] === "number") &&
    (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
    (record["opacity"] === undefined || typeof record["opacity"] === "number")
  );
}

function isEmptyOverride(override: CardOverride): boolean {
  return (
    override.backgroundId === undefined &&
    override.adjust === undefined &&
    override.layout === undefined &&
    override.dim === undefined &&
    (override.badge === undefined || isEmptyCardBadgeOverride(override.badge)) &&
    override.typography === undefined &&
    (override.layers === undefined || override.layers.length === 0)
  );
}

function isEmptyCardBadgeOverride(badge: CardBadgeOverride): boolean {
  return badge.shape === undefined && !badge.imageId && badge.imageHeight === undefined;
}

function isStyleProfile(candidate: unknown): candidate is StyleProfile {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  return (
    "id" in candidate &&
    typeof candidate.id === "string" &&
    "name" in candidate &&
    typeof candidate.name === "string" &&
    "palette" in candidate &&
    Array.isArray(candidate.palette) &&
    "layoutMood" in candidate &&
    typeof candidate.layoutMood === "string" &&
    "fontMood" in candidate &&
    typeof candidate.fontMood === "string" &&
    "approved" in candidate &&
    typeof candidate.approved === "boolean"
  );
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRequiredText(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeFooterAccount(value: string): string {
  const normalized = normalizeRequiredText(value, "kkongdon_story").replace(/^@+/, "").trim();
  return normalized.length > 0 ? normalized : "kkongdon_story";
}

// ── 배경 라이브러리 ────────────────────────────────────────────────
// 배경 이미지를 userData/library/backgrounds에 누적 저장하고 인덱스 JSON으로 관리한다.

type StoredBackgroundEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: string;
  readonly attribution?: string;
};

type StoredImageEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: string;
  readonly attribution?: string;
};

export async function listBackgroundLibrary(
  storageRoot: string
): Promise<readonly BackgroundLibraryItem[]> {
  const entries = await readBackgroundIndex(storageRoot);
  return entries.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.attribution ? { attribution: entry.attribution } : {})
  }));
}

export async function addBackgroundToLibrary(
  storageRoot: string,
  sourcePath: string,
  attribution?: string
): Promise<CardnewsResult<BackgroundLibraryItem>> {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (!mimeTypeForExtension(extension)) {
    return invalidInput("지원하지 않는 이미지 형식입니다. png, jpg, jpeg, webp만 사용할 수 있습니다.");
  }

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > maxImageSizeBytes) {
    return invalidInput("이미지 파일은 25MB 이하만 사용할 수 있습니다.");
  }

  const entries = await readBackgroundIndex(storageRoot);
  const id = `bg-${Date.now().toString(36)}`;
  const entry: StoredBackgroundEntry = {
    id,
    displayName: path.basename(sourcePath),
    extension,
    ...(attribution ? { attribution } : {})
  };

  await fs.mkdir(getBackgroundLibraryDirectory(storageRoot), { recursive: true });
  await fs.copyFile(
    sourcePath,
    path.join(getBackgroundLibraryDirectory(storageRoot), `${id}.${extension}`)
  );
  await writeBackgroundIndex(storageRoot, [...entries, entry]);

  return {
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.attribution ? { attribution: entry.attribution } : {})
  };
}

export async function findLibraryBackground(
  storageRoot: string,
  backgroundId: string
): Promise<{ readonly absolutePath: string; readonly entry: BackgroundLibraryItem } | undefined> {
  const entries = await readBackgroundIndex(storageRoot);
  const entry = entries.find((candidate) => candidate.id === backgroundId);
  if (!entry) {
    return undefined;
  }

  const absolutePath = path.join(
    getBackgroundLibraryDirectory(storageRoot),
    `${entry.id}.${entry.extension}`
  );
  if (!(await pathExists(absolutePath))) {
    return undefined;
  }

  return {
    absolutePath,
    entry: {
      id: entry.id,
      displayName: entry.displayName,
      ...(entry.attribution ? { attribution: entry.attribution } : {})
    }
  };
}

export async function listImageLibrary(storageRoot: string): Promise<readonly ImageLibraryItem[]> {
  const entries = await readImageIndex(storageRoot);
  return entries.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.attribution ? { attribution: entry.attribution } : {})
  }));
}

export async function addImageToLibrary(
  storageRoot: string,
  sourcePath: string,
  attribution?: string
): Promise<CardnewsResult<ImageLibraryItem>> {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (!mimeTypeForExtension(extension)) {
    return invalidInput("지원하지 않는 이미지 형식입니다. png, jpg, jpeg, webp만 사용할 수 있습니다.");
  }

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > maxImageSizeBytes) {
    return invalidInput("이미지 파일은 25MB 이하만 사용할 수 있습니다.");
  }

  const entries = await readImageIndex(storageRoot);
  const id = `img-${Date.now().toString(36)}`;
  const entry: StoredImageEntry = {
    id,
    displayName: path.basename(sourcePath),
    extension,
    ...(attribution ? { attribution } : {})
  };

  await fs.mkdir(getImageLibraryDirectory(storageRoot), { recursive: true });
  await fs.copyFile(sourcePath, path.join(getImageLibraryDirectory(storageRoot), `${id}.${extension}`));
  await writeImageIndex(storageRoot, [...entries, entry]);

  return {
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.attribution ? { attribution: entry.attribution } : {})
  };
}

export async function saveImageBufferToLibrary(
  storageRoot: string,
  pngBytes: Uint8Array,
  displayName: string,
  attribution?: string
): Promise<CardnewsResult<ImageLibraryItem>> {
  if (pngBytes.byteLength === 0 || pngBytes.byteLength > maxImageSizeBytes) {
    return invalidInput("이미지 파일은 25MB 이하만 사용할 수 있습니다.");
  }

  const entries = await readImageIndex(storageRoot);
  const id = `img-${Date.now().toString(36)}`;
  const entry: StoredImageEntry = {
    id,
    displayName: displayName.trim() || `${id}.png`,
    extension: "png",
    ...(attribution ? { attribution } : {})
  };

  await fs.mkdir(getImageLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(path.join(getImageLibraryDirectory(storageRoot), `${id}.png`), pngBytes);
  await writeImageIndex(storageRoot, [...entries, entry]);

  return {
    id: entry.id,
    displayName: entry.displayName,
    ...(entry.attribution ? { attribution: entry.attribution } : {})
  };
}

export async function findLibraryImage(
  storageRoot: string,
  imageId: string
): Promise<{ readonly absolutePath: string; readonly entry: ImageLibraryItem } | undefined> {
  const entries = await readImageIndex(storageRoot);
  const entry = entries.find((candidate) => candidate.id === imageId);
  if (!entry) {
    return undefined;
  }

  const absolutePath = path.join(getImageLibraryDirectory(storageRoot), `${entry.id}.${entry.extension}`);
  if (!(await pathExists(absolutePath))) {
    return undefined;
  }

  return {
    absolutePath,
    entry: {
      id: entry.id,
      displayName: entry.displayName,
      ...(entry.attribution ? { attribution: entry.attribution } : {})
    }
  };
}

function getLibraryDirectory(storageRoot: string): string {
  return path.join(storageRoot, "library");
}

function getBackgroundLibraryDirectory(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "backgrounds");
}

function getBackgroundIndexPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "backgrounds.json");
}

function getImageLibraryDirectory(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "images");
}

function getImageIndexPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "images.json");
}

async function readBackgroundIndex(storageRoot: string): Promise<readonly StoredBackgroundEntry[]> {
  const parsed = await readJsonFile(getBackgroundIndexPath(storageRoot));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredBackgroundEntry);
}

async function writeBackgroundIndex(
  storageRoot: string,
  entries: readonly StoredBackgroundEntry[]
): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getBackgroundIndexPath(storageRoot), JSON.stringify(entries, null, 2), "utf8");
}

function isStoredBackgroundEntry(candidate: unknown): candidate is StoredBackgroundEntry {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  return (
    "id" in candidate &&
    typeof candidate.id === "string" &&
    "displayName" in candidate &&
    typeof candidate.displayName === "string" &&
    "extension" in candidate &&
    typeof candidate.extension === "string" &&
    (!("attribution" in candidate) || typeof candidate.attribution === "string")
  );
}

async function readImageIndex(storageRoot: string): Promise<readonly StoredImageEntry[]> {
  const parsed = await readJsonFile(getImageIndexPath(storageRoot));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredImageEntry);
}

async function writeImageIndex(storageRoot: string, entries: readonly StoredImageEntry[]): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getImageIndexPath(storageRoot), JSON.stringify(entries, null, 2), "utf8");
}

function isStoredImageEntry(candidate: unknown): candidate is StoredImageEntry {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  return (
    "id" in candidate &&
    typeof candidate.id === "string" &&
    "displayName" in candidate &&
    typeof candidate.displayName === "string" &&
    "extension" in candidate &&
    typeof candidate.extension === "string" &&
    (!("attribution" in candidate) || typeof candidate.attribution === "string")
  );
}

type StoredFontEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: "ttf" | "otf" | "woff2";
};

export async function listFontLibrary(storageRoot: string): Promise<readonly FontLibraryItem[]> {
  const entries = await readFontIndex(storageRoot);
  return entries.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    extension: entry.extension
  }));
}

export async function importFontToLibrary(
  storageRoot: string,
  sourcePath: string
): Promise<CardnewsResult<FontLibraryItem>> {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  if (!isFontExtension(extension)) {
    return invalidInput("지원하지 않는 폰트 형식입니다. ttf, otf, woff2만 사용할 수 있습니다.");
  }

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > maxFontSizeBytes) {
    return invalidInput("폰트 파일은 25MB 이하만 사용할 수 있습니다.");
  }

  const entries = await readFontIndex(storageRoot);
  const id = `font-${Date.now().toString(36)}`;
  const entry: StoredFontEntry = {
    id,
    displayName: path.basename(sourcePath),
    extension
  };

  await fs.mkdir(getFontLibraryDirectory(storageRoot), { recursive: true });
  await fs.copyFile(sourcePath, path.join(getFontLibraryDirectory(storageRoot), `${id}.${extension}`));
  await writeFontIndex(storageRoot, [...entries, entry]);

  return entry;
}

export async function findLibraryFont(
  storageRoot: string,
  fontId: string
): Promise<{ readonly absolutePath: string; readonly entry: FontLibraryItem } | undefined> {
  const entries = await readFontIndex(storageRoot);
  const entry = entries.find((candidate) => candidate.id === fontId);
  if (!entry) {
    return undefined;
  }

  const absolutePath = path.join(getFontLibraryDirectory(storageRoot), `${entry.id}.${entry.extension}`);
  if (!(await pathExists(absolutePath))) {
    return undefined;
  }

  return { absolutePath, entry };
}

export function fontMimeTypeForExtension(extension: string): string | undefined {
  switch (extension) {
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    case "woff2":
      return "font/woff2";
    default:
      return undefined;
  }
}

export function fontCssFormatForExtension(
  extension: "ttf" | "otf" | "woff2"
): "opentype" | "truetype" | "woff2" {
  switch (extension) {
    case "ttf":
      return "truetype";
    case "otf":
      return "opentype";
    case "woff2":
      return "woff2";
  }
}

function getFontLibraryDirectory(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "fonts");
}

function getFontIndexPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "fonts.json");
}

async function readFontIndex(storageRoot: string): Promise<readonly StoredFontEntry[]> {
  const parsed = await readJsonFile(getFontIndexPath(storageRoot));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStoredFontEntry);
}

async function writeFontIndex(
  storageRoot: string,
  entries: readonly StoredFontEntry[]
): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getFontIndexPath(storageRoot), JSON.stringify(entries, null, 2), "utf8");
}

function isStoredFontEntry(candidate: unknown): candidate is StoredFontEntry {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  return (
    "id" in candidate &&
    typeof candidate.id === "string" &&
    "displayName" in candidate &&
    typeof candidate.displayName === "string" &&
    "extension" in candidate &&
    isFontExtension(candidate.extension)
  );
}

function isFontExtension(value: unknown): value is "ttf" | "otf" | "woff2" {
  return value === "ttf" || value === "otf" || value === "woff2";
}

export async function listCustomStyles(storageRoot: string): Promise<readonly StylePresetRecord[]> {
  const parsed = await readJsonFile(getCustomStylesPath(storageRoot));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isStylePresetRecord);
}

export async function saveCustomStyle(
  storageRoot: string,
  style: StylePresetRecord
): Promise<readonly StylePresetRecord[]> {
  if (!isStylePresetRecord(style)) {
    return listCustomStyles(storageRoot);
  }

  const existing = await listCustomStyles(storageRoot);
  const updated = [...existing.filter((entry) => entry.id !== style.id), style].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );
  await writeCustomStyles(storageRoot, updated);
  return updated;
}

export async function deleteCustomStyle(
  storageRoot: string,
  styleId: string
): Promise<readonly StylePresetRecord[]> {
  const updated = (await listCustomStyles(storageRoot)).filter((entry) => entry.id !== styleId);
  await writeCustomStyles(storageRoot, updated);
  return updated;
}

function getCustomStylesPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "styles.json");
}

async function writeCustomStyles(
  storageRoot: string,
  styles: readonly StylePresetRecord[]
): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getCustomStylesPath(storageRoot), JSON.stringify(styles, null, 2), "utf8");
}

function isStylePresetRecord(candidate: unknown): candidate is StylePresetRecord {
  return isSafeStylePresetRecord(candidate);
}

// ── 양식 프리셋 ────────────────────────────────────────────────────
// 설정 + 카드 스켈레톤 전체 스냅샷을 이름 붙여 저장한다.

export async function listDeckPresets(storageRoot: string): Promise<readonly DeckPreset[]> {
  const parsed = await readJsonFile(getPresetsPath(storageRoot));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isDeckPreset).map(sanitizeDeckPreset);
}

export async function saveDeckPresetToStore(
  storageRoot: string,
  preset: DeckPreset
): Promise<readonly DeckPreset[]> {
  const existing = await listDeckPresets(storageRoot);
  const updated = [...existing.filter((entry) => entry.name !== preset.name), preset].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  await writePresets(storageRoot, updated);
  return updated;
}

export async function deleteDeckPresetFromStore(
  storageRoot: string,
  name: string
): Promise<readonly DeckPreset[]> {
  const updated = (await listDeckPresets(storageRoot)).filter((entry) => entry.name !== name);
  await writePresets(storageRoot, updated);
  return updated;
}

export function isDeckPreset(candidate: unknown): candidate is DeckPreset {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    typeof record["name"] === "string" &&
    record["name"].trim().length > 0 &&
    typeof record["headerLabel"] === "string" &&
    typeof record["footerAccount"] === "string" &&
    typeof record["styleId"] === "string" &&
    (record["chrome"] === undefined || isChromeConfigCandidate(record["chrome"])) &&
    (record["nextHint"] === undefined || isNextHintConfig(record["nextHint"])) &&
    (record["accentColor"] === undefined || typeof record["accentColor"] === "string") &&
    (record["backgroundDim"] === undefined || typeof record["backgroundDim"] === "number") &&
    (record["backgroundId"] === undefined || typeof record["backgroundId"] === "string") &&
    (record["aspectRatio"] === undefined || typeof record["aspectRatio"] === "string") &&
    (record["fontId"] === undefined || typeof record["fontId"] === "string") &&
    (record["overrides"] === undefined || isCardOverrideMap(record["overrides"])) &&
    Array.isArray(record["cards"]) &&
    record["cards"].every((card) => typeof card === "string")
  );
}

function getPresetsPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "presets.json");
}

async function writePresets(storageRoot: string, presets: readonly DeckPreset[]): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getPresetsPath(storageRoot), JSON.stringify(presets, null, 2), "utf8");
}

// ── 워크스페이스 자동 저장 ─────────────────────────────────────────

export async function saveWorkspaceState(
  storageRoot: string,
  state: WorkspaceState
): Promise<void> {
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.writeFile(getWorkspacePath(storageRoot), JSON.stringify(state, null, 2), "utf8");
}

export async function loadWorkspaceState(storageRoot: string): Promise<WorkspaceState | null> {
  const parsed = await readJsonFile(getWorkspacePath(storageRoot));
  return isWorkspaceState(parsed) ? sanitizeWorkspaceState(parsed) : null;
}

export function isWorkspaceState(candidate: unknown): candidate is WorkspaceState {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    typeof record["headerLabel"] === "string" &&
    typeof record["footerAccount"] === "string" &&
    typeof record["styleId"] === "string" &&
    (record["chrome"] === undefined || isChromeConfigCandidate(record["chrome"])) &&
    (record["nextHint"] === undefined || isNextHintConfig(record["nextHint"])) &&
    (record["accentColor"] === undefined || typeof record["accentColor"] === "string") &&
    (record["backgroundDim"] === undefined || typeof record["backgroundDim"] === "number") &&
    (record["backgroundId"] === undefined || typeof record["backgroundId"] === "string") &&
    (record["aspectRatio"] === undefined || typeof record["aspectRatio"] === "string") &&
    (record["fontId"] === undefined || typeof record["fontId"] === "string") &&
    (record["overrides"] === undefined || isCardOverrideMap(record["overrides"])) &&
    (record["railWidth"] === undefined || typeof record["railWidth"] === "number") &&
    (record["selectedIndex"] === undefined || typeof record["selectedIndex"] === "number") &&
    Array.isArray(record["cards"]) &&
    record["cards"].length > 0 &&
    record["cards"].every((card) => typeof card === "string")
  );
}

function getWorkspacePath(storageRoot: string): string {
  return path.join(storageRoot, "workspace.json");
}

function sanitizeDeckPreset(preset: DeckPreset): DeckPreset {
  return {
    ...preset,
    footerAccount: normalizeFooterAccount(preset.footerAccount),
    ...(preset.chrome ? { chrome: normalizeChromeConfig(preset.chrome) } : {}),
    ...(preset.nextHint ? { nextHint: normalizeNextHintConfig(preset.nextHint) } : {}),
    ...(preset.overrides ? { overrides: sanitizeOverrideMap(preset.overrides) } : {})
  };
}

function sanitizeWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    footerAccount: normalizeFooterAccount(state.footerAccount),
    ...(state.chrome ? { chrome: normalizeChromeConfig(state.chrome) } : {}),
    ...(state.nextHint ? { nextHint: normalizeNextHintConfig(state.nextHint) } : {}),
    ...(state.overrides ? { overrides: sanitizeOverrideMap(state.overrides) } : {})
  };
}

export async function loadAppSettings(storageRoot: string): Promise<AppSettings> {
  const parsed = await readJsonFile(getSettingsPath(storageRoot));
  return isAppSettings(parsed) ? parsed : {};
}

export async function saveAppSettings(storageRoot: string, settings: AppSettings): Promise<void> {
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.writeFile(getSettingsPath(storageRoot), JSON.stringify(settings, null, 2), "utf8");
}

function getSettingsPath(storageRoot: string): string {
  return path.join(storageRoot, "settings.json");
}

function isAppSettings(candidate: unknown): candidate is AppSettings {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["pixabayApiKey"] === undefined || typeof record["pixabayApiKey"] === "string") &&
    (record["aiDefaultProviderId"] === undefined || isAiProviderIdSetting(record["aiDefaultProviderId"]))
  );
}

function isAiProviderIdSetting(input: unknown): boolean {
  return input === "claude" || input === "codex" || input === "gemini";
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

function storageFailed(message: string): CardnewsError {
  return { ok: false, code: "render_failed", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
