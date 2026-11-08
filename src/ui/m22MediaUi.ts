import { compileVideoTimeline } from "../domain/videoTimeline.js";
import { setCustomBodyNumberText } from "../domain/bodyNumber.js";
import type {
  BackgroundMediaSelection,
  BodyNumberDefault,
  BodyNumberMode,
  Card,
  CardLayer,
  CardOverride,
  CardSceneSettings,
  CardVideoLayer,
  Deck,
  MediaAssetRef,
  SemanticItemId,
  SemanticItemKind,
  SemanticItemPlacement,
  SemanticSlotId,
  SemanticSlotPlacement
} from "../domain/types.js";
import { normalizeSemanticItemPlacement, normalizeSemanticSlotPlacement } from "../domain/media.js";
import {
  buildSemanticItemManifest,
  createSemanticItemId,
  normalizeSemanticIdentity,
  setSemanticItemPlacement
} from "../domain/m23Semantic.js";

export const m22SemanticSlotIds = ["title", "subtitle", "body", "badge", "footer"] as const;

export type M22MediaMode = BackgroundMediaSelection["mode"];

export type M22AudioCandidate = {
  readonly sourceId: string;
  readonly label: string;
  readonly mediaId: string;
};

export type M22SemanticSlotDraft = {
  readonly id: SemanticItemId;
  readonly kind: SemanticItemKind;
  readonly label: string;
  readonly text: string;
  readonly placement: SemanticItemPlacement;
};

export type M22VideoExportSummary = {
  readonly durationMs: number;
  readonly frameCount: number;
  readonly warningCount: number;
  readonly label: string;
};

export type M22SemanticTextUpdate = {
  readonly card?: Card;
  readonly footerAccount?: string;
  readonly headerLabel?: string;
  readonly override?: CardOverride;
};

export type M23SemanticChromeContext = {
  readonly headerLabel?: string;
  readonly pageNumber?: string;
  readonly badgeImageLabel?: string;
  readonly bodyNumber?: string;
  readonly nextHint?: string;
};

export function setBackgroundMediaMode(
  current: BackgroundMediaSelection | undefined,
  mode: M22MediaMode,
  fallbackMediaId?: string
): BackgroundMediaSelection {
  if (mode === "asset") {
    const mediaId = current?.mode === "asset" ? current.mediaId : fallbackMediaId;
    return mediaId ? { mode: "asset", mediaId } : { mode: "inherit" };
  }
  return { mode };
}

export function assignBackgroundMediaAsset(mediaId: string): BackgroundMediaSelection {
  return mediaId.trim() ? { mode: "asset", mediaId: mediaId.trim() } : { mode: "inherit" };
}

export function createVideoLayerFromAsset(asset: MediaAssetRef, id: string): CardVideoLayer {
  return {
    id,
    kind: "video",
    x: 12,
    y: 18,
    width: 76,
    height: 42,
    zIndex: 2,
    mediaId: asset.id,
    objectFit: "cover",
    clipStartMs: 0,
    clipEndMs: asset.durationMs ?? null,
    volume: asset.hasAudio ? 1 : 0
  };
}

export function buildSceneAudioCandidates(
  cardIndex: number,
  backgroundMedia: BackgroundMediaSelection | undefined,
  layers: readonly CardLayer[],
  assets: readonly MediaAssetRef[]
): readonly M22AudioCandidate[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const candidates: M22AudioCandidate[] = [];

  if (backgroundMedia?.mode === "asset") {
    const asset = assetById.get(backgroundMedia.mediaId);
    if (asset?.kind === "video" && asset.hasAudio === true) {
      candidates.push({
        sourceId: `background:${cardIndex}`,
        label: `배경 영상 · ${asset.displayName}`,
        mediaId: asset.id
      });
    }
  }

  for (const layer of layers) {
    if (layer.kind !== "video") continue;
    const asset = assetById.get(layer.mediaId);
    if (asset?.kind === "video" && asset.hasAudio === true) {
      candidates.push({
        sourceId: `layer:${layer.id}`,
        label: `영상 레이어 · ${asset.displayName}`,
        mediaId: asset.id
      });
    }
  }

  return candidates;
}

export function buildSemanticSlotDrafts(
  card: Card | undefined,
  footerAccount: string,
  override: CardOverride | undefined,
  chrome: M23SemanticChromeContext = {}
): readonly M22SemanticSlotDraft[] {
  if (!card) return [];
  const drafts = buildSemanticItemManifest({ card, footerAccount, ...(override ? { override } : {}) }).map((item) => ({
    id: item.id,
    kind: item.kind,
    label: semanticItemLabel(item.kind, item.contentIndex),
    text: item.text,
    placement: item.placement ?? defaultSemanticItemPlacement(item.kind)
  }));
  const supplemental: readonly [SemanticItemKind, string | undefined][] = [
    ["header", chrome.headerLabel],
    ["page-number", chrome.pageNumber],
    ["badge-image", chrome.badgeImageLabel],
    ["body-number", chrome.bodyNumber],
    ["next-hint", chrome.nextHint]
  ];
  for (const [kind, text] of supplemental) {
    if (text === undefined) continue;
    const id = createSemanticItemId(card.index, kind);
    const placement = override?.semanticItemPlacements?.[id];
    drafts.push({
      id,
      kind,
      label: semanticItemLabel(kind, undefined),
      text,
      placement: placement ?? defaultSemanticItemPlacement(kind)
    });
  }
  return drafts;
}

export function updateSemanticSlotPlacement(
  override: CardOverride,
  slotId: SemanticItemId,
  placement: SemanticSlotPlacement | SemanticItemPlacement,
  card?: Card,
  footerAccount?: string
): CardOverride {
  const baseOverride = card
    ? normalizeSemanticIdentity({
        card,
        override,
        ...(footerAccount !== undefined ? { footerAccount } : {})
      })
    : override;
  if (!m22SemanticSlotIds.includes(slotId as SemanticSlotId)) {
    return setSemanticItemPlacement(baseOverride, slotId, normalizeSemanticItemPlacement(placement));
  }
  return {
    ...baseOverride,
    semanticSlots: {
      ...(baseOverride.semanticSlots ?? {}),
      [slotId]: normalizeSemanticSlotPlacement(placement)
    }
  };
}

export function updateSemanticSlotText(
  card: Card | undefined,
  footerAccount: string,
  slotId: SemanticItemId,
  text: string,
  override?: CardOverride
): M22SemanticTextUpdate {
  const kind = semanticItemKindFromId(slotId);
  if (kind === "header") {
    return { headerLabel: text };
  }
  if (slotId === "footer" || kind === "footer") {
    return { footerAccount: text };
  }
  if (kind === "body-number") {
    return { override: setCustomBodyNumberText(override ?? {}, text) };
  }
  if (!card) {
    return {};
  }
  const manifestItem = buildSemanticItemManifest({
    card,
    footerAccount,
    ...(override ? { override } : {})
  }).find((item) => item.id === slotId);
  switch (manifestItem?.kind ?? kind ?? slotId) {
    case "title":
      return { card: { ...card, title: text } };
    case "subtitle":
      return { card: { ...card, subtitle: text } };
    case "badge":
    case "badge-text":
      return { card: { ...card, badge: text } };
    case "emphasis":
      return { card: { ...card, emphasis: text } };
    case "source":
      return { card: { ...card, source: text } };
    case "paragraph": {
      const index = manifestItem?.contentIndex ?? semanticContentIndex(slotId, override?.semanticContentKeys?.paragraphs);
      if (index < 0) return {};
      return {
        card: {
          ...card,
          paragraphs: card.paragraphs.map((paragraph, paragraphIndex) =>
            paragraphIndex === index ? text : paragraph
          )
        }
      };
    }
    case "bullet": {
      const index = manifestItem?.contentIndex ?? semanticContentIndex(slotId, override?.semanticContentKeys?.bullets);
      if (index < 0) return {};
      return {
        card: {
          ...card,
          bullets: card.bullets.map((bullet, bulletIndex) => (bulletIndex === index ? text : bullet))
        }
      };
    }
    case "body": {
      const lines = text.split(/\r?\n/);
      const paragraphs = lines.filter((line) => !line.trimStart().startsWith("- ")).map((line) => line.trimEnd());
      const bullets = lines
        .filter((line) => line.trimStart().startsWith("- "))
        .map((line) => line.trimStart().slice(2).trimEnd());
      return { card: { ...card, paragraphs, bullets } };
    }
  }
  return {};
}

export function semanticSlotPlacementToRect(placement: SemanticSlotPlacement): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const normalized = normalizeSemanticSlotPlacement(placement);
  const width = normalized.width ?? 24;
  const height = normalized.height ?? 8;
  const anchorOffset = normalized.anchor === "top-right" ? width : normalized.anchor === "top-center" ? width / 2 : 0;
  return {
    x: roundM22Percent(Math.min(100 - width, Math.max(0, normalized.x - anchorOffset))),
    y: roundM22Percent(Math.min(100 - height, Math.max(0, normalized.y))),
    width: roundM22Percent(width),
    height: roundM22Percent(height)
  };
}

export function rectToSemanticSlotPlacement(
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  anchor: SemanticSlotPlacement["anchor"] = "top-left"
): SemanticItemPlacement {
  const anchorOffset = anchor === "top-right" ? rect.width : anchor === "top-center" ? rect.width / 2 : 0;
  return normalizeSemanticItemPlacement({
    mode: "card",
    x: roundM22Percent(rect.x + anchorOffset),
    y: roundM22Percent(rect.y),
    width: roundM22Percent(rect.width),
    height: roundM22Percent(rect.height),
    anchor
  });
}

export function semanticItemKindFromId(itemId: SemanticItemId): SemanticItemKind | undefined {
  const kind = itemId.split(":")[1];
  return [
    "header",
    "page-number",
    "title",
    "subtitle",
    "paragraph",
    "bullet",
    "badge-text",
    "badge-image",
    "footer",
    "source",
    "emphasis",
    "body-number",
    "next-hint"
  ].includes(kind ?? "")
    ? (kind as SemanticItemKind)
    : undefined;
}

function semanticContentIndex(
  itemId: SemanticItemId,
  refs: readonly { readonly key: string }[] | undefined
): number {
  const key = itemId.split(":")[2];
  return refs?.findIndex((ref) => ref.key === key) ?? -1;
}

function semanticItemLabel(kind: SemanticItemKind, index: number | undefined): string {
  switch (kind) {
    case "title":
      return "제목";
    case "subtitle":
      return "소제목";
    case "paragraph":
      return `본문 ${Number(index ?? 0) + 1}`;
    case "bullet":
      return `불릿 ${Number(index ?? 0) + 1}`;
    case "badge-text":
      return "배지";
    case "badge-image":
      return "배지 이미지";
    case "footer":
      return "푸터";
    case "source":
      return "출처";
    case "emphasis":
      return "강조";
    case "header":
      return "헤더";
    case "page-number":
      return "페이지 번호";
    case "body-number":
      return "본문 번호";
    case "next-hint":
      return "넘김 기호";
  }
}

function defaultSemanticItemPlacement(kind: SemanticItemKind): SemanticItemPlacement {
  return {
    mode: "flow",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    anchor: kind === "footer" || kind === "page-number" || kind === "next-hint" ? "top-right" : "top-left"
  };
}

export function roundM22Percent(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(3));
}

export function buildVideoExportSummary(
  deck: Pick<Deck, "cards" | "overrides" | "backgroundId" | "backgroundMedia" | "mediaAssets" | "sceneDefaults">
): M22VideoExportSummary {
  const timeline = compileVideoTimeline(deck);
  return {
    durationMs: timeline.durationMs,
    frameCount: timeline.frameCount,
    warningCount: timeline.warnings.length,
    label: `${formatDuration(timeline.durationMs)} · ${timeline.frameCount} frames · 1080x1920 · 30fps`
  };
}

export function bodyNumberModeLabel(globalDefault: BodyNumberDefault, cardMode: BodyNumberMode): string {
  if (cardMode === "show") return "이 카드 표시";
  if (cardMode === "hide") return "이 카드 숨김";
  return globalDefault === "show" ? "전역 따름: 표시" : "전역 따름: 숨김";
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function semanticSlotLabel(slotId: SemanticSlotId): string {
  switch (slotId) {
    case "title":
      return "제목";
    case "subtitle":
      return "소제목";
    case "body":
      return "본문";
    case "badge":
      return "배지";
    case "footer":
      return "푸터";
  }
}

function semanticSlotText(slotId: SemanticSlotId, card: Card | undefined, footerAccount: string): string {
  if (!card) return "";
  switch (slotId) {
    case "title":
      return card.title;
    case "subtitle":
      return card.subtitle ?? "";
    case "body":
      return [...card.paragraphs, ...card.bullets.map((bullet) => `- ${bullet}`)].join("\n");
    case "badge":
      return card.badge ?? "";
    case "footer":
      return footerAccount;
  }
}

function defaultSemanticSlotPlacement(slotId: SemanticSlotId): SemanticSlotPlacement {
  switch (slotId) {
    case "badge":
      return { mode: "card", x: 10, y: 22, width: 32, height: 7, anchor: "top-left" };
    case "title":
      return { mode: "card", x: 10, y: 32, width: 80, height: 14, anchor: "top-left" };
    case "subtitle":
      return { mode: "card", x: 10, y: 48, width: 80, height: 8, anchor: "top-left" };
    case "body":
      return { mode: "card", x: 10, y: 58, width: 80, height: 24, anchor: "top-left" };
    case "footer":
      return { mode: "card", x: 82, y: 91, width: 16, height: 5, anchor: "top-right" };
  }
}
