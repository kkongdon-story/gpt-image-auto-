// noqa: SIZE_OK - v4 release keeps the integrated app shell stable; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from "react";
import { aspectRatios, defaultAspectRatioId, findAspectRatio } from "../domain/aspectRatios";
import { parseCardText, serializeCard } from "../domain/cardParser";
import {
  defaultChromeConfig,
  normalizeChromeConfig,
  pageNumberTemplatePresets,
  renderPageNumber
} from "../domain/chromeConfig";
import { buildTemplateDocument, parseDeckDocument, type DeckDocument } from "../domain/deckImporter";
import { normalizeHexColor } from "../domain/colors";
import {
  deleteBodyNumber,
  isBodyNumberSemanticItemId,
  resetBodyNumberToAutomatic,
  resolveBodyNumber
} from "../domain/bodyNumber";
import {
  deletePage,
  duplicatePage,
  insertPageAfter,
  insertPageBefore,
  type PageOperationResult
} from "../domain/pageOperations";
import {
  extractTemplateDocument,
  FeatureLock,
  addEditionImage,
  editionKind,
  editionProductName,
  getEditionImagePreview,
  hasProTools,
  listEditionAiProviders,
  listEditionImages,
  loadEditionBulkInput,
  loadEditionProject,
  removeEditionImage,
  removeEditionImageBackdrop,
  runEditionAi,
  runEditionBulkRender,
  saveEditionBulkTemplate,
  saveEditionProject
} from "@edition";
import { isAllowedGptsTemplateBuilderUrl, kakaoInquiryUrl } from "../domain/externalLinks";
import { createThreadsProfileUrl, normalizeThreadsHandle } from "../domain/socialLinks";
import { aiNextActionSmokeId } from "./aiAssistantModel";
import { useAiAssistant } from "./useAiAssistant";
import {
  getLineLayerAngle,
  getLineLayerRenderGeometry,
  normalizeLineLayer,
  rotateLineLayer,
  setLineLayerEndpoint,
  translateLineLayer
} from "../domain/lineLayer";
import {
  applyBodyNumberToolbarPatch,
  applyCardTypographyToolbarPatch,
  applyTextLayerToolbarPatch,
  isEditorToolbarVisible,
  resolveEditorToolbarTarget
} from "./editorToolbar";
import { findBackgroundLibraryUsage } from "./backgroundLibraryUsage";
import { findImageLibraryUsage } from "./imageLibraryUsage";
import {
  defaultCardSceneSettings,
  normalizeCardSceneSettings,
  normalizeVideoProjectMode
} from "../domain/media";
import { compileVideoTimeline, findCompiledSceneAt } from "../domain/videoTimeline";
import {
  copyLayerToClipboard,
  createLayerClipboardState,
  cutLayerToClipboard,
  pasteLayerFromClipboard,
  resolveLayerClipboardCommand,
  type LayerClipboardCommand,
  type LayerClipboardState
} from "./layerClipboard";
import {
  assignBackgroundMediaAsset,
  bodyNumberModeLabel,
  buildSceneAudioCandidates,
  buildSemanticSlotDrafts,
  buildVideoExportSummary,
  createVideoLayerFromAsset,
  formatDuration,
  rectToSemanticSlotPlacement,
  semanticSlotPlacementToRect,
  setBackgroundMediaMode,
  updateSemanticSlotText,
  updateSemanticSlotPlacement
} from "./m22MediaUi";
import {
  clientDeltaToEditorPercent,
  clientPointToEditorPercent,
  domRectToEditorRect,
  type EditorRect
} from "./editorGeometry";
import type {
  MediaCatalogAsset,
  MediaCatalogError,
  MediaCatalogResult,
  Mp4ExportApiResult,
  Mp4ExportError,
  Mp4ExportProgress,
  Mp4ExportResult
} from "../domain/cardnews-api";
import type {
  AppSettings,
  AiProviderId,
  AiProviderStatus,
  BackgroundLibraryItem,
  BackgroundMediaSelection,
  BodyNumberDefault,
  BodyNumberMode,
  BulkBindingMetadata,
  BulkBindingTarget,
  BulkRenderResult,
  Card,
  CardBadgeOverride,
  CardLayer,
  CardLineLayer,
  CardOverride,
  CardOverrideMap,
  CardSceneSettings,
  CardType,
  CardnewsError,
  CardnewsResult,
  CardTextBoxLayer,
  CardTypographyOverride,
  ChromeSlotStyle,
  ChromePageNumberStyle,
  DeckDraft,
  Deck,
  DeckPreset,
  FontData,
  FontLibraryItem,
  ImageLibraryItem,
  MediaAssetRef,
  MediaKind,
  NextHintConfig,
  RenderJobResult,
  SemanticItemId,
  SemanticSlotPlacement,
  StockImage,
  StockImageDownloadInput,
  StylePresetRecord,
  VideoProjectMode,
  WorkspaceState
} from "../domain/types";
import { buildCardHtml, buildFontFaceCss } from "../render-engine/cardTemplate";
import { buildDesignContract, buildSampleStyleJson, parseStyleJson } from "../render-engine/customStyles";
import {
  prepareSemanticItemPlacements,
  syncSemanticItemPlacements
} from "../render-engine/semanticPlacement";
import {
  accentSwatches,
  defaultStyleId,
  resolveStylePreset,
  stylePresets
} from "../render-engine/stylePresets";

const maxCards = 50;
const defaultHeaderLabel = "MONEY NOTE";
const defaultFooterAccount = "kkongdon_story";

function normalizeFooterAccount(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "@" ? trimmed : defaultFooterAccount;
}

function createBulkBindingKey(target: BulkBindingTarget, existingKeys: readonly string[]): string {
  const raw =
    target.kind === "deck"
      ? `deck_${target.field}`
      : target.kind === "standard"
        ? `card_${target.cardNumber}_${target.field}`
        : `card_${target.cardNumber}_layer_${target.layerId}`;
  const base = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 56) || "binding";
  let candidate = /^[A-Za-z]/.test(base) ? base : `b_${base}`;
  let suffix = 2;
  while (existingKeys.includes(candidate)) candidate = `${base.slice(0, 58)}_${suffix++}`;
  return candidate;
}

const customPageNumberTemplateValue = "__custom__";

function resolvePageNumberTemplateValue(template: string): string {
  return pageNumberTemplatePresets.some((preset) => preset.template === template)
    ? template
    : customPageNumberTemplateValue;
}

const aiProviderOrder: readonly AiProviderId[] = ["claude", "codex", "gemini"];
const defaultAiInstruction =
  "You are a cardnews production assistant. Help turn the user's topic or source notes into a concise Korean cardnews draft, preserving the user's intent and returning usable content for the current template.";

function videoExportStageLabel(stage: Mp4ExportProgress["stage"]): string {
  switch (stage) {
    case "compile":
      return "장면 구성";
    case "preflight":
      return "내보내기 환경 확인";
    case "producer_init":
      return "영상 프레임 준비";
    case "render":
      return "카드 렌더링";
    case "encode":
      return "MP4 인코딩";
    case "finalize":
      return "파일 마무리";
  }
}

function formatElapsedMs(elapsedMs?: number): string {
  if (!elapsedMs || elapsedMs < 1000) {
    return "0초";
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function chooseDefaultAiProvider(
  providers: readonly AiProviderStatus[],
  preferred?: AiProviderId
): AiProviderId {
  if (preferred && providers.some((provider) => provider.id === preferred)) {
    return preferred;
  }

  const installed = aiProviderOrder.find((providerId) =>
    providers.some((provider) => provider.id === providerId && provider.installed)
  );
  return installed ?? preferred ?? "claude";
}

type InspectorTab = "design" | "content" | "media" | "export";
type CardEditorTab = "content" | "design";

type PageContextMenuState = {
  readonly index: number;
  readonly x: number;
  readonly y: number;
};

type StandardBulkField = Extract<BulkBindingTarget, { readonly kind: "standard" }>["field"];

function cardStandardBindingEntries(card: Card): readonly {
  readonly field: StandardBulkField;
  readonly label: string;
  readonly value: string;
}[] {
  return [
    { field: "badge", label: "배지", value: card.badge ?? "" },
    { field: "title", label: "제목", value: card.title },
    { field: "subtitle", label: "소제목", value: card.subtitle ?? "" },
    { field: "body", label: "본문", value: card.paragraphs.join("\n") },
    { field: "bullets", label: "불릿", value: card.bullets.join("\n") },
    { field: "source", label: "출처", value: card.source ?? "" },
    { field: "emphasis", label: "강조", value: card.emphasis ?? "" }
  ];
}

type ImagePickerTarget =
  | { readonly kind: "badge" }
  | { readonly kind: "nextHint" }
  | { readonly kind: "layer"; readonly layerId: string };

type M22OptionalCardnewsApi = {
  readonly listMediaCatalog?: () => Promise<MediaCatalogResult<readonly MediaCatalogAsset[]>>;
  readonly importMediaAsset?: (kind?: MediaKind) => Promise<MediaCatalogResult<MediaCatalogAsset>>;
  readonly getMediaPreview?: (mediaId: string) => Promise<MediaCatalogResult<string>>;
  readonly exportVideoMp4?: (input: { readonly workspace: WorkspaceState }) => Promise<Mp4ExportApiResult>;
  readonly cancelVideoExport?: (jobId: string) => Promise<Mp4ExportError | { readonly ok: true; readonly jobId: string }>;
  readonly onVideoExportProgress?: (handler: (progress: Mp4ExportProgress) => void) => () => void;
};

type ParsedCardEntry = {
  readonly card: Card;
  readonly error: CardnewsError | undefined;
};

type LayerRect = EditorRect;

type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type TextLayer = Extract<CardLayer, { readonly kind: "text" }>;
type BoxLayer = Exclude<CardLayer, CardLineLayer>;
type LineEndpoint = "start" | "end";

type DragState =
  | {
      readonly kind: "move";
      readonly layerId: string;
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startRect: LayerRect;
      readonly activated: boolean;
    }
  | {
      readonly kind: "line-move";
      readonly layerId: string;
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startLayer: CardLineLayer;
      readonly activated: boolean;
    }
  | {
      readonly kind: "line-endpoint";
      readonly layerId: string;
      readonly endpoint: LineEndpoint;
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startLayer: CardLineLayer;
      readonly activated: boolean;
    }
  | {
      readonly kind: "resize";
      readonly layerId: string;
      readonly handle: ResizeHandle;
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startRect: LayerRect;
      readonly activated: boolean;
    };

type SemanticDragState = {
  readonly kind: "move" | "resize";
  readonly slotId: SemanticItemId;
  readonly handle?: ResizeHandle;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startRect: LayerRect;
  readonly anchor: SemanticSlotPlacement["anchor"];
  readonly activated: boolean;
};

const dragActivationThresholdPx = 4;

function hasExceededDragActivationThreshold(
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number
): boolean {
  return Math.hypot(clientX - startClientX, clientY - startClientY) >= dragActivationThresholdPx;
}

const resizeHandles: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const cardTypeOptions: readonly { readonly value: CardType; readonly label: string }[] = [
  { value: "cover", label: "표지" },
  { value: "body", label: "본문" },
  { value: "cta", label: "마무리" }
];

function createUiId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseHexColorInput(value: string): string | undefined {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : undefined;
}

function layerRect(layer: CardLayer): LayerRect {
  if (layer.kind === "line") {
    const left = Math.min(layer.x1, layer.x2);
    const top = Math.min(layer.y1, layer.y2);
    return {
      x: left,
      y: top,
      width: Math.max(1, Math.abs(layer.x2 - layer.x1)),
      height: Math.max(1, Math.abs(layer.y2 - layer.y1))
    };
  }

  return {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height
  };
}

function roundLayerValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampControlNumber(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, finite));
}

function clampIntegerControl(value: number, min: number, max: number): number {
  return Math.round(clampControlNumber(value, min, max));
}

function clampLayerFontWeight(value: number): number {
  return Math.round(clampControlNumber(value, 100, 950) / 50) * 50;
}

function clampLayerRotation(value: number): number {
  const rotation = Math.round(clampControlNumber(value, -180, 180));
  return Object.is(rotation, -0) ? 0 : rotation;
}

function roundLineLayer(layer: CardLineLayer): CardLineLayer {
  return normalizeLineLayer({
    ...layer,
    x1: roundLayerValue(layer.x1),
    y1: roundLayerValue(layer.y1),
    x2: roundLayerValue(layer.x2),
    y2: roundLayerValue(layer.y2)
  });
}

function clampLayerRect(rect: LayerRect): LayerRect {
  const width = Math.min(100, Math.max(1, rect.width));
  const height = Math.min(100, Math.max(1, rect.height));
  const x = Math.min(100 - width, Math.max(0, rect.x));
  const y = Math.min(100 - height, Math.max(0, rect.y));
  return {
    x: roundLayerValue(x),
    y: roundLayerValue(y),
    width: roundLayerValue(width),
    height: roundLayerValue(height)
  };
}

function snapValue(value: number, gridPercent: number): number {
  return Math.round(value / gridPercent) * gridPercent;
}

function snapLayerRect(rect: LayerRect, cardWidth: number, cardHeight: number): LayerRect {
  return clampLayerRect({
    x: snapValue(rect.x, (8 / cardWidth) * 100),
    y: snapValue(rect.y, (8 / cardHeight) * 100),
    width: snapValue(rect.width, (8 / cardWidth) * 100),
    height: snapValue(rect.height, (8 / cardHeight) * 100)
  });
}

function transformMoveRect(startRect: LayerRect, deltaXPercent: number, deltaYPercent: number): LayerRect {
  return clampLayerRect({
    ...startRect,
    x: startRect.x + deltaXPercent,
    y: startRect.y + deltaYPercent
  });
}

function transformResizeRect(
  startRect: LayerRect,
  handle: ResizeHandle,
  deltaXPercent: number,
  deltaYPercent: number
): LayerRect {
  let { x, y, width, height } = startRect;
  const touchesWest = handle.includes("w");
  const touchesEast = handle.includes("e");
  const touchesNorth = handle.includes("n");
  const touchesSouth = handle.includes("s");

  if (touchesWest) {
    x += deltaXPercent;
    width -= deltaXPercent;
  }
  if (touchesEast) {
    width += deltaXPercent;
  }
  if (touchesNorth) {
    y += deltaYPercent;
    height -= deltaYPercent;
  }
  if (touchesSouth) {
    height += deltaYPercent;
  }

  if (width < 1 && touchesWest) {
    x -= 1 - width;
  }
  if (height < 1 && touchesNorth) {
    y -= 1 - height;
  }

  return clampLayerRect({ x, y, width, height });
}

function layerLabel(layer: CardLayer): string {
  if (layer.kind === "text") {
    return layer.text.trim() || "텍스트 입력";
  }
  if (layer.kind === "shape") {
    return layer.shape === "ellipse" ? "타원" : "모형";
  }
  if (layer.kind === "line") {
    return "선";
  }
  return layer.kind === "video" ? "영상" : "이미지";
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function isMediaCatalogError<T>(result: MediaCatalogResult<T>): result is MediaCatalogError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function isMp4ExportError(result: Mp4ExportApiResult): result is Mp4ExportError {
  return result.ok === false;
}

function mediaCatalogAssetToRef(asset: MediaCatalogAsset): MediaAssetRef {
  return {
    id: asset.id,
    kind: asset.kind,
    displayName: asset.displayName,
    relativePath: asset.relativePath,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
    sha256: asset.sha256,
    width: asset.width,
    height: asset.height,
    ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    ...(asset.hasAudio !== undefined ? { hasAudio: asset.hasAudio } : {}),
    ...(asset.posterRelativePath ? { posterRelativePath: asset.posterRelativePath } : {})
  };
}

function parseEditorCardType(value: string): CardType {
  if (value === "cover" || value === "body" || value === "cta") {
    return value;
  }

  return "body";
}

function parseTypographyScope(value: string): "all" | "title" | "body" {
  if (value === "title" || value === "body" || value === "all") {
    return value;
  }

  return "all";
}

function parseBadgeShape(value: string): "pill" | "rect" | "none" {
  if (value === "pill" || value === "rect" || value === "none") {
    return value;
  }

  return "pill";
}

function parseNextHintKind(value: string): NextHintConfig["kind"] {
  if (value === "image" || value === "none" || value === "arrows") {
    return value;
  }

  return "arrows";
}

function normalizeNextHintForUi(nextHint: NextHintConfig | undefined): NextHintConfig {
  if (!nextHint || nextHint.kind === "arrows") {
    return { kind: "arrows" };
  }

  if (nextHint.kind === "none") {
    return { kind: "none" };
  }

  const imageId = nextHint.imageId?.trim();
  return {
    kind: "image",
    ...(imageId ? { imageId } : {}),
    height: clampIntegerControl(nextHint.height ?? 40, 24, 72)
  };
}

function setOptionalCardField(
  card: Card,
  field: "badge" | "subtitle" | "source" | "emphasis",
  value: string
): Card {
  const cleaned = value.trim();

  switch (field) {
    case "badge": {
      const { badge: _badge, ...rest } = card;
      return cleaned ? { ...rest, badge: value } : rest;
    }
    case "subtitle": {
      const { subtitle: _subtitle, ...rest } = card;
      return cleaned ? { ...rest, subtitle: value } : rest;
    }
    case "source": {
      const { source: _source, ...rest } = card;
      return cleaned ? { ...rest, source: value } : rest;
    }
    case "emphasis": {
      const { emphasis: _emphasis, ...rest } = card;
      return cleaned ? { ...rest, emphasis: value } : rest;
    }
  }
}

const initialCards = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  if (number === 1) {
    return "유형: 표지\n배지: MONEY NOTE\n제목: 돈 이야기를 *다시* 배워야 하는 이유\n소제목: 숫자보다 먼저 보는 관점";
  }

  if (number === 10) {
    return "유형: 마무리\n제목: 오늘의 질문\n본문: - 지금 내 소비에서 반복되는 감정은?\n- 다음 카드뉴스 주제로 남길 것은?\n강조: 저장하고 다시 보기";
  }

  return `유형: 본문\n제목: 카드 ${number}의 *핵심* 문장\n본문: 첫 번째 문단을 여기에 씁니다.\n- 자동 불릿 예시\n- 두 번째 불릿 예시\n출처: 내부 메모`;
});

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function PreviewCanvas({
  html,
  cardWidth,
  cardHeight
}: {
  readonly html: string;
  readonly cardWidth: number;
  readonly cardHeight: number;
}): ReactElement {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) {
        setScale(width / cardWidth);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [cardWidth]);

  return (
    <div
      className="stage-canvas"
      ref={canvasRef}
      style={{
        aspectRatio: `${cardWidth} / ${cardHeight}`,
        height: `min(calc(100vh - 170px), calc((100vw - 560px) * ${(cardHeight / cardWidth).toFixed(4)}))`
      }}
    >
      <iframe
        title="selected-card"
        sandbox="allow-same-origin"
        srcDoc={html}
        scrolling="no"
        style={{
          width: cardWidth,
          height: cardHeight,
          transform: `scale(${scale})`
        }}
      />
    </div>
  );
}

function StageCanvas({
  html,
  cardWidth,
  cardHeight,
  editMode,
  layers,
  selectedLayerId,
  semanticSlots,
  selectedSemanticSlotId,
  editingLayerId,
  editingSemanticSlotId,
  editingText,
  editingSemanticText,
  playheadMs,
  sceneStartMs,
  onSelectLayer,
  onSelectSemanticSlot,
  onTransformLayer,
  onTransformLineLayer,
  onTransformSemanticSlot,
  onNudgeLayer,
  onDeleteLayer,
  onDeleteSemanticSlot,
  onClipboardCommand,
  onStartTextEdit,
  onStartSemanticTextEdit,
  onEditingTextChange,
  onEditingSemanticTextChange,
  onCommitTextEdit,
  onCommitSemanticTextEdit,
  onCancelTextEdit,
  onCancelSemanticTextEdit
}: {
  readonly html: string;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly editMode: boolean;
  readonly layers: readonly CardLayer[];
  readonly selectedLayerId: string | null;
  readonly semanticSlots: readonly {
    readonly id: SemanticItemId;
    readonly label: string;
    readonly text: string;
    readonly placement: SemanticSlotPlacement;
  }[];
  readonly selectedSemanticSlotId: SemanticItemId | null;
  readonly editingLayerId: string | null;
  readonly editingSemanticSlotId: SemanticItemId | null;
  readonly editingText: string;
  readonly editingSemanticText: string;
  readonly playheadMs: number;
  readonly sceneStartMs: number;
  readonly onSelectLayer: (layerId: string | null) => void;
  readonly onSelectSemanticSlot: (slotId: SemanticItemId | null) => void;
  readonly onTransformLayer: (layerId: string, rect: LayerRect) => void;
  readonly onTransformLineLayer: (layerId: string, layer: CardLineLayer) => void;
  readonly onTransformSemanticSlot: (slotId: SemanticItemId, placement: SemanticSlotPlacement) => void;
  readonly onNudgeLayer: (layerId: string, deltaXPercent: number, deltaYPercent: number) => void;
  readonly onDeleteLayer: (layerId: string) => void;
  readonly onDeleteSemanticSlot: (slotId: SemanticItemId) => void;
  readonly onClipboardCommand: (command: LayerClipboardCommand) => void;
  readonly onStartTextEdit: (layer: CardLayer) => void;
  readonly onStartSemanticTextEdit: (slotId: SemanticItemId, text: string) => void;
  readonly onEditingTextChange: (value: string) => void;
  readonly onEditingSemanticTextChange: (value: string) => void;
  readonly onCommitTextEdit: () => void;
  readonly onCommitSemanticTextEdit: () => void;
  readonly onCancelTextEdit: () => void;
  readonly onCancelSemanticTextEdit: () => void;
}): ReactElement {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const semanticDragRef = useRef<SemanticDragState | null>(null);
  const draftRectRef = useRef<{ readonly layerId: string; readonly rect: LayerRect } | null>(null);
  const draftSemanticRef = useRef<{ readonly slotId: SemanticItemId; readonly rect: LayerRect; readonly anchor: SemanticSlotPlacement["anchor"] } | null>(null);
  const draftLineRef = useRef<{ readonly layerId: string; readonly layer: CardLineLayer } | null>(null);
  const transientPreviewRef = useRef<{
    readonly element: HTMLElement;
    readonly translate: string;
    readonly scale: string;
    readonly transformOrigin: string;
  } | null>(null);
  const [scale, setScale] = useState(0.4);
  const [draftRect, setDraftRect] = useState<{ readonly layerId: string; readonly rect: LayerRect } | null>(null);
  const [draftSemantic, setDraftSemanticState] = useState<{
    readonly slotId: SemanticItemId;
    readonly rect: LayerRect;
    readonly anchor: SemanticSlotPlacement["anchor"];
  } | null>(null);
  const [measuredSemanticRects, setMeasuredSemanticRects] = useState<Readonly<Record<string, LayerRect>>>({});
  const [measuredLayerRects, setMeasuredLayerRects] = useState<Readonly<Record<string, LayerRect>>>({});
  const [draftLine, setDraftLineState] = useState<{ readonly layerId: string; readonly layer: CardLineLayer } | null>(
    null
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  const editingLayer = layers.find((layer): layer is TextLayer => layer.id === editingLayerId && layer.kind === "text");
  const selectedSemanticSlot = semanticSlots.find((slot) => slot.id === selectedSemanticSlotId);
  const editingSemanticSlot = semanticSlots.find((slot) => slot.id === editingSemanticSlotId);

  function findEditingForeground(): HTMLElement | null {
    if (!editingLayerId) return null;
    return (
      Array.from(iframeRef.current?.contentDocument?.querySelectorAll<HTMLElement>("[data-layer-text]") ?? []).find(
        (element) => element.dataset["layerText"] === editingLayerId
      ) ?? null
    );
  }

  function findEditingSemanticForeground(): HTMLElement | null {
    if (!editingSemanticSlotId) return null;
    return (
      Array.from(
        iframeRef.current?.contentDocument?.querySelectorAll<HTMLElement>(
          "[data-semantic-item-id], [data-slot]"
        ) ?? []
      ).find(
        (element) =>
          element.dataset["semanticItemId"] === editingSemanticSlotId ||
          element.dataset["slot"] === editingSemanticSlotId
      ) ?? null
    );
  }

  function findRenderedLayer(layerId: string): HTMLElement | null {
    return (
      Array.from(
        iframeRef.current?.contentDocument?.querySelectorAll<HTMLElement>("[data-editor-layer-id]") ?? []
      ).find((element) => element.dataset["editorLayerId"] === layerId) ?? null
    );
  }

  function findRenderedSemanticItem(slotId: SemanticItemId): HTMLElement | null {
    return (
      Array.from(
        iframeRef.current?.contentDocument?.querySelectorAll<HTMLElement>(
          "[data-semantic-item-id], [data-slot]"
        ) ?? []
      ).find(
        (element) =>
          element.dataset["semanticItemId"] === slotId ||
          element.dataset["slot"] === slotId
      ) ?? null
    );
  }

  function beginTransientPreview(element: HTMLElement | null): void {
    const previous = transientPreviewRef.current;
    if (previous?.element.isConnected) {
      previous.element.style.translate = previous.translate;
      previous.element.style.scale = previous.scale;
      previous.element.style.transformOrigin = previous.transformOrigin;
    }
    transientPreviewRef.current = element
      ? {
          element,
          translate: element.style.translate,
          scale: element.style.scale,
          transformOrigin: element.style.transformOrigin
        }
      : null;
  }

  function applyTransientPreview(startRect: LayerRect, nextRect: LayerRect): void {
    const preview = transientPreviewRef.current;
    if (!preview?.element.isConnected || startRect.width <= 0 || startRect.height <= 0) return;
    preview.element.style.transformOrigin = "top left";
    preview.element.style.translate = `${((nextRect.x - startRect.x) / 100) * cardWidth}px ${((nextRect.y - startRect.y) / 100) * cardHeight}px`;
    preview.element.style.scale = `${nextRect.width / startRect.width} ${nextRect.height / startRect.height}`;
  }

  function commitMeasuredRects(document: Document): void {
    const card = document.querySelector<HTMLElement>(".card");
    if (!card) return;
    const cardRect = card.getBoundingClientRect();
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-semantic-item-id], [data-slot]")
    );
    const nextSemantic: Record<string, LayerRect> = {};
    for (const slot of semanticSlots) {
      const element = elements.find(
        (candidate) =>
          candidate.dataset["semanticItemId"] === slot.id ||
          candidate.dataset["slot"] === slot.id
      );
      if (!element) continue;
      const rect = domRectToEditorRect(element.getBoundingClientRect(), cardRect);
      if (!rect) continue;
      nextSemantic[slot.id] = {
        x: roundLayerValue(rect.x),
        y: roundLayerValue(rect.y),
        width: roundLayerValue(rect.width),
        height: roundLayerValue(rect.height)
      };
    }
    const nextLayers: Record<string, LayerRect> = {};
    for (const layer of layers) {
      if (layer.kind === "line") continue;
      const element = findRenderedLayer(layer.id);
      if (!element) continue;
      const rect = domRectToEditorRect(element.getBoundingClientRect(), cardRect);
      if (!rect) continue;
      nextLayers[layer.id] = {
        x: roundLayerValue(rect.x),
        y: roundLayerValue(rect.y),
        width: roundLayerValue(rect.width),
        height: roundLayerValue(rect.height)
      };
    }
    setMeasuredSemanticRects(nextSemantic);
    setMeasuredLayerRects(nextLayers);
  }

  async function measureRenderedRects(): Promise<void> {
    const document = iframeRef.current?.contentDocument;
    if (!document) return;
    syncSemanticItemPlacements(document);
    commitMeasuredRects(document);
    await Promise.all(
      Array.from(document.querySelectorAll<HTMLVideoElement>("video")).map(
        (video) =>
          new Promise<void>((resolve) => {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              resolve();
              return;
            }
            const done = (): void => resolve();
            video.addEventListener("loadeddata", done, { once: true });
            video.addEventListener("error", done, { once: true });
            window.setTimeout(done, 2000);
          })
      )
    );
    await prepareSemanticItemPlacements(document);
    if (iframeRef.current?.contentDocument !== document) return;
    commitMeasuredRects(document);
  }

  useEffect(() => {
    const foreground = findEditingForeground();
    if (!foreground) return;
    const previousVisibility = foreground.style.visibility;
    foreground.style.visibility = "hidden";
    return () => {
      foreground.style.visibility = previousVisibility;
    };
  }, [editingLayerId, html]);

  useEffect(() => {
    const foreground = findEditingSemanticForeground();
    if (!foreground) return;
    const previousVisibility = foreground.style.visibility;
    foreground.style.visibility = "hidden";
    return () => {
      foreground.style.visibility = previousVisibility;
    };
  }, [editingSemanticSlotId, html]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) {
        setScale(width / cardWidth);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [cardWidth]);

  useEffect(() => {
    const document = iframeRef.current?.contentDocument;
    if (!document) return;
    const localSeconds = Math.max(0, (playheadMs - sceneStartMs) / 1000);
    for (const video of document.querySelectorAll<HTMLVideoElement>("video.live-card-video")) {
      const clipStartSeconds = Math.max(0, Number(video.dataset["clipStartMs"] || "0") / 1000);
      const clipEndRaw = Number(video.dataset["clipEndMs"] || "");
      const seek = (): void => {
        const clipEndSeconds = Number.isFinite(clipEndRaw) && clipEndRaw > 0 ? clipEndRaw / 1000 : video.duration;
        const finalFrame = Number.isFinite(clipEndSeconds)
          ? Math.max(clipStartSeconds, clipEndSeconds - 1 / 30)
          : clipStartSeconds + localSeconds;
        video.currentTime = Math.max(clipStartSeconds, Math.min(clipStartSeconds + localSeconds, finalFrame));
        video.pause();
      };
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
      else video.addEventListener("loadedmetadata", seek, { once: true });
    }
  }, [html, playheadMs, sceneStartMs]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void measureRenderedRects();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [html, layers, semanticSlots]);

  function rectFor(layer: CardLayer): LayerRect {
    if (draftRect?.layerId === layer.id) return draftRect.rect;
    return measuredLayerRects[layer.id] ?? layerRect(layer);
  }

  function semanticRectFor(
    slot: { readonly id: SemanticItemId; readonly placement: SemanticSlotPlacement }
  ): LayerRect | undefined {
    if (draftSemantic?.slotId === slot.id) return draftSemantic.rect;
    const measuredRect = measuredSemanticRects[slot.id];
    if (measuredRect) return measuredRect;
    return slot.placement.mode === "card" ? semanticSlotPlacementToRect(slot.placement) : undefined;
  }

  function lineFor(layer: CardLineLayer): CardLineLayer {
    return draftLine?.layerId === layer.id ? draftLine.layer : layer;
  }

  function layerStyle(rect: LayerRect): CSSProperties {
    return {
      left: `${rect.x}%`,
      top: `${rect.y}%`,
      width: `${rect.width}%`,
      height: `${rect.height}%`
    };
  }

  function lineBodyStyle(layer: CardLineLayer): CSSProperties {
    const geometry = getLineLayerRenderGeometry(layer, { width: cardWidth, height: cardHeight });
    return {
      left: `${layer.x1}%`,
      top: `${layer.y1}%`,
      width: `${(geometry.widthPx / cardWidth) * 100}%`,
      height: `${Math.max(12, layer.thickness * scale + 8)}px`,
      transform: `translateY(-50%) rotate(${geometry.angleDeg}deg)`,
      transformOrigin: "0 50%"
    };
  }

  function lineEndpointStyle(layer: CardLineLayer, endpoint: LineEndpoint): CSSProperties {
    return {
      left: `${endpoint === "start" ? layer.x1 : layer.x2}%`,
      top: `${endpoint === "start" ? layer.y1 : layer.y2}%`
    };
  }

  function setDraft(nextDraft: { readonly layerId: string; readonly rect: LayerRect } | null): void {
    draftRectRef.current = nextDraft;
    setDraftRect(nextDraft);
  }

  function setDraftSemantic(
    nextDraft: {
      readonly slotId: SemanticItemId;
      readonly rect: LayerRect;
      readonly anchor: SemanticSlotPlacement["anchor"];
    } | null
  ): void {
    draftSemanticRef.current = nextDraft;
    setDraftSemanticState(nextDraft);
  }

  function setDraftLine(nextDraft: { readonly layerId: string; readonly layer: CardLineLayer } | null): void {
    draftLineRef.current = nextDraft;
    setDraftLineState(nextDraft);
  }

  function beginMove(event: ReactPointerEvent<HTMLElement>, layer: BoxLayer): void {
    if (!editMode) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(layer.id);
    onSelectSemanticSlot(null);
    const rect = rectFor(layer);
    beginTransientPreview(findRenderedLayer(layer.id));
    dragRef.current = {
      kind: "move",
      layerId: layer.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
      activated: false
    };
  }

  function beginSemanticMove(
    event: ReactPointerEvent<HTMLElement>,
    slot: { readonly id: SemanticItemId; readonly placement: SemanticSlotPlacement }
  ): void {
    if (!editMode) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(null);
    onSelectSemanticSlot(slot.id);
    const rect = semanticRectFor(slot);
    if (!rect) return;
    const anchor = slot.placement.anchor;
    beginTransientPreview(findRenderedSemanticItem(slot.id));
    semanticDragRef.current = {
      kind: "move",
      slotId: slot.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
      anchor,
      activated: false
    };
  }

  function beginSemanticResize(
    event: ReactPointerEvent<HTMLElement>,
    slot: { readonly id: SemanticItemId; readonly placement: SemanticSlotPlacement },
    handle: ResizeHandle
  ): void {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(null);
    onSelectSemanticSlot(slot.id);
    const rect = semanticRectFor(slot);
    if (!rect) return;
    const anchor = slot.placement.anchor;
    beginTransientPreview(findRenderedSemanticItem(slot.id));
    semanticDragRef.current = {
      kind: "resize",
      slotId: slot.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
      anchor,
      activated: false
    };
  }

  function beginResize(event: ReactPointerEvent<HTMLElement>, layer: CardLayer, handle: ResizeHandle): void {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(layer.id);
    onSelectSemanticSlot(null);
    const rect = rectFor(layer);
    beginTransientPreview(findRenderedLayer(layer.id));
    dragRef.current = {
      kind: "resize",
      layerId: layer.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect,
      activated: false
    };
  }

  function beginLineMove(event: ReactPointerEvent<HTMLElement>, layer: CardLineLayer): void {
    if (!editMode) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(layer.id);
    onSelectSemanticSlot(null);
    const currentLayer = lineFor(layer);
    dragRef.current = {
      kind: "line-move",
      layerId: layer.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayer: currentLayer,
      activated: false
    };
  }

  function beginLineEndpoint(
    event: ReactPointerEvent<HTMLElement>,
    layer: CardLineLayer,
    endpoint: LineEndpoint
  ): void {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(layer.id);
    onSelectSemanticSlot(null);
    const currentLayer = lineFor(layer);
    dragRef.current = {
      kind: "line-endpoint",
      layerId: layer.id,
      endpoint,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayer: currentLayer,
      activated: false
    };
  }

  function updateDraft(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    const semanticDrag = semanticDragRef.current;
    const cardViewportRect = iframeRef.current?.getBoundingClientRect();
    if (!cardViewportRect) {
      return;
    }
    if (semanticDrag) {
      const wasActivated = semanticDrag.activated;
      if (
        !wasActivated &&
        !hasExceededDragActivationThreshold(
          semanticDrag.startClientX,
          semanticDrag.startClientY,
          event.clientX,
          event.clientY
        )
      ) {
        return;
      }
      if (!wasActivated) {
        semanticDragRef.current = { ...semanticDrag, activated: true };
      }
      const delta = clientDeltaToEditorPercent(
        semanticDrag.startClientX,
        semanticDrag.startClientY,
        event.clientX,
        event.clientY,
        cardViewportRect
      );
      if (!delta) return;
      const nextRect =
        semanticDrag.kind === "resize" && semanticDrag.handle
          ? transformResizeRect(semanticDrag.startRect, semanticDrag.handle, delta.x, delta.y)
          : transformMoveRect(semanticDrag.startRect, delta.x, delta.y);
      const previewRect = event.shiftKey || !wasActivated ? nextRect : snapLayerRect(nextRect, cardWidth, cardHeight);
      applyTransientPreview(semanticDrag.startRect, previewRect);
      setDraftSemantic({
        slotId: semanticDrag.slotId,
        rect: previewRect,
        anchor: semanticDrag.anchor
      });
      return;
    }
    if (!drag) {
      return;
    }
    const wasActivated = drag.activated;
    if (
      !wasActivated &&
      !hasExceededDragActivationThreshold(
        drag.startClientX,
        drag.startClientY,
        event.clientX,
        event.clientY
      )
    ) {
      return;
    }
    if (!wasActivated) {
      dragRef.current = { ...drag, activated: true };
    }
    if (drag.kind === "line-endpoint") {
      const pointer = clientPointToEditorPercent(event.clientX, event.clientY, cardViewportRect);
      if (!pointer) return;
      setDraftLine({
        layerId: drag.layerId,
        layer: setLineLayerEndpoint(
          drag.startLayer,
          drag.endpoint,
          pointer.x,
          pointer.y,
          event.shiftKey,
          { width: cardWidth, height: cardHeight }
        )
      });
      return;
    }

    const delta = clientDeltaToEditorPercent(
      drag.startClientX,
      drag.startClientY,
      event.clientX,
      event.clientY,
      cardViewportRect
    );
    if (!delta) return;
    if (drag.kind === "line-move") {
      setDraftLine({
        layerId: drag.layerId,
        layer: translateLineLayer(drag.startLayer, delta.x, delta.y)
      });
      return;
    }

    const nextRect =
      drag.kind === "move"
        ? transformMoveRect(drag.startRect, delta.x, delta.y)
        : transformResizeRect(drag.startRect, drag.handle, delta.x, delta.y);
    const previewRect = event.shiftKey || !wasActivated ? nextRect : snapLayerRect(nextRect, cardWidth, cardHeight);
    applyTransientPreview(drag.startRect, previewRect);
    setDraft({
      layerId: drag.layerId,
      rect: previewRect
    });
  }

  function finishDraft(): void {
    const draft = draftRectRef.current;
    if (draft) {
      onTransformLayer(draft.layerId, draft.rect);
    }
    const lineDraft = draftLineRef.current;
    if (lineDraft) {
      onTransformLineLayer(lineDraft.layerId, lineDraft.layer);
    }
    const semanticDraft = draftSemanticRef.current;
    if (semanticDraft) {
      onTransformSemanticSlot(
        semanticDraft.slotId,
        rectToSemanticSlotPlacement(semanticDraft.rect, semanticDraft.anchor)
      );
    }
    dragRef.current = null;
    semanticDragRef.current = null;
    transientPreviewRef.current = null;
    setDraft(null);
    setDraftSemantic(null);
    setDraftLine(null);
  }

  function nudgeSelectedSemantic(deltaXPercent: number, deltaYPercent: number): void {
    if (!selectedSemanticSlot) return;
    const rect = semanticRectFor(selectedSemanticSlot);
    if (!rect) return;
    onTransformSemanticSlot(
      selectedSemanticSlot.id,
      rectToSemanticSlotPlacement(
        clampLayerRect({
          ...rect,
          x: rect.x + deltaXPercent,
          y: rect.y + deltaYPercent
        }),
        selectedSemanticSlot.placement.anchor
      )
    );
  }

  function handleOverlayKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!editMode || editingLayerId || editingSemanticSlotId) {
      return;
    }
    const clipboardCommand = resolveLayerClipboardCommand(
      {
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
        target: event.target
      },
      { editMode, inlineEditActive: Boolean(editingLayerId), isComposing: event.nativeEvent.isComposing }
    );
    if (clipboardCommand) {
      event.preventDefault();
      onClipboardCommand(clipboardCommand);
      return;
    }
    if (!selectedLayer && !selectedSemanticSlot) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (selectedSemanticSlot) {
        onDeleteSemanticSlot(selectedSemanticSlot.id);
        return;
      }
      if (selectedLayer) onDeleteLayer(selectedLayer.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectLayer(null);
      onSelectSemanticSlot(null);
      return;
    }
    if (event.key === "Enter" && selectedSemanticSlot) {
      event.preventDefault();
      onStartSemanticTextEdit(selectedSemanticSlot.id, selectedSemanticSlot.text);
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    const horizontal = (step / cardWidth) * 100;
    const vertical = (step / cardHeight) * 100;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (selectedLayer) onNudgeLayer(selectedLayer.id, -horizontal, 0);
      nudgeSelectedSemantic(-horizontal, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (selectedLayer) onNudgeLayer(selectedLayer.id, horizontal, 0);
      nudgeSelectedSemantic(horizontal, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (selectedLayer) onNudgeLayer(selectedLayer.id, 0, -vertical);
      nudgeSelectedSemantic(0, -vertical);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (selectedLayer) onNudgeLayer(selectedLayer.id, 0, vertical);
      nudgeSelectedSemantic(0, vertical);
    }
  }

  const editingSemanticRect = editingSemanticSlot ? semanticRectFor(editingSemanticSlot) : undefined;

  return (
    <div
      className="stage-canvas"
      ref={canvasRef}
      style={{
        aspectRatio: `${cardWidth} / ${cardHeight}`,
        height: `min(calc(100vh - 170px), calc((100vw - 560px) * ${(cardHeight / cardWidth).toFixed(4)}))`
      }}
    >
      <iframe
        ref={iframeRef}
        title="selected-card"
        sandbox="allow-same-origin"
        srcDoc={html}
        scrolling="no"
        onLoad={() => {
          transientPreviewRef.current = null;
          const foreground = findEditingForeground();
          if (foreground) foreground.style.visibility = "hidden";
          const semanticForeground = findEditingSemanticForeground();
          if (semanticForeground) semanticForeground.style.visibility = "hidden";
          void measureRenderedRects();
        }}
        style={{
          width: cardWidth,
          height: cardHeight,
          pointerEvents: editMode ? "none" : "auto",
          transform: `scale(${scale})`
        }}
      />
      {editMode ? (
        <div
          className="edit-overlay"
          ref={overlayRef}
          tabIndex={0}
          data-semantic-slot-count={semanticSlots.length}
          data-measured-semantic-count={Object.keys(measuredSemanticRects).length}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              onSelectLayer(null);
              onSelectSemanticSlot(null);
            }
          }}
          onPointerMove={updateDraft}
          onPointerUp={finishDraft}
          onPointerCancel={finishDraft}
          onKeyDown={handleOverlayKeyDown}
        >
          <div className="edit-guide center-x" />
          <div className="edit-guide center-y" />
          <div className="edit-safe-zone" />
          {layers.map((layer) => {
            if (layer.kind === "line") {
              const currentLine = lineFor(layer);
              const selected = layer.id === selectedLayerId;
              return (
                <div key={layer.id} className="edit-line-layer" data-layer-id={layer.id}>
                  <div
                    className={`edit-line-hit${selected ? " selected" : ""}`}
                    data-smoke-role="line-body"
                    data-layer-id={layer.id}
                    aria-label={layerLabel(layer)}
                    style={lineBodyStyle(currentLine)}
                    onPointerDown={(event) => beginLineMove(event, layer)}
                  >
                    <span className="edit-line-stroke" />
                  </div>
                  {selected
                    ? (["start", "end"] as const).map((endpoint) => (
                        <span
                          key={endpoint}
                          className={`line-endpoint-handle ${endpoint}`}
                          data-smoke-role={`line-endpoint-${endpoint}`}
                          style={lineEndpointStyle(currentLine, endpoint)}
                          onPointerDown={(event) => beginLineEndpoint(event, layer, endpoint)}
                        />
                      ))
                    : null}
                </div>
              );
            }

            const rect = rectFor(layer);
            const selected = layer.id === selectedLayerId;
            const editing = layer.id === editingLayerId;
            return (
              <div
                key={layer.id}
                className={`edit-layer-box edit-layer-${layer.kind}${selected ? " selected" : ""}${editing ? " editing" : ""}`}
                data-smoke-role="layer-box"
                data-layer-id={layer.id}
                aria-label={layerLabel(layer)}
                style={layerStyle(rect)}
                onPointerDown={(event) => beginMove(event, layer)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (layer.kind === "text") {
                    onStartTextEdit(layer);
                  }
                }}
              >
                {layer.kind === "text" ? null : <span className="edit-layer-label">{layerLabel(layer)}</span>}
                {selected
                  ? resizeHandles.map((handle) => (
                      <span
                        key={handle}
                        className={`resize-handle ${handle}`}
                        onPointerDown={(event) => beginResize(event, layer, handle)}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {semanticSlots.map((slot) => {
            const rect = semanticRectFor(slot);
            if (!rect) return null;
            const selected = slot.id === selectedSemanticSlotId;
            const editing = slot.id === editingSemanticSlotId;
            return (
              <div
                key={`semantic-${slot.id}`}
                className={`edit-semantic-box semantic-${slot.id}${selected ? " selected" : ""}${editing ? " editing" : ""}`}
                data-smoke-role="semantic-slot-box"
                data-semantic-slot={slot.id}
                aria-label={`${slot.label} 직접 편집`}
                style={layerStyle(rect)}
                onPointerDown={(event) => beginSemanticMove(event, slot)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onStartSemanticTextEdit(slot.id, slot.text);
                }}
              >
                <span className="edit-layer-label">{slot.label}</span>
                {selected
                  ? resizeHandles.map((handle) => (
                      <span
                        key={handle}
                        className={`resize-handle ${handle}`}
                        data-smoke-role={`semantic-resize-${handle}`}
                        onPointerDown={(event) => beginSemanticResize(event, slot, handle)}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {editingLayer ? (
            <textarea
              className="layer-inline-textarea"
              value={editingText}
              style={{
                ...layerStyle(rectFor(editingLayer)),
                color: editingLayer.color ?? "inherit",
                background: editingLayer.backgroundColor ?? "transparent",
                fontSize: `${Math.max(10, (editingLayer.fontSize ?? 40) * scale)}px`,
                fontStyle: editingLayer.italic === true ? "italic" : "normal",
                fontWeight: editingLayer.fontWeight ?? 700,
                textAlign: editingLayer.align ?? "left",
                opacity: (editingLayer.textOpacity ?? 100) / 100
              }}
              autoFocus
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onEditingTextChange(event.target.value)}
              onInput={(event) => onEditingTextChange(event.currentTarget.value)}
              onBlur={onCommitTextEdit}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                onEditingTextChange(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composingRef.current) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelTextEdit();
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  onCommitTextEdit();
                }
              }}
            />
          ) : null}
          {editingSemanticSlot && editingSemanticRect ? (
            <textarea
              className="layer-inline-textarea semantic-inline-textarea"
              value={editingSemanticText}
              style={layerStyle(editingSemanticRect)}
              autoFocus
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onEditingSemanticTextChange(event.target.value)}
              onInput={(event) => onEditingSemanticTextChange(event.currentTarget.value)}
              onBlur={onCommitSemanticTextEdit}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                onEditingSemanticTextChange(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composingRef.current) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelSemanticTextEdit();
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  onCommitSemanticTextEdit();
                }
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fallbackCard(index: number, error: CardnewsError): Card {
  return {
    index,
    type: "body",
    title: `카드 ${index} 입력 확인`,
    paragraphs: [error.message],
    bullets: []
  };
}

export function App(): ReactElement {
  const [headerLabel, setHeaderLabel] = useState(defaultHeaderLabel);
  const [footerAccount, setFooterAccount] = useState(defaultFooterAccount);
  const [chromeConfig, setChromeConfig] = useState(defaultChromeConfig);
  const [cards, setCards] = useState<readonly string[]>(initialCards);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [styleId, setStyleId] = useState<string>(defaultStyleId);
  const [aspectRatioId, setAspectRatioId] = useState<string>(defaultAspectRatioId);
  const [fontCss, setFontCss] = useState<string | null>(null);
  const [customAccent, setCustomAccent] = useState<string | null>(null);
  const [accentDraft, setAccentDraft] = useState("");
  const [customDim, setCustomDim] = useState<number | null>(null);
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  const [mediaAssets, setMediaAssets] = useState<readonly MediaAssetRef[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<Readonly<Record<string, string>>>({});
  const [backgroundMedia, setBackgroundMedia] = useState<BackgroundMediaSelection>({ mode: "none" });
  const [sceneDefaults, setSceneDefaults] = useState(defaultCardSceneSettings);
  const [videoProjectMode, setVideoProjectMode] = useState<VideoProjectMode>("cards");
  const [timelinePlayheadMs, setTimelinePlayheadMs] = useState(0);
  const [bodyNumberDefault, setBodyNumberDefault] = useState<BodyNumberDefault>("show");
  const [overrides, setOverrides] = useState<CardOverrideMap>({});
  const overrideHistoryRef = useRef<{ past: CardOverrideMap[]; future: CardOverrideMap[] }>({
    past: [],
    future: []
  });
  const [, setOverrideHistoryVersion] = useState(0);
  const [bulkBindings, setBulkBindings] = useState<BulkBindingMetadata | undefined>(undefined);
  const [backgroundPreviews, setBackgroundPreviews] = useState<Readonly<Record<string, string>>>({});
  const [backgroundLibrary, setBackgroundLibrary] = useState<readonly BackgroundLibraryItem[]>([]);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [backgroundManagerOpen, setBackgroundManagerOpen] = useState(false);
  const [backgroundManagerSelectedId, setBackgroundManagerSelectedId] = useState<string | null>(null);
  const [backgroundManagerSearch, setBackgroundManagerSearch] = useState("");
  const [backgroundManagerBusy, setBackgroundManagerBusy] = useState(false);
  const [imagePreviews, setImagePreviews] = useState<Readonly<Record<string, string>>>({});
  const [imageLibrary, setImageLibrary] = useState<readonly ImageLibraryItem[]>([]);
  const [backgroundRemovalTolerance, setBackgroundRemovalTolerance] = useState(28);
  const [nextHintConfig, setNextHintConfig] = useState<NextHintConfig>({ kind: "arrows" });
  const [fontLibrary, setFontLibrary] = useState<readonly FontLibraryItem[]>([]);
  const [selectedFontId, setSelectedFontId] = useState<string | null>(null);
  const [customStyles, setCustomStyles] = useState<readonly StylePresetRecord[]>([]);
  const [styleJsonInput, setStyleJsonInput] = useState("");
  const [styleWarnings, setStyleWarnings] = useState<readonly string[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [pixabayApiKeyDraft, setPixabayApiKeyDraft] = useState("");
  const [gptsTemplateBuilderUrlDraft, setGptsTemplateBuilderUrlDraft] = useState("");
  const [aiProviders, setAiProviders] = useState<readonly AiProviderStatus[]>([]);
  const [aiProviderId, setAiProviderId] = useState<AiProviderId>("claude");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInstallBusy, setAiInstallBusy] = useState(false);
  const [pendingMediaAsset, setPendingMediaAsset] = useState<MediaAssetRef | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState<ImagePickerTarget | null>(null);
  const [imagePickerSelectedId, setImagePickerSelectedId] = useState<string | null>(null);
  const [imagePickerSearch, setImagePickerSearch] = useState("");
  const [imagePickerBusy, setImagePickerBusy] = useState(false);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState("money background");
  const [stockImages, setStockImages] = useState<readonly StockImage[]>([]);
  const [stockFallbackUrl, setStockFallbackUrl] = useState<string | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedSemanticSlotId, setSelectedSemanticSlotId] = useState<SemanticItemId | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingSemanticSlotId, setEditingSemanticSlotId] = useState<SemanticItemId | null>(null);
  const [editingLayerText, setEditingLayerText] = useState("");
  const [editingSemanticText, setEditingSemanticText] = useState("");
  const [railWidth, setRailWidth] = useState(150);
  const [pageContextMenu, setPageContextMenu] = useState<PageContextMenuState | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("design");
  const [cardEditorTab, setCardEditorTab] = useState<CardEditorTab>("content");
  const [presets, setPresets] = useState<readonly DeckPreset[]>([]);
  const [selectedPresetName, setSelectedPresetName] = useState("");
  const [presetName, setPresetName] = useState("");
  const [status, setStatus] = useState("카드를 입력하면 미리보기가 실시간으로 갱신됩니다.");
  const [renderResult, setRenderResult] = useState<RenderJobResult | null>(null);
  const [bulkCsvText, setBulkCsvText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkRenderResult | null>(null);
  const [approvedJobId, setApprovedJobId] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isVideoExporting, setIsVideoExporting] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState<Mp4ExportProgress | null>(null);
  const [videoExportResult, setVideoExportResult] = useState<Mp4ExportResult | null>(null);
  const [videoExportError, setVideoExportError] = useState<Mp4ExportError | null>(null);
  const [activeVideoExportJobId, setActiveVideoExportJobId] = useState<string | null>(null);
  const [aiDefaultInstructionDraft, setAiDefaultInstructionDraft] = useState("");
  const exportDialogRef = useRef<HTMLDivElement | null>(null);
  const workspaceReady = useRef(false);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const fontBlobUrlRef = useRef<string | null>(null);
  const layerClipboardRef = useRef<LayerClipboardState>(createLayerClipboardState());
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const preset = resolveStylePreset(styleId, customStyles);
  const accentColor = customAccent ?? preset.accentDefault;
  const backgroundDim = customDim ?? preset.defaultDim;
  const cardRatio = findAspectRatio(aspectRatioId);
  const allStyleEntries = useMemo(
    () => [
      ...stylePresets.map((style) => ({ id: style.id, name: style.name, group: "기본" })),
      ...customStyles.map((style) => ({ id: style.id, name: style.name, group: "내 스타일" }))
    ],
    [customStyles]
  );
  const styleNameEntries = useMemo(
    () => allStyleEntries.map((style) => ({ id: style.id, name: style.name })),
    [allStyleEntries]
  );
  const selectedAiProvider = useMemo(
    () => aiProviders.find((provider) => provider.id === aiProviderId),
    [aiProviderId, aiProviders]
  );
  const {
    busy: aiBusy,
    input: aiInput,
    inputRef: aiInputRef,
    reset: resetAiThread,
    retry: retryAiMessage,
    runNextAction: handleAiNextAction,
    runPreset: runAiPreset,
    send: sendAiMessage,
    setDraftText: setAiDraftText,
    setInput: setAiInput,
    setStatus: setAiStatus,
    status: aiStatus,
    thread: aiThread
  } = useAiAssistant({
    ...(settings.aiDefaultInstruction?.trim() ? { defaultInstruction: settings.aiDefaultInstruction.trim() } : {}),
    providerId: aiProviderId,
    providerLabel: selectedAiProvider?.label ?? aiProviderId,
    setGlobalStatus: setStatus,
    styleNames: styleNameEntries
  });
  const threadsHandle = normalizeThreadsHandle(footerAccount) || normalizeThreadsHandle(defaultFooterAccount);
  const threadsDisplay = `@${threadsHandle}`;
  const threadsUrl = createThreadsProfileUrl(footerAccount);
  const backgroundManagerSelectedItem = useMemo(
    () => backgroundLibrary.find((item) => item.id === backgroundManagerSelectedId),
    [backgroundLibrary, backgroundManagerSelectedId]
  );
  const filteredBackgroundLibrary = useMemo(() => {
    const query = backgroundManagerSearch.trim().toLowerCase();
    if (!query) {
      return backgroundLibrary;
    }

    return backgroundLibrary.filter(
      (item) => item.displayName.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
    );
  }, [backgroundLibrary, backgroundManagerSearch]);
  const imagePickerSelectedItem = useMemo(
    () => imageLibrary.find((item) => item.id === imagePickerSelectedId),
    [imageLibrary, imagePickerSelectedId]
  );
  const filteredImageLibrary = useMemo(() => {
    const query = imagePickerSearch.trim().toLowerCase();
    if (!query) {
      return imageLibrary;
    }

    return imageLibrary.filter(
      (item) => item.displayName.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
    );
  }, [imageLibrary, imagePickerSearch]);

  const debouncedCards = useDebouncedValue(cards, 250);
  const debouncedHeader = useDebouncedValue(headerLabel, 250);
  const debouncedFooter = useDebouncedValue(footerAccount, 250);
  const debouncedChrome = useDebouncedValue(chromeConfig, 250);

  const parsedEntries = useMemo<readonly ParsedCardEntry[]>(
    () =>
      debouncedCards.map((rawText, index) => {
        const parsed = parseCardText(rawText, index + 1);
        if (isCardnewsError(parsed)) {
          return { card: fallbackCard(index + 1, parsed), error: parsed };
        }

        return { card: parsed, error: undefined };
      }),
    [debouncedCards]
  );

  const previewDeck = useMemo<Deck>(
    () => ({
      id: "preview",
      headerLabel: debouncedHeader.trim() || "CARD NEWS",
      footerAccount: normalizeFooterAccount(debouncedFooter) || defaultFooterAccount,
      cards: parsedEntries.map((entry) => entry.card),
      chrome: debouncedChrome,
      styleId,
      accentColor,
      backgroundDim,
      aspectRatio: aspectRatioId,
      backgroundMedia,
      mediaAssets,
      videoProjectMode,
      sceneDefaults,
      bodyNumberDefault,
      nextHint: nextHintConfig,
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {})
    }),
    [
      parsedEntries,
      debouncedHeader,
      debouncedFooter,
      debouncedChrome,
      styleId,
      accentColor,
      backgroundDim,
      aspectRatioId,
      backgroundMedia,
      mediaAssets,
      videoProjectMode,
      sceneDefaults,
      bodyNumberDefault,
      nextHintConfig,
      backgroundId,
      selectedFontId,
      overrides
    ]
  );

  const previewAssetCssUrls = useMemo(
    () => ({ ...backgroundPreviews, ...imagePreviews, ...mediaPreviews }),
    [backgroundPreviews, imagePreviews, mediaPreviews]
  );
  const previewHtmls = useMemo(
    () =>
      previewDeck.cards.map((card) => {
        const override = overrides[String(card.index)];
        const cardBackgroundId = override?.backgroundId === null ? null : override?.backgroundId ?? backgroundId;
        return buildCardHtml({
          assetCssUrls: previewAssetCssUrls,
          backgroundCssUrl: cardBackgroundId ? backgroundPreviews[cardBackgroundId] : undefined,
          card,
          customStyles,
          deck: previewDeck,
          liveVideo: videoProjectMode === "video" && card.index === selectedIndex + 1,
          ...(fontCss ? { fontCss } : {}),
          ...(override ? { override } : {})
        });
      }),
    [
      previewDeck,
      backgroundId,
      backgroundPreviews,
      customStyles,
      overrides,
      fontCss,
      previewAssetCssUrls,
      selectedIndex,
      videoProjectMode
    ]
  );

  const parseErrorCount = parsedEntries.filter((entry) => entry.error).length;
  const selectedEntry = parsedEntries[selectedIndex];
  const selectedEditorEntry = useMemo<ParsedCardEntry>(() => {
    const parsed = parseCardText(cards[selectedIndex] ?? "", selectedIndex + 1);
    if (isCardnewsError(parsed)) {
      return { card: fallbackCard(selectedIndex + 1, parsed), error: parsed };
    }

    return { card: parsed, error: undefined };
  }, [cards, selectedIndex]);
  const selectedEditorCard = selectedEditorEntry.error ? undefined : selectedEditorEntry.card;
  const selectedCardNumber = selectedIndex + 1;
  const selectedOverride = overrides[String(selectedCardNumber)];
  const selectedLayers = useMemo(() => selectedOverride?.layers ?? [], [selectedOverride]);
  const selectedLayer = selectedLayers.find((layer) => layer.id === selectedLayerId);
  const selectedTextLayer: CardTextBoxLayer | undefined = selectedLayer?.kind === "text" ? selectedLayer : undefined;
  const selectedBackgroundMedia = selectedOverride?.backgroundMedia ?? { mode: "inherit" };
  const selectedScene = normalizeCardSceneSettings(selectedOverride?.scene, sceneDefaults);
  const selectedPreviewCard = previewDeck.cards[selectedIndex];
  const selectedBodyNumber = selectedPreviewCard
    ? resolveBodyNumber(previewDeck, selectedPreviewCard, selectedOverride)
    : undefined;
  const selectedGlobalMediaAsset =
    backgroundMedia.mode === "asset" ? mediaAssets.find((asset) => asset.id === backgroundMedia.mediaId) : undefined;
  const selectedCardMediaAsset =
    selectedBackgroundMedia.mode === "asset"
      ? mediaAssets.find((asset) => asset.id === selectedBackgroundMedia.mediaId)
      : undefined;
  const selectedSemanticSlots = useMemo(
    () =>
      buildSemanticSlotDrafts(selectedEditorCard, footerAccount, selectedOverride, {
        ...(chromeConfig.header.visible ? { headerLabel } : {}),
        ...(chromeConfig.pageNumber.visible
          ? { pageNumber: `${selectedCardNumber} / ${Math.max(1, parsedEntries.length)}` }
          : {}),
        ...(selectedOverride?.badge?.imageId ? { badgeImageLabel: "배지 이미지" } : {}),
        ...(selectedBodyNumber?.visible ? { bodyNumber: selectedBodyNumber.text } : {}),
        ...(selectedCardNumber < parsedEntries.length && nextHintConfig.kind !== "none"
          ? { nextHint: "넘김 기호" }
          : {})
      }),
    [
      chromeConfig.header.visible,
      chromeConfig.pageNumber.visible,
      footerAccount,
      headerLabel,
      nextHintConfig.kind,
      parsedEntries.length,
      selectedBodyNumber,
      selectedCardNumber,
      selectedEditorCard,
      selectedOverride
    ]
  );
  const selectedAudioCandidates = useMemo(
    () => buildSceneAudioCandidates(selectedCardNumber, selectedBackgroundMedia, selectedLayers, mediaAssets),
    [mediaAssets, selectedBackgroundMedia, selectedCardNumber, selectedLayers]
  );
  const videoExportSummary = useMemo(() => buildVideoExportSummary(previewDeck), [previewDeck]);
  const compiledTimeline = useMemo(() => compileVideoTimeline(previewDeck), [previewDeck]);
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        redoOverrideChange();
      } else {
        undoOverrideChange();
      }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, []);
  useEffect(() => {
    if (!exportDialogOpen) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = exportDialogRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = (): void => {
      const first = dialog?.querySelector<HTMLElement>(focusableSelector);
      (first ?? dialog)?.focus();
    };
    const animationFrame = window.requestAnimationFrame(focusFirst);
    const handleDialogKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExportDialogOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleDialogKeyDown);
      previouslyFocused?.focus();
    };
  }, [exportDialogOpen]);
  const editorToolbarTarget = resolveEditorToolbarTarget({
    editMode,
    selectedLayer: selectedTextLayer,
    selectedSemanticSlotId
  });
  const backgroundManagerUsages = useMemo(
    () =>
      backgroundManagerSelectedId
        ? findBackgroundLibraryUsage(backgroundManagerSelectedId, { backgroundId, overrides })
        : [],
    [backgroundId, backgroundManagerSelectedId, overrides]
  );
  const backgroundManagerDeleteDisabled =
    !backgroundManagerSelectedId || backgroundManagerBusy || backgroundManagerUsages.length > 0;
  const imagePickerUsages = useMemo(
    () =>
      imagePickerSelectedId
        ? findImageLibraryUsage(imagePickerSelectedId, { nextHint: nextHintConfig, overrides })
        : [],
    [imagePickerSelectedId, nextHintConfig, overrides]
  );
  const imagePickerDeleteDisabled = !imagePickerSelectedId || imagePickerBusy || imagePickerUsages.length > 0;

  // ── 시작 시 라이브러리/프리셋/워크스페이스 복원 ──
  useEffect(() => {
    void (async () => {
      const [
        libraryResult,
        presetsResult,
        workspaceResult,
        customStylesResult,
        settingsResult,
        imageLibraryResult,
        fontLibraryResult,
        aiProvidersResult
      ] = await Promise.all([
        window.cardnews.listBackgroundLibrary(),
        window.cardnews.listDeckPresets(),
        window.cardnews.loadWorkspace(),
        window.cardnews.listCustomStyles(),
        window.cardnews.loadSettings(),
        listEditionImages(),
        window.cardnews.listFontLibrary(),
        listEditionAiProviders()
      ]);

      if (!isCardnewsError(libraryResult)) {
        setBackgroundLibrary(libraryResult);
      }
      if (!isCardnewsError(presetsResult)) {
        setPresets(presetsResult);
      }
      if (!isCardnewsError(customStylesResult)) {
        setCustomStyles(customStylesResult);
      }
      if (!isCardnewsError(fontLibraryResult)) {
        setFontLibrary(fontLibraryResult);
      }
      if (!isCardnewsError(imageLibraryResult)) {
        setImageLibrary(imageLibraryResult);
      }
      if (!isCardnewsError(settingsResult)) {
        setSettings(settingsResult);
        setPixabayApiKeyDraft(settingsResult.pixabayApiKey ?? "");
        setGptsTemplateBuilderUrlDraft(settingsResult.gptsTemplateBuilderUrl ?? "");
        setAiDefaultInstructionDraft(settingsResult.aiDefaultInstruction ?? "");
      }
      if (!isCardnewsError(aiProvidersResult)) {
        setAiProviders(aiProvidersResult);
        const restoredProvider = !isCardnewsError(settingsResult)
          ? settingsResult.aiDefaultProviderId
          : undefined;
        setAiProviderId(chooseDefaultAiProvider(aiProvidersResult, restoredProvider));
        setAiStatus(
          aiProvidersResult.some((provider) => provider.installed)
            ? "AI CLI를 감지했습니다."
            : "감지된 AI CLI가 없습니다. 설치 후 새로고침하세요."
        );
      }

      if (!isCardnewsError(workspaceResult) && workspaceResult) {
        applySnapshot(workspaceResult);
        setStatus("이전 작업을 복원했습니다.");
      }

      workspaceReady.current = true;
      setWorkspaceHydrated(true);

      await refreshMediaAssets();
      const restoredFontId = !isCardnewsError(workspaceResult) && workspaceResult ? workspaceResult.fontId ?? null : null;
      await loadFontCss(restoredFontId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 워크스페이스 자동 저장 (디바운스) ──
  useEffect(() => {
    if (!workspaceReady.current) {
      return;
    }

    const timer = setTimeout(() => {
      void window.cardnews.saveWorkspace(buildWorkspaceState());
    }, 800);
    return () => clearTimeout(timer);
  }, [
    cards,
    headerLabel,
    footerAccount,
    chromeConfig,
    styleId,
    aspectRatioId,
    customAccent,
    customDim,
    backgroundId,
    mediaAssets,
    backgroundMedia,
    sceneDefaults,
    bodyNumberDefault,
    selectedFontId,
    overrides,
    bulkBindings,
    nextHintConfig,
    railWidth,
    selectedIndex
  ]);

  useEffect(() => {
    setAccentDraft(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!pageContextMenu) return;
    const invokingIndex = pageContextMenu.index;
    const closeMenu = () => {
      setPageContextMenu(null);
      queueMicrotask(() => thumbnailRefs.current[invokingIndex]?.focus());
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pageContextMenu]);

  useEffect(() => {
    const ids = new Set<string>();
    if (backgroundId) {
      ids.add(backgroundId);
    }
    for (const override of Object.values(overrides)) {
      if (override.backgroundId) {
        ids.add(override.backgroundId);
      }
      for (const layer of override.layers ?? []) {
        if (layer.kind === "image" && backgroundLibrary.some((item) => item.id === layer.backgroundId)) {
          ids.add(layer.backgroundId);
        }
      }
    }

    for (const id of ids) {
      if (!backgroundPreviews[id]) {
        void loadBackgroundPreview(id);
      }
    }
  }, [backgroundId, backgroundLibrary, backgroundPreviews, overrides]);

  useEffect(() => {
    const ids = new Set<string>();
    for (const override of Object.values(overrides)) {
      if (override.badge?.imageId) {
        ids.add(override.badge.imageId);
      }
      for (const layer of override.layers ?? []) {
        if (layer.kind === "image" && imageLibrary.some((item) => item.id === layer.backgroundId)) {
          ids.add(layer.backgroundId);
        }
      }
    }
    if (nextHintConfig.kind === "image" && nextHintConfig.imageId) {
      ids.add(nextHintConfig.imageId);
    }

    for (const id of ids) {
      if (!imagePreviews[id]) {
        void loadImagePreview(id);
      }
    }
  }, [imageLibrary, imagePreviews, nextHintConfig, overrides]);

  useEffect(() => () => clearFontBlobUrl(), []);

  useEffect(() => {
    setSelectedLayerId(null);
    setSelectedSemanticSlotId(null);
    setEditingLayerId(null);
    setEditingSemanticSlotId(null);
    setEditingLayerText("");
    setEditingSemanticText("");
  }, [selectedIndex]);

  useEffect(() => {
    if (selectedLayerId && !selectedLayers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(null);
      setEditingLayerId(null);
      setEditingLayerText("");
    }
  }, [selectedLayerId, selectedLayers]);

  useEffect(() => {
    if (selectedSemanticSlotId && !selectedSemanticSlots.some((slot) => slot.id === selectedSemanticSlotId)) {
      setSelectedSemanticSlotId(null);
      setEditingSemanticSlotId(null);
      setEditingSemanticText("");
    }
  }, [selectedSemanticSlotId, selectedSemanticSlots]);

  function applySnapshot(snapshot: {
    readonly headerLabel: string;
    readonly footerAccount: string;
    readonly chrome?: ReturnType<typeof normalizeChromeConfig>;
    readonly styleId: string;
    readonly accentColor?: string;
    readonly backgroundDim?: number;
    readonly backgroundId?: string;
    readonly backgroundMedia?: BackgroundMediaSelection;
    readonly mediaAssets?: readonly MediaAssetRef[];
    readonly videoProjectMode?: VideoProjectMode;
    readonly sceneDefaults?: typeof defaultCardSceneSettings;
    readonly bodyNumberDefault?: BodyNumberDefault;
    readonly aspectRatio?: string;
    readonly fontId?: string;
    readonly nextHint?: NextHintConfig;
    readonly overrides?: CardOverrideMap;
    readonly bulkBindings?: BulkBindingMetadata;
    readonly railWidth?: number;
    readonly cards: readonly string[];
    readonly selectedIndex?: number;
  }): void {
    setHeaderLabel(snapshot.headerLabel);
    setFooterAccount(normalizeFooterAccount(snapshot.footerAccount));
    setChromeConfig(normalizeChromeConfig(snapshot.chrome));
    if (snapshot.styleId.trim().length > 0) {
      setStyleId(snapshot.styleId);
    }
    setCustomAccent(snapshot.accentColor ?? null);
    setCustomDim(snapshot.backgroundDim ?? null);
    setBackgroundMedia(snapshot.backgroundMedia ?? { mode: "none" });
    setMediaAssets(snapshot.mediaAssets ?? []);
    setVideoProjectMode(normalizeVideoProjectMode(snapshot.videoProjectMode, snapshot));
    setSceneDefaults(normalizeCardSceneSettings(snapshot.sceneDefaults, defaultCardSceneSettings));
    setBodyNumberDefault(snapshot.bodyNumberDefault ?? "show");
    if (snapshot.aspectRatio && aspectRatios.some((ratio) => ratio.id === snapshot.aspectRatio)) {
      setAspectRatioId(snapshot.aspectRatio);
    }
    setSelectedFontId(snapshot.fontId ?? null);
    setNextHintConfig(normalizeNextHintForUi(snapshot.nextHint));

    const nextCards = snapshot.cards.slice(0, maxCards);
    if (nextCards.length > 0) {
      setCards(nextCards);
      setSelectedIndex(Math.min(snapshot.selectedIndex ?? 0, nextCards.length - 1));
    }
    setOverrides(snapshot.overrides ?? {});
    setBulkBindings(snapshot.bulkBindings);
    if (typeof snapshot.railWidth === "number") {
      setRailWidth(Math.min(280, Math.max(90, snapshot.railWidth)));
    }

    void applyBackgroundSelection(snapshot.backgroundId ?? null);
  }

  function updateChromeSlot(slot: "header" | "footer", patch: Partial<ChromeSlotStyle>): void {
    setChromeConfig((current) =>
      normalizeChromeConfig({
        ...current,
        [slot]: {
          ...current[slot],
          ...patch
        }
      })
    );
  }

  function updateChromePageNumber(patch: Partial<ChromePageNumberStyle>): void {
    setChromeConfig((current) =>
      normalizeChromeConfig({
        ...current,
        pageNumber: {
          ...current.pageNumber,
          ...patch
        }
      })
    );
  }

  async function loadBackgroundPreview(nextBackgroundId: string): Promise<void> {
    const preview = await window.cardnews.getBackgroundPreview(nextBackgroundId);
    if (isCardnewsError(preview)) {
      setStatus(preview.message);
      return;
    }

    setBackgroundPreviews((current) => ({ ...current, [nextBackgroundId]: preview }));
  }

  async function refreshBackgroundLibraryWithPreviews(preferredId?: string | null): Promise<void> {
    const library = await window.cardnews.listBackgroundLibrary();
    if (isCardnewsError(library)) {
      setStatus(library.message);
      return;
    }

    setBackgroundLibrary(library);
    for (const item of library) {
      if (!backgroundPreviews[item.id] || item.id === preferredId) {
        void loadBackgroundPreview(item.id);
      }
    }
  }

  async function loadImagePreview(imageId: string): Promise<void> {
    const preview = await getEditionImagePreview(imageId);
    if (isCardnewsError(preview)) {
      setStatus(preview.message);
      return;
    }

    setImagePreviews((current) => ({ ...current, [imageId]: preview }));
  }

  function getM22OptionalApi(): M22OptionalCardnewsApi {
    return window.cardnews as unknown as M22OptionalCardnewsApi;
  }

  async function refreshMediaAssets(): Promise<void> {
    const api = getM22OptionalApi();
    if (!api.listMediaCatalog) {
      return;
    }

    const result = await api.listMediaCatalog();
    if (isMediaCatalogError(result)) {
      setStatus(result.message);
      return;
    }

    setMediaAssets(result.map(mediaCatalogAssetToRef));
  }

  async function loadMediaPreview(mediaId: string): Promise<void> {
    const api = getM22OptionalApi();
    if (!api.getMediaPreview || mediaPreviews[mediaId]) {
      return;
    }

    const preview = await api.getMediaPreview(mediaId);
    if (isMediaCatalogError(preview)) {
      setStatus(preview.message);
      return;
    }

    setMediaPreviews((current) => ({ ...current, [mediaId]: preview }));
  }

  async function importMediaForSelection(kind: MediaKind): Promise<void> {
    const api = getM22OptionalApi();
    if (!api.importMediaAsset) {
      setStatus("미디어 가져오기 API가 아직 연결되지 않았습니다.");
      return;
    }

    const imported = await api.importMediaAsset(kind);
    if (isMediaCatalogError(imported)) {
      setStatus(imported.message);
      return;
    }
    const importedRef = mediaCatalogAssetToRef(imported);

    setMediaAssets((current) =>
      current.some((asset) => asset.id === importedRef.id) ? current : [...current, importedRef]
    );
    void loadMediaPreview(importedRef.id);
    setPendingMediaAsset(importedRef);
    setStatus(`${importedRef.kind === "video" ? "영상" : "이미지"}를 가져왔습니다. 적용 위치를 선택하세요.`);
  }

  function assignImportedMedia(target: "global" | "card" | "video-layer"): void {
    const importedRef = pendingMediaAsset;
    if (!importedRef) return;
    if (target === "global") {
      setBackgroundMedia(assignBackgroundMediaAsset(importedRef.id));
    } else if (target === "card") {
      updateSelectedOverride({ backgroundMedia: assignBackgroundMediaAsset(importedRef.id) });
    } else if (importedRef.kind === "video") {
      const layer = createVideoLayerFromAsset(importedRef, `layer-video-${Date.now().toString(36)}`);
      updateSelectedOverrideWith((currentOverride) => ({
        ...currentOverride,
        layers: [...(currentOverride.layers ?? []), layer]
      }));
      setSelectedLayerId(layer.id);
      setEditMode(true);
    }
    if (importedRef.kind === "video") {
      setVideoProjectMode("video");
    }
    setPendingMediaAsset(null);
    setStatus(`${importedRef.displayName} 적용 완료`);
  }

  function mediaAssetLabel(asset: MediaAssetRef): string {
    const kindLabel = asset.kind === "video" ? "영상" : "이미지";
    const duration = asset.durationMs ? ` · ${formatDuration(asset.durationMs)}` : "";
    return `${kindLabel} · ${asset.displayName}${duration}`;
  }

  function updateSelectedScene(patch: Partial<CardSceneSettings>): void {
    updateSelectedOverride({
      scene: normalizeCardSceneSettings({ ...selectedScene, ...patch }, sceneDefaults)
    });
  }

  function updateCardScene(cardNumber: number, patch: Partial<CardSceneSettings>): void {
    updateOverrideForCard(cardNumber, (currentOverride) => ({
      ...currentOverride,
      scene: normalizeCardSceneSettings(
        { ...normalizeCardSceneSettings(currentOverride.scene, sceneDefaults), ...patch },
        sceneDefaults
      )
    }));
  }

  async function startVideoExport(): Promise<void> {
    if (isVideoExporting) {
      return;
    }
    const api = getM22OptionalApi();
    if (!api.exportVideoMp4) {
      setStatus("MP4 내보내기 API가 아직 연결되지 않았습니다.");
      return;
    }

    setIsVideoExporting(true);
    setActiveVideoExportJobId(null);
    setVideoExportResult(null);
    setVideoExportError(null);
    setVideoExportProgress(null);
    setStatus("MP4 내보내기를 준비합니다.");
    const unsubscribeProgress = api.onVideoExportProgress?.((progress) => {
      setActiveVideoExportJobId(progress.jobId);
      setVideoExportProgress(progress);
      setStatus(
        `MP4 ${videoExportStageLabel(progress.stage)} ${Math.round(progress.percent)}% · ${formatElapsedMs(
          progress.elapsedMs
        )}`
      );
    });
    try {
      const result = await api.exportVideoMp4({ workspace: buildWorkspaceState() });
      if (isMp4ExportError(result)) {
        setVideoExportError(result);
        setStatus(`MP4 실패: ${result.message}`);
        return;
      }
      setVideoExportResult(result);
      setActiveVideoExportJobId(result.jobId);
      setVideoExportProgress({
        jobId: result.jobId,
        stage: "finalize",
        percent: 100,
        message: "MP4 저장을 완료했습니다."
      });
      setStatus(`MP4 저장: ${result.filePath}`);
    } finally {
      unsubscribeProgress?.();
      setIsVideoExporting(false);
    }
  }

  async function cancelVideoExport(): Promise<void> {
    const api = getM22OptionalApi();
    if (!api.cancelVideoExport) {
      setStatus("MP4 취소 API가 아직 연결되지 않았습니다.");
      return;
    }
    if (!activeVideoExportJobId) {
      setStatus("취소할 MP4 작업 id를 아직 받지 못했습니다.");
      return;
    }
    const result = await api.cancelVideoExport(activeVideoExportJobId);
    setStatus(result.ok === false ? `MP4 취소 실패: ${result.message}` : "MP4 내보내기 취소를 요청했습니다.");
  }

  async function refreshImageLibraryWithPreviews(preferredId?: string | null): Promise<void> {
    const library = await listEditionImages();
    if (isCardnewsError(library)) {
      setStatus(library.message);
      return;
    }

    setImageLibrary(library);
    for (const item of library) {
      if (!imagePreviews[item.id] || item.id === preferredId) {
        void loadImagePreview(item.id);
      }
    }
  }

  async function applyBackgroundSelection(nextBackgroundId: string | null): Promise<void> {
    setBackgroundId(nextBackgroundId);
    if (nextBackgroundId === null) {
      setBackgroundPreview(null);
      return;
    }

    const preview = await window.cardnews.getBackgroundPreview(nextBackgroundId);
    if (isCardnewsError(preview)) {
      setStatus(preview.message);
      setBackgroundPreview(null);
      return;
    }

    setBackgroundPreview(preview);
    setBackgroundPreviews((current) => ({ ...current, [nextBackgroundId]: preview }));
  }

  function clearFontBlobUrl(): void {
    if (fontBlobUrlRef.current) {
      URL.revokeObjectURL(fontBlobUrlRef.current);
      fontBlobUrlRef.current = null;
    }
  }

  async function loadFontCss(nextFontId: string | null): Promise<void> {
    const fontResult = await window.cardnews.getFontData(nextFontId);
    if (isCardnewsError(fontResult)) {
      setStatus(fontResult.message);
      clearFontBlobUrl();
      setFontCss(null);
      return;
    }

    setFontCss(buildPreviewFontFaceCss(fontResult));
  }

  async function selectFont(nextFontId: string | null): Promise<void> {
    setSelectedFontId(nextFontId);
    await loadFontCss(nextFontId);
    setStatus(nextFontId ? "사용자 폰트를 적용했습니다." : "번들 Pretendard 폰트를 적용했습니다.");
  }

  async function importFont(): Promise<void> {
    const imported = await window.cardnews.importFontToLibrary();
    if (isCardnewsError(imported)) {
      setStatus(imported.message);
      return;
    }

    const library = await window.cardnews.listFontLibrary();
    if (!isCardnewsError(library)) {
      setFontLibrary(library);
    }
    await selectFont(imported.id);
    setStatus(`폰트 추가: ${imported.displayName}`);
  }

  function buildPreviewFontFaceCss(fontData: FontData): string {
    clearFontBlobUrl();
    const bytes = Uint8Array.from(atob(fontData.base64), (char) => char.charCodeAt(0));
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: fontData.mimeType }));
    fontBlobUrlRef.current = blobUrl;
    return buildFontFaceCss(blobUrl, {
      family: fontData.cssFamily,
      format: fontData.cssFormat
    });
  }

  async function addBackground(): Promise<void> {
    const added = await window.cardnews.addBackgroundToLibrary();
    if (isCardnewsError(added)) {
      setStatus(added.message);
      return;
    }

    await refreshBackgroundLibraryWithPreviews(added.id);
    await loadBackgroundPreview(added.id);
    setBackgroundManagerSelectedId(added.id);
    setStatus(`배경 추가: ${added.displayName} · 배경 관리에서 적용할 수 있습니다.`);
  }

  function openBackgroundManager(): void {
    setBackgroundManagerSelectedId(backgroundId);
    setBackgroundManagerSearch("");
    setBackgroundManagerOpen(true);
    void refreshBackgroundLibraryWithPreviews(backgroundId);
  }

  function closeBackgroundManager(): void {
    setBackgroundManagerOpen(false);
    setBackgroundManagerSelectedId(null);
    setBackgroundManagerSearch("");
    setBackgroundManagerBusy(false);
  }

  async function applyManagedBackground(): Promise<void> {
    await applyBackgroundSelection(backgroundManagerSelectedId);
    setStatus(backgroundManagerSelectedId ? "전역 배경을 적용했습니다." : "전역 배경을 해제했습니다.");
    closeBackgroundManager();
  }

  async function deleteManagedBackground(): Promise<void> {
    const selectedId = backgroundManagerSelectedId;
    if (!selectedId) {
      setStatus("삭제할 배경 이미지를 먼저 선택하세요.");
      return;
    }
    if (backgroundManagerUsages.length > 0) {
      setStatus(`배경 이미지가 사용 중입니다: ${backgroundManagerUsages.map((usage) => usage.label).join(", ")}`);
      return;
    }

    setBackgroundManagerBusy(true);
    try {
      const removed = await window.cardnews.removeBackgroundFromLibrary(selectedId);
      if (isCardnewsError(removed)) {
        setStatus(removed.message);
        return;
      }

      setBackgroundPreviews((current) => {
        const next = { ...current };
        delete next[selectedId];
        return next;
      });
      await refreshBackgroundLibraryWithPreviews(null);
      setBackgroundManagerSelectedId(null);
      setStatus(removed.removed ? "배경 이미지를 삭제했습니다." : "배경 이미지를 찾지 못했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "배경 이미지를 삭제하지 못했습니다.");
    } finally {
      setBackgroundManagerBusy(false);
    }
  }

  async function addImageThroughPicker(): Promise<void> {
    const added = await addEditionImage();
    if (isCardnewsError(added)) {
      setStatus(added.message);
      return;
    }

    await refreshImageLibraryWithPreviews(added.id);
    await loadImagePreview(added.id);
    setImagePickerSelectedId(added.id);
    setStatus(`이미지 추가: ${added.displayName}`);
  }

  function openImagePicker(target: ImagePickerTarget, currentImageId?: string | null): void {
    setImagePickerTarget(target);
    setImagePickerSelectedId(currentImageId ?? null);
    void refreshImageLibraryWithPreviews(currentImageId ?? null);
  }

  function closeImagePicker(): void {
    setImagePickerTarget(null);
    setImagePickerSelectedId(null);
    setImagePickerBusy(false);
    setImagePickerSearch("");
  }

  function applyImagePickerSelection(imageId: string | null): void {
    const target = imagePickerTarget;
    if (!target) {
      return;
    }

    if (target.kind === "badge") {
      setSelectedBadgeImage(imageId);
    } else if (target.kind === "nextHint") {
      setNextHintImage(imageId);
    } else {
      updateLayer(target.layerId, (layer) =>
        layer.kind === "image" ? { ...layer, backgroundId: imageId ?? "" } : layer
      );
    }

    setStatus(imageId ? "이미지를 적용했습니다." : "이미지 선택을 해제했습니다.");
    closeImagePicker();
  }

  async function deleteSelectedPickerImage(): Promise<void> {
    const imageId = imagePickerSelectedId;
    if (!imageId) {
      setStatus("삭제할 이미지를 먼저 선택하세요.");
      return;
    }
    if (imagePickerUsages.length > 0) {
      setStatus(`이미지가 사용 중입니다: ${imagePickerUsages.map((usage) => usage.label).join(", ")}`);
      return;
    }

    setImagePickerBusy(true);
    const removed = await removeEditionImage(imageId);
    setImagePickerBusy(false);
    if (isCardnewsError(removed)) {
      setStatus(removed.message);
      return;
    }

    await refreshImageLibraryWithPreviews(null);
    setImagePickerSelectedId(null);
    setStatus(removed.removed ? "이미지를 삭제했습니다." : "이미지를 찾지 못했습니다.");
  }

  async function removeSelectedPickerBackground(): Promise<void> {
    const imageId = imagePickerSelectedId;
    if (!imageId) {
      setStatus("배경을 제거할 이미지를 먼저 선택하세요.");
      return;
    }

    setImagePickerBusy(true);
    const processed = await removeEditionImageBackdrop(imageId, backgroundRemovalTolerance);
    setImagePickerBusy(false);
    if (isCardnewsError(processed)) {
      setStatus(processed.message);
      return;
    }

    await refreshImageLibraryWithPreviews(processed.id);
    await loadImagePreview(processed.id);
    setImagePickerSelectedId(processed.id);
    setStatus(`배경 제거 완료: ${processed.displayName}`);
  }

  async function openExternalLink(url: string): Promise<void> {
    const result = await window.cardnews.openExternalLink(url);
    if (isCardnewsError(result)) {
      setStatus(result.message);
    }
  }

  async function requestLockedFeature(featureCode: string): Promise<void> {
    const result = await window.cardnews.requestLockedFeature(featureCode);
    setStatus(isCardnewsError(result) ? result.message : "Pro에서 사용 가능한 기능입니다.");
  }

  function renderEditionLock(featureCode: string, title: string, message: string): ReactElement {
    return (
      <FeatureLock
        featureCode={featureCode}
        title={title}
        onRequest={(lockedFeatureCode) => void requestLockedFeature(lockedFeatureCode)}
        onOpenThreads={() => void openExternalLink(threadsUrl)}
        onOpenKakao={() => void openExternalLink(kakaoInquiryUrl)}
      >
        {message}
      </FeatureLock>
    );
  }

  function updateSelectedOverride(next: CardOverride): void {
    updateSelectedOverrideWith((currentOverride) => ({ ...currentOverride, ...next }));
  }

  function updateSelectedOverrideWith(updater: (currentOverride: CardOverride) => CardOverride): void {
    updateOverrideForCard(selectedCardNumber, updater);
  }

  function updateOverrideForCard(
    cardNumber: number,
    updater: (currentOverride: CardOverride) => CardOverride
  ): void {
    const key = String(cardNumber);
    setOverrides((current) => {
      const merged = updater(current[key] ?? {});
      const updated = { ...current, [key]: merged };
      const normalized = removeEmptyOverrides(updated);
      if (JSON.stringify(current) !== JSON.stringify(normalized)) {
        overrideHistoryRef.current.past.push(current);
        if (overrideHistoryRef.current.past.length > 100) {
          overrideHistoryRef.current.past.shift();
        }
        overrideHistoryRef.current.future = [];
      }
      return normalized;
    });
    setOverrideHistoryVersion((version) => version + 1);
  }

  function undoOverrideChange(): void {
    setOverrides((current) => {
      const previous = overrideHistoryRef.current.past.pop();
      if (!previous) return current;
      overrideHistoryRef.current.future.push(current);
      return previous;
    });
    setOverrideHistoryVersion((version) => version + 1);
  }

  function redoOverrideChange(): void {
    setOverrides((current) => {
      const next = overrideHistoryRef.current.future.pop();
      if (!next) return current;
      overrideHistoryRef.current.past.push(current);
      return next;
    });
    setOverrideHistoryVersion((version) => version + 1);
  }

  function updateSelectedAdjust(field: "brightness" | "contrast" | "saturation", value: number): void {
    updateSelectedOverride({
      adjust: {
        brightness: selectedOverride?.adjust?.brightness ?? 1,
        contrast: selectedOverride?.adjust?.contrast ?? 1,
        saturation: selectedOverride?.adjust?.saturation ?? 1,
        [field]: value
      }
    });
  }

  function updateSelectedLayout(
    field: "align" | "offsetY" | "gapBadge" | "gapSubtitle",
    value: string | number
  ): void {
    updateSelectedOverride({
      layout: {
        align: selectedOverride?.layout?.align ?? "left",
        offsetY: selectedOverride?.layout?.offsetY ?? 0,
        gapBadge: selectedOverride?.layout?.gapBadge ?? 1,
        gapSubtitle: selectedOverride?.layout?.gapSubtitle ?? 1,
        ...(selectedOverride?.layout?.titlePlacement
          ? { titlePlacement: selectedOverride.layout.titlePlacement }
          : {}),
        [field]: value
      }
    });
  }

  function updateSelectedTitlePlacement(mode: "flow" | "card-y", y?: number): void {
    updateSelectedOverride({
      layout: {
        align: selectedOverride?.layout?.align ?? "left",
        offsetY: selectedOverride?.layout?.offsetY ?? 0,
        gapBadge: selectedOverride?.layout?.gapBadge ?? 1,
        gapSubtitle: selectedOverride?.layout?.gapSubtitle ?? 1,
        titlePlacement: mode === "flow" ? { mode: "flow" } : { mode: "card-y", y: Math.min(100, Math.max(0, y ?? 50)) }
      }
    });
  }

  function updateSelectedTypography(
    field: keyof CardTypographyOverride,
    value: number | boolean | string | undefined
  ): void {
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      typography: {
        ...(currentOverride.typography ?? {}),
        ...(value === undefined ? {} : { [field]: value })
      }
    }));
  }

  function updateCardTypographyWithToolbar(patch: Parameters<typeof applyCardTypographyToolbarPatch>[1]): void {
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      typography: applyCardTypographyToolbarPatch(currentOverride.typography ?? {}, patch)
    }));
  }

  function updateTextLayerWithToolbar(patch: Parameters<typeof applyTextLayerToolbarPatch>[1]): void {
    updateSelectedLayer((layer) => (layer.kind === "text" ? applyTextLayerToolbarPatch(layer, patch) : layer));
  }

  function updateBodyNumberWithToolbar(patch: Parameters<typeof applyBodyNumberToolbarPatch>[1]): void {
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      bodyNumberStyle: applyBodyNumberToolbarPatch(currentOverride.bodyNumberStyle ?? {}, patch)
    }));
  }

  function updateSelectedBadge(patch: CardBadgeOverride): void {
    updateSelectedOverride({
      badge: {
        ...(selectedOverride?.badge ?? {}),
        ...patch
      }
    });
  }

  function setSelectedBadgeShape(shape: "pill" | "rect" | "none" | null): void {
    updateSelectedOverrideWith((currentOverride) => {
      const currentBadge = currentOverride.badge ?? {};
      if (shape === null) {
        const { shape: _removed, ...restBadge } = currentBadge;
        return { ...currentOverride, badge: restBadge };
      }

      return { ...currentOverride, badge: { ...currentBadge, shape } };
    });
  }

  function setSelectedBadgeImage(imageId: string | null): void {
    updateSelectedOverrideWith((currentOverride) => {
      const currentBadge = currentOverride.badge ?? {};
      if (imageId === null) {
        const { imageId: _removed, ...restBadge } = currentBadge;
        return { ...currentOverride, badge: restBadge };
      }

      return { ...currentOverride, badge: { ...currentBadge, imageId } };
    });
  }

  function setSelectedBadgeTextColor(textColor: string | null): void {
    updateSelectedOverrideWith((currentOverride) => {
      const currentBadge = currentOverride.badge ?? {};
      if (textColor === null) {
        const { textColor: _removed, ...restBadge } = currentBadge;
        return { ...currentOverride, badge: restBadge };
      }

      const normalized = parseHexColorInput(textColor);
      return normalized ? { ...currentOverride, badge: { ...currentBadge, textColor: normalized } } : currentOverride;
    });
  }

  function setNextHintKind(kind: NextHintConfig["kind"]): void {
    if (kind === "image") {
      const fallbackImageId = nextHintConfig.imageId ?? imageLibrary[0]?.id;
      setNextHintConfig(
        normalizeNextHintForUi({
          kind: "image",
          ...(fallbackImageId ? { imageId: fallbackImageId } : {}),
          height: nextHintConfig.height ?? 40
        })
      );
      if (fallbackImageId) {
        void loadImagePreview(fallbackImageId);
      }
      return;
    }

    setNextHintConfig({ kind });
  }

  function setNextHintImage(imageId: string | null): void {
    setNextHintConfig(
      normalizeNextHintForUi({
        kind: "image",
        ...(imageId ? { imageId } : {}),
        height: nextHintConfig.height ?? 40
      })
    );
    if (imageId) {
      void loadImagePreview(imageId);
    }
  }

  function setNextHintHeight(height: number): void {
    setNextHintConfig(
      normalizeNextHintForUi({
        kind: "image",
        ...(nextHintConfig.imageId ? { imageId: nextHintConfig.imageId } : {}),
        height
      })
    );
  }

  function updateSelectedLayers(layers: readonly CardLayer[]): void {
    updateSelectedOverride({ layers });
  }

  function addLayer(kind: CardLayer["kind"]): void {
    const layer = createLayer(kind);
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      layers: [...(currentOverride.layers ?? []), layer]
    }));
    setSelectedLayerId(layer.id);
    setEditMode(true);
  }

  function updateLayer(layerId: string, updater: (layer: CardLayer) => CardLayer): void {
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      layers: (currentOverride.layers ?? []).map((layer) => (layer.id === layerId ? updater(layer) : layer))
    }));
  }

  function updateSelectedLayer(updater: (layer: CardLayer) => CardLayer): void {
    if (!selectedLayerId) {
      return;
    }
    updateLayer(selectedLayerId, updater);
  }

  function removeLayer(layerId: string): void {
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      layers: (currentOverride.layers ?? []).filter((layer) => layer.id !== layerId)
    }));
    if (selectedLayerId === layerId) {
      setSelectedLayerId(null);
      setEditingLayerId(null);
      setEditingLayerText("");
    }
  }

  function deleteSemanticSlot(slotId: SemanticItemId): void {
    if (!isBodyNumberSemanticItemId(slotId)) {
      return;
    }
    updateSelectedOverrideWith((currentOverride) => deleteBodyNumber(currentOverride));
    setSelectedSemanticSlotId(null);
    setEditingSemanticSlotId(null);
    setEditingSemanticText("");
    setStatus("본문 번호를 삭제했습니다. 되돌리기로 복원할 수 있습니다.");
  }

  function resetSelectedBodyNumber(): void {
    updateSelectedOverrideWith((currentOverride) => resetBodyNumberToAutomatic(currentOverride));
    setStatus("본문 번호를 자동 번호로 되돌렸습니다.");
  }

  function duplicateSelectedBodyNumberAsTextLayer(): void {
    if (!selectedBodyNumber?.visible) {
      return;
    }
    const semanticSlot = selectedSemanticSlots.find((slot) => isBodyNumberSemanticItemId(slot.id));
    const rect = semanticSlot
      ? semanticSlotPlacementToRect(semanticSlot.placement)
      : { x: 10, y: 18, width: 20, height: 10 };
    const style = selectedOverride?.bodyNumberStyle;
    const layer: CardTextBoxLayer = {
      id: createUiId("layer-text"),
      kind: "text",
      text: selectedBodyNumber.text,
      ...clampLayerRect(rect),
      zIndex: style?.zIndex ?? 5,
      color: style?.color ?? accentColor,
      fontSize: style?.fontSize ?? 92,
      fontWeight: style?.fontWeight ?? 900,
      italic: style?.italic ?? false,
      align: style?.textAlign ?? style?.align ?? "left",
      textOpacity: style?.textOpacity ?? 100,
      ...(style?.fontFamily ? { fontFamily: style.fontFamily } : {})
    };
    updateSelectedOverrideWith((currentOverride) => ({
      ...currentOverride,
      layers: [...(currentOverride.layers ?? []), layer]
    }));
    setSelectedSemanticSlotId(null);
    setSelectedLayerId(layer.id);
    setStatus("본문 번호를 자유 텍스트 레이어로 복제했습니다.");
  }

  function handleLayerClipboardCommand(command: LayerClipboardCommand): void {
    const result =
      command === "copy"
        ? copyLayerToClipboard(selectedLayers, selectedLayerId ?? undefined, layerClipboardRef.current)
        : command === "cut"
          ? cutLayerToClipboard(selectedLayers, selectedLayerId ?? undefined, layerClipboardRef.current)
          : pasteLayerFromClipboard({
              layers: selectedLayers,
              clipboard: layerClipboardRef.current,
              bounds: { width: 100, height: 100 },
              offset: 2,
              idFactory: (source, pasteIndex) => `${source.id}-paste-${pasteIndex}-${crypto.randomUUID()}`
            });
    layerClipboardRef.current = result.clipboard;
    if (result.status === "cut" || result.status === "pasted") updateSelectedLayers(result.layers);
    if (result.selectedLayerId) setSelectedLayerId(result.selectedLayerId);
    if (result.status === "copied") setStatus("레이어를 복사했습니다. 다른 페이지에서도 붙여넣을 수 있습니다.");
    if (result.status === "cut") setStatus("레이어를 잘라냈습니다.");
    if (result.status === "pasted") setStatus("레이어를 붙여넣었습니다.");
  }

  function selectLayer(layerId: string | null): void {
    setSelectedLayerId(layerId);
    if (layerId) {
      setSelectedSemanticSlotId(null);
      setEditingSemanticSlotId(null);
      setEditingSemanticText("");
      setEditMode(true);
    } else {
      setEditingLayerId(null);
      setEditingLayerText("");
    }
  }

  function selectSemanticSlot(slotId: SemanticItemId | null): void {
    setSelectedSemanticSlotId(slotId);
    if (slotId) {
      setSelectedLayerId(null);
      setEditingLayerId(null);
      setEditingLayerText("");
      setEditMode(true);
    } else {
      setEditingSemanticSlotId(null);
      setEditingSemanticText("");
    }
  }

  function transformLayer(layerId: string, rect: LayerRect): void {
    updateLayer(layerId, (layer) => ({ ...layer, ...clampLayerRect(rect) }));
  }

  function transformLineLayer(layerId: string, lineLayer: CardLineLayer): void {
    updateLayer(layerId, (layer) => (layer.kind === "line" ? roundLineLayer(lineLayer) : layer));
  }

  function nudgeLayer(layerId: string, deltaXPercent: number, deltaYPercent: number): void {
    updateLayer(layerId, (layer) => {
      if (layer.kind === "line") {
        return translateLineLayer(layer, deltaXPercent, deltaYPercent);
      }

      return {
        ...layer,
        ...clampLayerRect({
          x: layer.x + deltaXPercent,
          y: layer.y + deltaYPercent,
          width: layer.width,
          height: layer.height
        })
      };
    });
  }

  function transformSemanticSlot(slotId: SemanticItemId, placement: SemanticSlotPlacement): void {
    updateSelectedOverrideWith((currentOverride) =>
      updateSemanticSlotPlacement(currentOverride, slotId, placement, selectedEditorCard, footerAccount)
    );
  }

  function startLayerTextEdit(layer: CardLayer): void {
    if (layer.kind !== "text") {
      return;
    }
    setSelectedLayerId(layer.id);
    setSelectedSemanticSlotId(null);
    setEditingSemanticSlotId(null);
    setEditingSemanticText("");
    setEditingLayerId(layer.id);
    setEditingLayerText(layer.text);
  }

  function startSemanticTextEdit(slotId: SemanticItemId, text: string): void {
    setSelectedSemanticSlotId(slotId);
    setSelectedLayerId(null);
    setEditingLayerId(null);
    setEditingLayerText("");
    setEditingSemanticSlotId(slotId);
    setEditingSemanticText(text);
  }

  function commitLayerTextEdit(): void {
    const layerId = editingLayerId;
    if (!layerId) {
      return;
    }
    updateLayer(layerId, (layer) => (layer.kind === "text" ? { ...layer, text: editingLayerText } : layer));
    setEditingLayerId(null);
    setEditingLayerText("");
  }

  function cancelLayerTextEdit(): void {
    setEditingLayerId(null);
    setEditingLayerText("");
  }

  function commitSemanticTextEdit(): void {
    const slotId = editingSemanticSlotId;
    if (!slotId) {
      return;
    }
    const update = updateSemanticSlotText(
      selectedEditorCard,
      footerAccount,
      slotId,
      editingSemanticText,
      selectedOverride
    );
    if (update.card) {
      updateCard(selectedIndex, serializeCard(update.card));
    }
    if (update.footerAccount !== undefined) {
      setFooterAccount(update.footerAccount);
    }
    if (update.headerLabel !== undefined) {
      setHeaderLabel(update.headerLabel);
    }
    if (update.override) {
      updateSelectedOverrideWith(() => update.override as CardOverride);
    }
    setEditingSemanticSlotId(null);
    setEditingSemanticText("");
  }

  function cancelSemanticTextEdit(): void {
    setEditingSemanticSlotId(null);
    setEditingSemanticText("");
  }

  function changeLayerZ(direction: "back" | "forward"): void {
    updateSelectedLayer((layer) => ({
      ...layer,
      zIndex: Math.min(20, Math.max(0, (layer.zIndex ?? 4) + (direction === "forward" ? 1 : -1)))
    }));
  }

  function createLayer(kind: CardLayer["kind"]): CardLayer {
    const id = `layer-${kind}-${Date.now().toString(36)}`;
    switch (kind) {
      case "text":
        return {
          id,
          kind,
          x: 18,
          y: 44,
          width: 64,
          height: 12,
          zIndex: 5,
          text: "텍스트 입력",
          color: preset.ink,
          fontSize: 40,
          fontWeight: 700,
          align: "center"
        };
      case "shape":
        return {
          id,
          kind,
          x: 12,
          y: 18,
          width: 22,
          height: 10,
          zIndex: 1,
          opacity: 0.2,
          shape: "rect",
          fill: accentColor,
          radius: 20
        };
      case "line":
        return {
          id,
          kind,
          x1: 12,
          y1: 82,
          x2: 58,
          y2: 82,
          zIndex: 4,
          color: accentColor,
          thickness: 6
        };
      case "image":
        return {
          id,
          kind,
          x: 55,
          y: 18,
          width: 32,
          height: 24,
          zIndex: 1,
          backgroundId: imageLibrary[0]?.id ?? "",
          objectFit: "cover"
        };
      case "video":
        return {
          id,
          kind,
          x: 12,
          y: 18,
          width: 76,
          height: 42,
          zIndex: 2,
          mediaId: "",
          objectFit: "cover",
          clipStartMs: 0,
          clipEndMs: null,
          volume: 0
        };
    }
  }

  function resetSelectedOverride(): void {
    const key = String(selectedCardNumber);
    setOverrides((current) => {
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  function setSelectedBackgroundOverride(backgroundOverride: string | null | undefined): void {
    if (backgroundOverride !== undefined) {
      updateSelectedOverride({ backgroundId: backgroundOverride });
      return;
    }

    const key = String(selectedCardNumber);
    setOverrides((current) => {
      const currentOverride = current[key];
      if (!currentOverride) {
        return current;
      }
      const { backgroundId: _removed, ...restOverride } = currentOverride;
      return removeEmptyOverrides({ ...current, [key]: restOverride });
    });
  }

  function removeEmptyOverrides(input: CardOverrideMap): CardOverrideMap {
    return Object.fromEntries(
      Object.entries(input).filter(([, override]) =>
        Boolean(
          override.backgroundId !== undefined ||
            override.adjust !== undefined ||
            override.layout !== undefined ||
            override.dim !== undefined ||
            (override.badge !== undefined && !isEmptyBadgeOverride(override.badge)) ||
            override.typography !== undefined ||
            override.backgroundMedia !== undefined ||
            override.scene !== undefined ||
            override.bodyNumberMode !== undefined ||
            override.bodyNumberText !== undefined ||
            override.bodyNumberStyle !== undefined ||
            (override.semanticSlots !== undefined && Object.keys(override.semanticSlots).length > 0) ||
            (override.semanticItemPlacements !== undefined && Object.keys(override.semanticItemPlacements).length > 0) ||
            override.semanticContentKeys !== undefined ||
            (override.layers !== undefined && override.layers.length > 0)
        )
      )
    );
  }

  function isEmptyBadgeOverride(badge: CardBadgeOverride): boolean {
    return (
      badge.shape === undefined &&
      !badge.imageId &&
      badge.imageHeight === undefined &&
      badge.textColor === undefined
    );
  }

  async function exportDesignContract(): Promise<void> {
    const saved = await window.cardnews.exportTemplateFile(buildDesignContract());
    setStatus(isCardnewsError(saved) ? saved.message : `design.md 저장: ${saved}`);
  }

  function insertSampleStyleJson(): void {
    setStyleJsonInput(buildSampleStyleJson());
    setStyleWarnings([]);
    setStatus("스타일 JSON 샘플을 입력창에 넣었습니다.");
  }

  async function importCustomStyle(rawText: string, sourceLabel: string): Promise<void> {
    const existingIds = [...stylePresets.map((style) => style.id), ...customStyles.map((style) => style.id)];
    const parsed = parseStyleJson(rawText, existingIds);
    if (isCardnewsError(parsed)) {
      setStatus(parsed.message);
      return;
    }

    const updated = await window.cardnews.saveCustomStyle(parsed.preset);
    if (isCardnewsError(updated)) {
      setStatus(updated.message);
      return;
    }

    setCustomStyles(updated);
    setStyleId(parsed.preset.id);
    setStyleWarnings(parsed.warnings);
    setStyleJsonInput("");
    setStatus(`내 스타일 추가: ${parsed.preset.name} (${sourceLabel})`);
  }

  async function importCustomStyleFromText(): Promise<void> {
    await importCustomStyle(styleJsonInput, "붙여넣기");
  }

  async function importCustomStyleFromFile(): Promise<void> {
    const imported = await window.cardnews.importCustomStyleFile();
    if (isCardnewsError(imported)) {
      setStatus(imported.message);
      return;
    }

    setStyleJsonInput(imported.text);
    await importCustomStyle(imported.text, imported.fileName);
  }

  async function deleteCurrentCustomStyle(): Promise<void> {
    if (!styleId.startsWith("custom-")) {
      setStatus("내 스타일을 선택한 뒤 삭제하세요.");
      return;
    }

    const updated = await window.cardnews.deleteCustomStyle(styleId);
    if (isCardnewsError(updated)) {
      setStatus(updated.message);
      return;
    }

    setCustomStyles(updated);
    setStyleId(defaultStyleId);
    setStatus("내 스타일을 삭제했습니다.");
  }

  async function savePixabayKey(): Promise<void> {
    const trimmedApiKey = pixabayApiKeyDraft.trim();
    const nextSettings: AppSettings = {
      ...(settings.aiDefaultProviderId ? { aiDefaultProviderId: settings.aiDefaultProviderId } : {}),
      ...(settings.aiDefaultInstruction ? { aiDefaultInstruction: settings.aiDefaultInstruction } : {}),
      ...(settings.gptsTemplateBuilderUrl ? { gptsTemplateBuilderUrl: settings.gptsTemplateBuilderUrl } : {}),
      ...(trimmedApiKey ? { pixabayApiKey: trimmedApiKey } : {})
    };
    const saved = await window.cardnews.saveSettings(nextSettings);
    if (isCardnewsError(saved)) {
      setStatus(saved.message);
      return;
    }

    setSettings(nextSettings);
    setStatus(nextSettings.pixabayApiKey ? "Pixabay API 키를 저장했습니다." : "Pixabay API 키를 비웠습니다.");
  }

  async function refreshAiProviders(): Promise<void> {
    const result = await listEditionAiProviders(true);
    if (isCardnewsError(result)) {
      setAiStatus(result.message);
      setStatus(result.message);
      return;
    }

    setAiProviders(result);
    setAiProviderId((current) => chooseDefaultAiProvider(result, current));
    setAiStatus(
      result.some((provider) => provider.installed)
        ? "AI CLI 상태를 새로고침했습니다."
        : "감지된 AI CLI가 없습니다. 설치 후 새로고침하세요."
    );
  }

  async function selectAiProvider(nextProviderId: AiProviderId): Promise<void> {
    setAiProviderId(nextProviderId);
    const nextSettings: AppSettings = {
      ...settings,
      aiDefaultProviderId: nextProviderId
    };
    const saved = await window.cardnews.saveSettings(nextSettings);
    if (isCardnewsError(saved)) {
      setAiStatus(saved.message);
      setStatus(saved.message);
      return;
    }

    setSettings(nextSettings);
    setAiStatus(`기본 AI provider: ${nextProviderId}`);
  }

  async function saveGptsTemplateBuilderUrl(): Promise<void> {
    const trimmedUrl = gptsTemplateBuilderUrlDraft.trim();
    if (!isAllowedGptsTemplateBuilderUrl(trimmedUrl)) {
      setStatus("GPTs 링크는 chatgpt.com 또는 chat.openai.com의 https 주소만 저장할 수 있습니다.");
      return;
    }

    const nextSettings: AppSettings = {
      ...(settings.pixabayApiKey ? { pixabayApiKey: settings.pixabayApiKey } : {}),
      ...(settings.aiDefaultProviderId ? { aiDefaultProviderId: settings.aiDefaultProviderId } : {}),
      ...(settings.aiDefaultInstruction ? { aiDefaultInstruction: settings.aiDefaultInstruction } : {}),
      ...(trimmedUrl ? { gptsTemplateBuilderUrl: trimmedUrl } : {})
    };

    const saved = await window.cardnews.saveSettings(nextSettings);
    if (isCardnewsError(saved)) {
      setStatus(saved.message);
      return;
    }

    setSettings(nextSettings);
    setStatus(trimmedUrl ? "GPTs 바로가기 링크를 저장했습니다." : "GPTs 바로가기 링크를 비웠습니다.");
  }

  function openGptsTemplateBuilder(): void {
    const url = settings.gptsTemplateBuilderUrl?.trim();
    if (!url) {
      setStatus("GPTs 링크가 아직 설정되지 않았습니다.");
      return;
    }

    void openExternalLink(url);
  }

  async function saveAiDefaultInstruction(): Promise<void> {
    const trimmedInstruction = aiDefaultInstructionDraft.trim();
    const nextSettings: AppSettings = {
      ...(settings.pixabayApiKey ? { pixabayApiKey: settings.pixabayApiKey } : {}),
      ...(settings.aiDefaultProviderId ? { aiDefaultProviderId: settings.aiDefaultProviderId } : {}),
      ...(settings.gptsTemplateBuilderUrl ? { gptsTemplateBuilderUrl: settings.gptsTemplateBuilderUrl } : {}),
      ...(trimmedInstruction ? { aiDefaultInstruction: trimmedInstruction } : {})
    };
    const saved = await window.cardnews.saveSettings(nextSettings);
    if (isCardnewsError(saved)) {
      setAiStatus(saved.message);
      setStatus(saved.message);
      return;
    }
    setSettings(nextSettings);
    setAiDefaultInstructionDraft(trimmedInstruction);
    setAiStatus(trimmedInstruction ? "AI 기본 지시문을 저장했습니다." : "AI 기본 지시문을 비웠습니다.");
    setStatus(trimmedInstruction ? "AI 기본 지시문을 저장했습니다." : "AI 기본 지시문을 비웠습니다.");
  }

  function resetAiDefaultInstructionDraft(): void {
    setAiDefaultInstructionDraft(defaultAiInstruction);
    setAiStatus("AI 기본 지시문 초안을 기본값으로 되돌렸습니다. 저장을 누르면 적용됩니다.");
  }

  function applyAiDraft(rawText: string): void {
    const templateText = extractTemplateDocument(rawText);
    const parsed = parseDeckDocument(templateText, styleNameEntries);
    if (isCardnewsError(parsed)) {
      setAiDraftText(templateText);
      setAiStatus(`대본 파싱 실패: ${parsed.message}`);
      setStatus(`AI 대본 파싱 실패: ${parsed.message}`);
      return;
    }

    setAiDraftText(templateText);
    applyParsedDeckDocument(parsed, "AI 대본");
    setAiStatus(`AI 대본 적용: 카드 ${parsed.cards.length}장`);
    setStatus(`AI 대본 적용: 카드 ${parsed.cards.length}장`);
  }

  async function copySelectedAiInstallHint(): Promise<void> {
    const command = selectedAiProvider?.installHint;
    if (!command) {
      setAiStatus("복사할 설치 명령이 없습니다.");
      return;
    }

    try {
      await navigator.clipboard.writeText(command);
      setAiStatus("설치 명령을 클립보드에 복사했습니다.");
    } catch {
      setAiStatus(command);
    }
  }

  async function installSelectedAiProvider(recipeId: string): Promise<void> {
    if (!selectedAiProvider || selectedAiProvider.installed || aiInstallBusy) {
      return;
    }
    setAiInstallBusy(true);
    setAiStatus(`${selectedAiProvider.label} 설치 확인을 기다리는 중입니다.`);
    try {
      const result = await window.cardnews.installAiProvider(selectedAiProvider.id, recipeId);
      setAiStatus(result.message);
      if (result.ok) {
        await refreshAiProviders();
      }
    } finally {
      setAiInstallBusy(false);
    }
  }

  async function searchStockImages(): Promise<void> {
    setStockLoading(true);
    setStockFallbackUrl(null);
    try {
      const result = await window.cardnews.searchStockImages(stockQuery, 1);
      if (isCardnewsError(result)) {
        setStatus(result.message);
        return;
      }

      setStockImages(result.images);
      setStockFallbackUrl(result.fallbackUrl ?? null);
      setStatus(
        result.mode === "browser-fallback"
          ? "Pixabay 브라우저 검색을 열었습니다. 다운로드한 파일은 파일 추가로 등록하세요."
          : `Pixabay 이미지 ${result.images.length}개를 불러왔습니다.`
      );
    } finally {
      setStockLoading(false);
    }
  }

  async function addStockImageToLibrary(image: StockImage): Promise<void> {
    const input: StockImageDownloadInput = {
      provider: image.provider,
      id: image.id,
      imageUrl: image.imageUrl,
      pageUrl: image.pageUrl,
      author: image.author
    };
    const added = await window.cardnews.downloadStockImage(input);
    if (isCardnewsError(added)) {
      setStatus(added.message);
      return;
    }

    const library = await window.cardnews.listBackgroundLibrary();
    if (!isCardnewsError(library)) {
      setBackgroundLibrary(library);
    }
    setStockSearchOpen(false);
    setStatus(`Pixabay 이미지 추가: ${added.displayName} · 목록에서 선택하면 적용됩니다.`);
  }

  function startRailResize(event: ReactPointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = railWidth;
    const handlePointerMove = (moveEvent: PointerEvent): void => {
      setRailWidth(Math.min(280, Math.max(90, startWidth + moveEvent.clientX - startX)));
    };
    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  // ── 양식.md 파일 ──
  async function exportTemplate(): Promise<void> {
    const saved = await window.cardnews.exportTemplateFile(buildTemplateDocument(styleNameEntries));
    setStatus(isCardnewsError(saved) ? saved.message : `양식 파일 저장: ${saved}`);
  }

  function applyParsedDeckDocument(parsed: DeckDocument, sourceLabel: string): void {
    if (parsed.headerLabel) {
      setHeaderLabel(parsed.headerLabel);
    }
    if (parsed.footerAccount) {
      setFooterAccount(normalizeFooterAccount(parsed.footerAccount));
    }
    if (parsed.styleId) {
      setStyleId(parsed.styleId);
    }
    if (parsed.accentColor) {
      setCustomAccent(parsed.accentColor);
    }
    if (parsed.backgroundDim !== undefined) {
      setCustomDim(parsed.backgroundDim);
    }
    if (parsed.aspectRatio) {
      setAspectRatioId(parsed.aspectRatio);
    }
    setCards(parsed.cards);
    setSelectedIndex(0);
    setRenderResult(null);
    setApprovedJobId(null);
    setStatus(
      parsed.warnings.length > 0
        ? `${sourceLabel} → 카드 ${parsed.cards.length}장 · 경고: ${parsed.warnings[0]}`
        : `${sourceLabel} → 카드 ${parsed.cards.length}장을 불러왔습니다.`
    );
  }

  async function importFromFile(): Promise<void> {
    const document = await window.cardnews.importDeckDocument();
    if (isCardnewsError(document)) {
      setStatus(document.message);
      return;
    }

    const parsed = parseDeckDocument(document.text, styleNameEntries);
    if (isCardnewsError(parsed)) {
      setStatus(`${document.fileName}: ${parsed.message}`);
      return;
    }

    applyParsedDeckDocument(parsed, document.fileName);
  }

  async function importTemplatePack(): Promise<void> {
    const imported = await window.cardnews.importTemplatePack();
    if (isCardnewsError(imported)) {
      setStatus(imported.message);
      return;
    }

    const [backgrounds, images, fonts, styles, nextPresets] = await Promise.all([
      window.cardnews.listBackgroundLibrary(),
      listEditionImages(),
      window.cardnews.listFontLibrary(),
      window.cardnews.listCustomStyles(),
      window.cardnews.listDeckPresets()
    ]);
    if (!isCardnewsError(backgrounds)) {
      setBackgroundLibrary(backgrounds);
    }
    if (!isCardnewsError(images)) {
      setImageLibrary(images);
    }
    if (!isCardnewsError(fonts)) {
      setFontLibrary(fonts);
    }
    if (!isCardnewsError(styles)) {
      setCustomStyles(styles);
    }
    if (!isCardnewsError(nextPresets)) {
      setPresets(nextPresets);
      setSelectedPresetName(imported.presetName);
      setPresetName(imported.presetName);
    }

    applySnapshot(imported.workspace);
    await loadFontCss(imported.workspace.fontId ?? null);
    await refreshImageLibraryWithPreviews(null);
    setRenderResult(null);
    setBulkResult(null);
    setApprovedJobId(null);
    setStatus(
      imported.warnings.length > 0
        ? `템플릿팩 적용: 카드 ${imported.cardCount}장 · 경고: ${imported.warnings[0]}`
        : `템플릿팩 적용: 카드 ${imported.cardCount}장, 배경 ${imported.backgroundCount}개, 이미지 ${imported.assetCount}개`
    );
  }

  // ── 양식 프리셋 ──
  async function savePreset(): Promise<void> {
    const name = presetName.trim();
    if (!name) {
      setStatus("저장할 양식 이름을 입력하세요.");
      return;
    }

    const deckPreset: DeckPreset = {
      name,
      headerLabel,
      footerAccount: normalizeFooterAccount(footerAccount) || defaultFooterAccount,
      chrome: chromeConfig,
      styleId,
      aspectRatio: aspectRatioId,
      backgroundMedia,
      mediaAssets,
      videoProjectMode,
      sceneDefaults,
      bodyNumberDefault,
      nextHint: nextHintConfig,
      ...(customAccent ? { accentColor: customAccent } : {}),
      ...(customDim !== null ? { backgroundDim: customDim } : {}),
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      ...(bulkBindings ? { bulkBindings } : {}),
      cards
    };

    const updated = await window.cardnews.saveDeckPreset(deckPreset);
    if (isCardnewsError(updated)) {
      setStatus(updated.message);
      return;
    }

    setPresets(updated);
    setSelectedPresetName(name);
    setStatus(`양식 "${name}"을(를) 저장했습니다.`);
  }

  function applyPresetByName(name: string): void {
    setSelectedPresetName(name);
    if (!name) {
      return;
    }

    const deckPreset = presets.find((entry) => entry.name === name);
    if (!deckPreset) {
      return;
    }

    setPresetName(deckPreset.name);
    applySnapshot(deckPreset);
    void loadFontCss(deckPreset.fontId ?? null);
    setRenderResult(null);
    setApprovedJobId(null);
    setStatus(`양식 "${name}"을(를) 적용했습니다.`);
  }

  async function deletePreset(): Promise<void> {
    if (!selectedPresetName) {
      setStatus("삭제할 양식을 먼저 선택하세요.");
      return;
    }

    const updated = await window.cardnews.deleteDeckPreset(selectedPresetName);
    if (isCardnewsError(updated)) {
      setStatus(updated.message);
      return;
    }

    setPresets(updated);
    setStatus(`양식 "${selectedPresetName}"을(를) 삭제했습니다.`);
    setSelectedPresetName("");
  }

  // ── 카드 편집 ──
  function updateCard(index: number, value: string): void {
    setCards((current) => current.map((card, cardIndex) => (cardIndex === index ? value : card)));
  }

  function updateStructuredCard(updater: (card: Card) => Card): void {
    if (!selectedEditorCard) {
      return;
    }

    updateCard(selectedIndex, serializeCard(updater(selectedEditorCard)));
  }

  function updateStructuredCardType(value: string): void {
    const type = parseEditorCardType(value);
    updateStructuredCard((card) => ({ ...card, type }));
  }

  function updateStructuredTitle(value: string): void {
    updateStructuredCard((card) => ({ ...card, title: value }));
  }

  function updateStructuredOptionalField(
    field: "badge" | "subtitle" | "source" | "emphasis",
    value: string
  ): void {
    updateStructuredCard((card) => setOptionalCardField(card, field, value));
  }

  function updateStructuredParagraph(index: number, value: string): void {
    updateStructuredCard((card) => ({
      ...card,
      paragraphs: card.paragraphs.map((paragraph, paragraphIndex) =>
        paragraphIndex === index ? value : paragraph
      )
    }));
  }

  function addStructuredParagraph(): void {
    updateStructuredCard((card) => ({
      ...card,
      paragraphs: [...card.paragraphs, "새 문단"]
    }));
  }

  function removeStructuredParagraph(index: number): void {
    updateStructuredCard((card) => ({
      ...card,
      paragraphs: card.paragraphs.filter((_, paragraphIndex) => paragraphIndex !== index)
    }));
  }

  function updateStructuredBullet(index: number, value: string): void {
    updateStructuredCard((card) => ({
      ...card,
      bullets: card.bullets.map((bullet, bulletIndex) => (bulletIndex === index ? value : bullet))
    }));
  }

  function addStructuredBullet(): void {
    updateStructuredCard((card) => ({
      ...card,
      bullets: [...card.bullets, "새 불릿"]
    }));
  }

  function removeStructuredBullet(index: number): void {
    updateStructuredCard((card) => ({
      ...card,
      bullets: card.bullets.filter((_, bulletIndex) => bulletIndex !== index)
    }));
  }

  function addCard(): void {
    if (cards.length >= maxCards) {
      setStatus(`카드는 최대 ${maxCards}장까지 만들 수 있습니다.`);
      return;
    }
    runPageOperation("insert-after", cards.length - 1);
  }

  function removeCard(): void {
    if (cards.length <= 1) {
      setStatus("카드는 최소 1장이 필요합니다.");
      return;
    }

    runPageOperation("delete", selectedIndex);
  }

  function applyPageOperationResult(result: PageOperationResult): void {
    setCards(result.cards.map((card) => serializeCard(card)));
    setOverrides(result.overrides ?? {});
    setBulkBindings(result.bulkBindings);
    setSelectedIndex(result.selectedIndex);
    setSelectedLayerId(null);
    setEditingLayerId(null);
    setEditingLayerText("");
    if (result.warnings.length > 0) setStatus(result.warnings.join(" "));
  }

  function runPageOperation(
    operation: "insert-before" | "insert-after" | "duplicate" | "delete",
    targetIndex: number
  ): void {
    if (operation !== "delete" && cards.length >= maxCards) {
      setStatus(`카드는 최대 ${maxCards}장까지 만들 수 있습니다.`);
      return;
    }
    if (operation === "delete" && cards.length <= 1) {
      setStatus("카드는 최소 1장이 필요합니다.");
      return;
    }
    if (
      operation === "delete" &&
      cards[targetIndex]?.trim() &&
      !window.confirm(`${targetIndex + 1}페이지를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)
    ) {
      return;
    }

    const input = {
      cards: parsedEntries.map((entry) => entry.card),
      overrides,
      ...(bulkBindings ? { bulkBindings } : {}),
      idFactory: (sourceId: string) => `${sourceId}-copy-${crypto.randomUUID()}`,
      bindingKeyFactory: (sourceKey: string, context: { readonly existingKeys: ReadonlySet<string> }) => {
        const base = `${sourceKey}_copy`;
        let candidate = base;
        let suffix = 2;
        while (context.existingKeys.has(candidate)) candidate = `${base}_${suffix++}`;
        return candidate;
      }
    };
    const result =
      operation === "insert-before"
        ? insertPageBefore(input, targetIndex)
        : operation === "insert-after"
          ? insertPageAfter(input, targetIndex)
          : operation === "duplicate"
            ? duplicatePage(input, targetIndex)
            : deletePage(input, targetIndex);
    applyPageOperationResult(result);
    setPageContextMenu(null);
    const focusIndex =
      operation === "insert-before"
        ? Math.min(targetIndex + 1, result.cards.length - 1)
        : operation === "delete"
          ? Math.min(targetIndex, result.cards.length - 1)
          : targetIndex;
    queueMicrotask(() => thumbnailRefs.current[focusIndex]?.focus());
  }

  function resetWorkspace(): void {
    if (!window.confirm("모든 카드와 설정을 처음 샘플로 되돌릴까요?")) {
      return;
    }

    setCards(initialCards);
    setHeaderLabel(defaultHeaderLabel);
    setFooterAccount(defaultFooterAccount);
    setChromeConfig(defaultChromeConfig);
    setStyleId(defaultStyleId);
    setAspectRatioId(defaultAspectRatioId);
    setCustomAccent(null);
    setCustomDim(null);
    setSelectedFontId(null);
    setNextHintConfig({ kind: "arrows" });
    setVideoProjectMode("cards");
    setBackgroundMedia({ mode: "none" });
    setMediaAssets([]);
    setMediaPreviews({});
    setSceneDefaults(defaultCardSceneSettings);
    setTimelinePlayheadMs(0);
    void loadFontCss(null);
    setOverrides({});
    setBulkBindings(undefined);
    layerClipboardRef.current = createLayerClipboardState();
    setEditMode(false);
    setSelectedLayerId(null);
    setEditingLayerId(null);
    setEditingLayerText("");
    setSelectedIndex(0);
    setRenderResult(null);
    setBulkResult(null);
    setApprovedJobId(null);
    setSelectedPresetName("");
    void applyBackgroundSelection(null);
    setStatus("초기 샘플로 되돌렸습니다.");
  }

  // ── 렌더/내보내기 ──
  async function runGenerate(): Promise<void> {
    if (isRendering) {
      return;
    }

    try {
      setIsRendering(true);
      setRenderResult(null);
      setApprovedJobId(null);

      const liveErrors = cards
        .map((rawText, index) => parseCardText(rawText, index + 1))
        .filter(isCardnewsError);
      if (liveErrors.length > 0) {
        setStatus(`파싱 오류 ${liveErrors.length}개 — 카드 내용을 확인하세요.`);
        return;
      }

      setStatus("파싱 완료 · Deck 저장 중...");
      const savedDeck = await window.cardnews.saveDeck(buildDeckDraft());
      if (isCardnewsError(savedDeck)) {
        setStatus(`저장 실패: ${savedDeck.message}`);
        return;
      }

      setStatus(`렌더링 중... 1/${cards.length}`);
      const rendered = await window.cardnews.renderDeck(savedDeck.id);
      if (isCardnewsError(rendered)) {
        setStatus(`렌더 실패: ${rendered.message}`);
        return;
      }

      setRenderResult(rendered);
      setStatus(
        rendered.gateReport.status === "fail"
          ? `게이트 실패: ${rendered.gateReport.issues.length}개`
          : rendered.gateReport.status === "warn"
            ? `렌더 완료: ${rendered.cardCount}장 (경고 ${rendered.gateReport.issues.length}개)`
            : `렌더 완료: ${rendered.cardCount}장 (승인 대기)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";

      setStatus(`렌더 실패: ${message}`);
    } finally {
      setIsRendering(false);
    }
  }

  async function openOutputFolder(): Promise<void> {
    if (!renderResult) {
      return;
    }

    const result = await window.cardnews.openOutputFolder(renderResult.jobId);
    if (isCardnewsError(result)) {
      setStatus(result.message);
    }
  }

  async function exportCurrentCardPng(): Promise<void> {
    if (!renderResult) {
      return;
    }

    const target =
      renderResult.cards.find((card) => card.index === selectedIndex + 1) ?? renderResult.cards[0];
    if (!target) {
      return;
    }

    const saved = await window.cardnews.exportCardPng(renderResult.jobId, target.fileName);
    setStatus(isCardnewsError(saved) ? saved.message : `PNG 저장: ${saved}`);
  }

  async function exportZip(): Promise<void> {
    if (!renderResult) {
      return;
    }

    const saved = await window.cardnews.exportDeckZip(renderResult.jobId);
    setStatus(isCardnewsError(saved) ? saved.message : `ZIP 저장: ${saved}`);
  }

  async function saveProjectArchiveFile(): Promise<void> {
    const savedWorkspace = await window.cardnews.saveWorkspace(buildWorkspaceState());
    if (isCardnewsError(savedWorkspace)) {
      setStatus(savedWorkspace.message);
      return;
    }

    const saved = await saveEditionProject();
    setStatus(isCardnewsError(saved) ? saved.message : `프로젝트 저장: ${saved.filePath}`);
  }

  async function loadProjectArchiveFile(): Promise<void> {
    const imported = await loadEditionProject();
    if (isCardnewsError(imported)) {
      setStatus(imported.message);
      return;
    }

    const [backgrounds, fonts, styles, nextPresets] = await Promise.all([
      window.cardnews.listBackgroundLibrary(),
      window.cardnews.listFontLibrary(),
      window.cardnews.listCustomStyles(),
      window.cardnews.listDeckPresets()
    ]);
    if (!isCardnewsError(backgrounds)) {
      setBackgroundLibrary(backgrounds);
    }
    if (!isCardnewsError(fonts)) {
      setFontLibrary(fonts);
    }
    if (!isCardnewsError(styles)) {
      setCustomStyles(styles);
    }
    if (!isCardnewsError(nextPresets)) {
      setPresets(nextPresets);
    }

    applySnapshot(imported.workspace);
    await loadFontCss(imported.workspace.fontId ?? null);
    setRenderResult(null);
    setBulkResult(null);
    setApprovedJobId(null);
    setStatus(`프로젝트 열기: ${imported.filePath}`);
  }

  function getBulkBinding(target: BulkBindingTarget) {
    const identity = JSON.stringify(target);
    return bulkBindings?.bindings.find((binding) => JSON.stringify(binding.target) === identity);
  }

  function updateBulkBinding(
    target: BulkBindingTarget,
    patch: Partial<Pick<BulkBindingMetadata["bindings"][number], "key" | "label">>
  ): void {
    const identity = JSON.stringify(target);
    setBulkBindings((current) => {
      if (!current) return current;
      return {
        ...current,
        templateRevision: current.templateRevision + 1,
        bindings: current.bindings.map((binding) =>
          JSON.stringify(binding.target) === identity ? { ...binding, ...patch } : binding
        )
      };
    });
  }

  function toggleBulkBinding(target: BulkBindingTarget, label: string, defaultValue: string): void {
    setBulkBindings((current) => {
      const metadata: BulkBindingMetadata =
        current ?? {
          schemaVersion: 1,
          templateId: `workspace-${crypto.randomUUID()}`,
          templateRevision: 0,
          bindings: []
        };
      const identity = JSON.stringify(target);
      const existing = metadata.bindings.find((binding) => JSON.stringify(binding.target) === identity);
      const bindings = existing
        ? metadata.bindings.filter((binding) => binding !== existing)
        : [
            ...metadata.bindings,
            {
              key: createBulkBindingKey(target, metadata.bindings.map((binding) => binding.key)),
              label,
              required: false,
              defaultValue,
              target
            }
          ];
      return { ...metadata, templateRevision: metadata.templateRevision + 1, bindings };
    });
  }

  function renderBulkBindingControl(
    target: BulkBindingTarget,
    label: string,
    defaultValue: string,
    key: string
  ): ReactElement {
    const binding = getBulkBinding(target);
    const duplicateKey =
      binding !== undefined &&
      (bulkBindings?.bindings.some((candidate) => candidate !== binding && candidate.key === binding.key) ?? false);
    const invalidKey = binding !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(binding.key);
    return (
      <div className="bulk-binding-control" key={key}>
        <label className="check-row compact">
          <input
            type="checkbox"
            checked={binding !== undefined}
            onChange={() => toggleBulkBinding(target, label, defaultValue)}
          />
          <span>{label}</span>
        </label>
        {binding ? (
          <div className="bulk-binding-editor">
            <label>
              <span>CSV 변수 키</span>
              <input
                type="text"
                value={binding.key}
                aria-invalid={invalidKey || duplicateKey}
                title="영문자로 시작하고 영문, 숫자, 밑줄만 사용할 수 있습니다."
                onChange={(event) => updateBulkBinding(target, { key: event.target.value })}
              />
            </label>
            <label>
              <span>표시 이름</span>
              <input
                type="text"
                value={binding.label}
                aria-invalid={binding.label.trim().length === 0}
                onChange={(event) => updateBulkBinding(target, { label: event.target.value })}
              />
            </label>
            {invalidKey || duplicateKey ? (
              <span className="field-error">{duplicateKey ? "중복된 변수 키입니다." : "영문자로 시작하는 키를 입력하세요."}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  async function exportBulkTemplate(): Promise<void> {
    if (!bulkBindings || bulkBindings.bindings.length === 0) {
      setStatus("대량 생성에 사용할 항목을 먼저 선택하세요.");
      return;
    }
    const saved = await saveEditionBulkTemplate(styleId, aspectRatioId, bulkBindings);
    setStatus(isCardnewsError(saved) ? saved.message : `CSV 템플릿 저장: ${saved}`);
  }

  async function importBulkCsv(): Promise<void> {
    const imported = await loadEditionBulkInput();
    if (isCardnewsError(imported)) {
      setStatus(imported.message);
      return;
    }

    setBulkCsvText(imported.text);
    setBulkResult(null);
    setStatus(`CSV 불러오기: ${imported.fileName}`);
  }

  async function runBulkGenerate(): Promise<void> {
    if (isRendering) {
      return;
    }

    try {
      setIsRendering(true);
      setStatus("CSV 대량 생성 중...");
      const isTemplateV2 = bulkCsvText.includes("kkongdon.cardnews.bulk.v2");
      if (isTemplateV2 && (!bulkBindings || bulkBindings.bindings.length === 0)) {
        setStatus("이 CSV에 연결된 양식 바인딩이 없습니다. 양식을 다시 적용하거나 항목을 선택하세요.");
        return;
      }
      const result = await runEditionBulkRender(
        bulkCsvText,
        isTemplateV2 ? buildWorkspaceState() : undefined,
        isTemplateV2 ? bulkBindings : undefined
      );
      if (isCardnewsError(result)) {
        setStatus(`CSV 대량 생성 실패: ${result.message}`);
        return;
      }

      setBulkResult(result);
      setStatus(`CSV 대량 생성 완료: 성공 ${result.renderedCount}건 · 실패 ${result.failedCount}건`);
    } finally {
      setIsRendering(false);
    }
  }

  function approveRenderResult(): void {
    if (!renderResult) {
      return;
    }

    setApprovedJobId(renderResult.jobId);
    setStatus(`승인 완료: ${renderResult.cardCount}장`);
  }

  function buildDeckDraft(): DeckDraft {
    return {
      headerLabel,
      footerAccount: normalizeFooterAccount(footerAccount) || defaultFooterAccount,
      chrome: chromeConfig,
      styleId,
      accentColor,
      backgroundDim,
      aspectRatio: aspectRatioId,
      backgroundMedia,
      mediaAssets,
      videoProjectMode,
      sceneDefaults,
      bodyNumberDefault,
      nextHint: nextHintConfig,
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      cards: cards.map((rawText, index) => ({
        index: index + 1,
        rawText
      }))
    };
  }

  function buildWorkspaceState(): WorkspaceState {
    return {
      headerLabel,
      footerAccount: normalizeFooterAccount(footerAccount) || defaultFooterAccount,
      chrome: chromeConfig,
      styleId,
      aspectRatio: aspectRatioId,
      backgroundMedia,
      mediaAssets,
      videoProjectMode,
      sceneDefaults,
      bodyNumberDefault,
      nextHint: nextHintConfig,
      ...(customAccent ? { accentColor: customAccent } : {}),
      ...(customDim !== null ? { backgroundDim: customDim } : {}),
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      ...(bulkBindings ? { bulkBindings } : {}),
      railWidth,
      cards,
      selectedIndex
    };
  }

  return (
    <main
      className="studio"
      data-smoke-edition={editionKind}
      data-smoke-workspace-ready={workspaceHydrated ? "true" : "false"}
    >
      {fontCss ? <style>{fontCss}</style> : null}
      <header className="topbar">
        <button type="button" className="brand brand-button" onClick={() => setInfoOpen(true)}>
          <strong>{editionProductName}</strong>
          <span>정보형 카드뉴스 제작기</span>
        </button>
        <label className="topbar-field">
          <span>스타일</span>
          <select className="topbar-style-select" value={styleId} onChange={(event) => setStyleId(event.target.value)}>
            {allStyleEntries.map((style) => (
              <option key={style.id} value={style.id}>
                {style.group} · {style.name}
              </option>
            ))}
          </select>
        </label>
        <label className="topbar-field">
          <span>비율</span>
          <select
            className="topbar-ratio-select"
            value={aspectRatioId}
            onChange={(event) => setAspectRatioId(event.target.value)}
          >
            {aspectRatios.map((ratio) => (
              <option key={ratio.id} value={ratio.id}>
                {ratio.name}
              </option>
            ))}
          </select>
        </label>
        <label className="topbar-field">
          <span>헤더</span>
          <input value={headerLabel} onChange={(event) => setHeaderLabel(event.target.value)} />
        </label>
        <label className="topbar-field">
          <span>푸터</span>
          <input
            data-smoke-role="footer-input"
            value={footerAccount}
            onChange={(event) => setFooterAccount(event.target.value)}
          />
        </label>
        <div className="topbar-actions">
          <button
            type="button"
            className="credit-pill threads-pill"
            data-smoke-role="threads-link"
            data-smoke-url={threadsUrl}
            aria-label={`Threads ${threadsDisplay} 열기`}
            title={`Threads ${threadsDisplay}`}
            onClick={() => void openExternalLink(threadsUrl)}
          >
            @
          </button>
          <button
            type="button"
            className="ghost inquiry-link"
            data-smoke-role="kakao-inquiry-link"
            onClick={() => void openExternalLink(kakaoInquiryUrl)}
          >
            AX문의/강의 문의
          </button>
          <button
            type="button"
            className="ghost"
            data-smoke-action="open-ai-panel"
            onClick={() => {
              setAiPanelOpen(true);
              if (!hasProTools) {
                void requestLockedFeature("ai_panel");
              }
            }}
          >
            AI
          </button>
          <button type="button" className="ghost" data-smoke-action="reset-workspace" onClick={resetWorkspace}>
            초기화
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setExportDialogOpen(true)}
            disabled={isRendering || isVideoExporting}
            data-smoke-action="open-export-dialog"
          >
            {isRendering || isVideoExporting ? "내보내는 중..." : "내보내기"}
          </button>
        </div>
      </header>

      <div className="panes" style={{ gridTemplateColumns: `${railWidth}px 6px 1fr 360px` }}>
        <aside className="slide-rail" aria-label="slide thumbnails">
          {previewHtmls.map((html, index) => (
            <button
              type="button"
              key={index}
              ref={(element) => {
                thumbnailRefs.current[index] = element;
              }}
              className={`slide-thumb${index === selectedIndex ? " active" : ""}${
                parsedEntries[index]?.error ? " has-error" : ""
              }`}
              aria-haspopup="menu"
              onClick={() => setSelectedIndex(index)}
              onContextMenu={(event) => {
                event.preventDefault();
                setPageContextMenu({ index, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setPageContextMenu({ index, x: rect.right - 8, y: rect.top + 24 });
                }
              }}
            >
              <span className="slide-no">{index + 1}</span>
              <span
                className="thumb-canvas"
                style={{
                  width: Math.max(58, railWidth - 56),
                  height: Math.round((Math.max(58, railWidth - 56) * cardRatio.height) / cardRatio.width)
                }}
              >
                <iframe
                  title={`card-${index + 1}`}
                  sandbox="allow-same-origin"
                  srcDoc={html}
                  scrolling="no"
                  tabIndex={-1}
                  onLoad={(event) => {
                    const document = event.currentTarget.contentDocument;
                    if (document) {
                      void prepareSemanticItemPlacements(document);
                    }
                  }}
                  style={{
                    width: cardRatio.width,
                    height: cardRatio.height,
                    transform: `scale(${(Math.max(58, railWidth - 56) / cardRatio.width).toFixed(5)})`
                  }}
                />
              </span>
            </button>
          ))}
          <button type="button" className="rail-add" onClick={addCard}>
            + 카드 추가
          </button>
        </aside>
        {pageContextMenu ? (
          <div
            className="page-context-menu"
            role="menu"
            aria-label={`${pageContextMenu.index + 1}페이지 메뉴`}
            style={{
              left: Math.max(8, Math.min(pageContextMenu.x, window.innerWidth - 210)),
              top: Math.max(8, Math.min(pageContextMenu.y, window.innerHeight - 210))
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => runPageOperation("insert-before", pageContextMenu.index)}>
              앞에 페이지 추가
            </button>
            <button type="button" role="menuitem" onClick={() => runPageOperation("insert-after", pageContextMenu.index)}>
              뒤에 페이지 추가
            </button>
            <button type="button" role="menuitem" onClick={() => runPageOperation("duplicate", pageContextMenu.index)}>
              페이지 복제
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              disabled={cards.length <= 1}
              onClick={() => runPageOperation("delete", pageContextMenu.index)}
            >
              페이지 삭제
            </button>
          </div>
        ) : null}
        <div
          className="rail-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="thumbnail rail resize"
          onPointerDown={startRailResize}
        />

        <section className="stage" aria-label="live preview">
          <div className="stage-toolbar">
            <button
              type="button"
              aria-label="되돌리기"
              title="되돌리기 (Ctrl+Z)"
              disabled={overrideHistoryRef.current.past.length === 0}
              onClick={undoOverrideChange}
            >
              ↶
            </button>
            <button
              type="button"
              aria-label="다시 실행"
              title="다시 실행 (Ctrl+Shift+Z)"
              disabled={overrideHistoryRef.current.future.length === 0}
              onClick={redoOverrideChange}
            >
              ↷
            </button>
            <button
              type="button"
              className={editMode ? "active" : ""}
              data-smoke-action="toggle-edit-mode"
              onClick={() => setEditMode((current) => !current)}
            >
              편집 모드
            </button>
          </div>
          <StageCanvas
            html={previewHtmls[selectedIndex] ?? ""}
            cardWidth={cardRatio.width}
            cardHeight={cardRatio.height}
            editMode={editMode}
            layers={selectedLayers}
            selectedLayerId={selectedLayerId}
            semanticSlots={selectedSemanticSlots}
            selectedSemanticSlotId={selectedSemanticSlotId}
            editingLayerId={editingLayerId}
            editingSemanticSlotId={editingSemanticSlotId}
            editingText={editingLayerText}
            editingSemanticText={editingSemanticText}
            playheadMs={timelinePlayheadMs}
            sceneStartMs={compiledTimeline.scenes.find((scene) => scene.cardIndex === selectedCardNumber)?.startMs ?? 0}
            onSelectLayer={selectLayer}
            onSelectSemanticSlot={selectSemanticSlot}
            onTransformLayer={transformLayer}
            onTransformLineLayer={transformLineLayer}
            onTransformSemanticSlot={transformSemanticSlot}
            onNudgeLayer={nudgeLayer}
            onDeleteLayer={removeLayer}
            onDeleteSemanticSlot={deleteSemanticSlot}
            onClipboardCommand={handleLayerClipboardCommand}
            onStartTextEdit={startLayerTextEdit}
            onStartSemanticTextEdit={startSemanticTextEdit}
            onEditingTextChange={setEditingLayerText}
            onEditingSemanticTextChange={setEditingSemanticText}
            onCommitTextEdit={commitLayerTextEdit}
            onCommitSemanticTextEdit={commitSemanticTextEdit}
            onCancelTextEdit={cancelLayerTextEdit}
            onCancelSemanticTextEdit={cancelSemanticTextEdit}
          />
          <div className="video-project-mode">
            <label>
              <input
                type="checkbox"
                checked={videoProjectMode === "video"}
                onChange={(event) => setVideoProjectMode(event.target.checked ? "video" : "cards")}
              />
              영상 만들기
            </label>
            <small>{videoProjectMode === "video" ? "카드별 시간과 전환을 사용합니다." : "PNG 카드 편집 모드입니다."}</small>
          </div>
          {videoProjectMode === "video" ? (
          <section className="m23-timeline" data-smoke-role="m23-timeline" aria-label="영상 타임라인">
            <div className="m23-timeline-heading">
              <strong>타임라인</strong>
              <span>{formatDuration(compiledTimeline.durationMs)} · {compiledTimeline.frameCount} 프레임</span>
            </div>
            <div className="m23-timeline-track" role="list" aria-label="카드 장면">
              {compiledTimeline.scenes.map((scene) => (
                <div
                  key={scene.id}
                  role="listitem"
                  className={scene.cardIndex === selectedCardNumber ? "active" : ""}
                  style={{
                    width: `${Math.max(3, (scene.durationMs / Math.max(1, compiledTimeline.durationMs)) * 100)}%`
                  }}
                  onClick={() => {
                    setSelectedIndex(Math.max(0, scene.cardIndex - 1));
                    setTimelinePlayheadMs(scene.startMs);
                  }}
                >
                  <span>{scene.cardIndex}</span>
                  <label onClick={(event) => event.stopPropagation()}>
                    <span className="sr-only">{scene.cardIndex}번 카드 노출 시간(초)</span>
                    <input
                      type="number"
                      min={0.5}
                      max={180}
                      step={0.1}
                      value={Number((scene.durationMs / 1000).toFixed(1))}
                      onChange={(event) =>
                        updateCardScene(scene.cardIndex, {
                          durationMode: "fixed",
                          durationMs: Number(event.target.value) * 1000
                        })
                      }
                    />
                    <small>초</small>
                  </label>
                  {scene.transition !== "none" && scene.transitionMs > 0 ? (
                    <i title={`${scene.transition} ${scene.transitionMs}ms`}>{scene.transition === "fade" ? "F" : "S"}</i>
                  ) : null}
                </div>
              ))}
            </div>
            <label className="m23-playhead">
              <span>재생 위치 {formatDuration(timelinePlayheadMs)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, compiledTimeline.durationMs)}
                step={1000 / 30}
                value={Math.min(timelinePlayheadMs, compiledTimeline.durationMs)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setTimelinePlayheadMs(next);
                  if (compiledTimeline.scenes.length > 0) {
                    const scene = findCompiledSceneAt(compiledTimeline, next);
                    setSelectedIndex(Math.max(0, scene.cardIndex - 1));
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Home") setTimelinePlayheadMs(0);
                  if (event.key === "End") setTimelinePlayheadMs(compiledTimeline.durationMs);
                }}
              />
            </label>
          </section>
          ) : null}
          {isEditorToolbarVisible(editorToolbarTarget) ? (
            <div className="floating-editor-toolbar" data-smoke-role="floating-editor-toolbar">
              {editorToolbarTarget?.kind === "text-layer" && selectedTextLayer ? (
                <div className="floating-editor-toolbar-content" data-toolbar-target="text-layer">
                  <label className="toolbar-field">
                    <span>글자색</span>
                    <input
                      type="color"
                      value={selectedTextLayer.color ?? preset.ink}
                      onChange={(event) => updateTextLayerWithToolbar({ color: event.target.value })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>글자 투명도</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={selectedTextLayer.textOpacity ?? 100}
                      onChange={(event) => updateTextLayerWithToolbar({ textOpacity: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>크기</span>
                    <input
                      type="number"
                      min={8}
                      max={220}
                      value={Math.round(selectedTextLayer.fontSize ?? 40)}
                      onChange={(event) => updateTextLayerWithToolbar({ fontSize: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>굵기</span>
                    <input
                      type="number"
                      min={100}
                      max={950}
                      step={50}
                      value={selectedTextLayer.fontWeight ?? 700}
                      onChange={(event) => updateTextLayerWithToolbar({ fontWeight: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-check">
                    <input
                      type="checkbox"
                      checked={selectedTextLayer.italic === true}
                      onChange={(event) => updateTextLayerWithToolbar({ italic: event.target.checked })}
                    />
                    <span>기울임</span>
                  </label>
                  <select
                    aria-label="텍스트 정렬"
                    value={selectedTextLayer.align ?? "left"}
                    onChange={(event) =>
                      updateTextLayerWithToolbar({ align: event.target.value as "left" | "center" | "right" })
                    }
                  >
                    <option value="left">왼쪽</option>
                    <option value="center">가운데</option>
                    <option value="right">오른쪽</option>
                  </select>
                </div>
              ) : editorToolbarTarget?.kind === "body-number" ? (
                <div className="floating-editor-toolbar-content" data-toolbar-target="body-number">
                  <label className="toolbar-field">
                    <span>번호 색상</span>
                    <input
                      type="color"
                      value={normalizeHexColor(selectedOverride?.bodyNumberStyle?.color ?? accentColor) ?? "#000000"}
                      onChange={(event) => updateBodyNumberWithToolbar({ color: event.target.value })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>투명도</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={selectedOverride?.bodyNumberStyle?.textOpacity ?? 100}
                      onChange={(event) => updateBodyNumberWithToolbar({ textOpacity: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>크기</span>
                    <input
                      type="number"
                      min={8}
                      max={220}
                      value={Math.round(selectedOverride?.bodyNumberStyle?.fontSize ?? 92)}
                      onChange={(event) => updateBodyNumberWithToolbar({ fontSize: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>굵기</span>
                    <input
                      type="number"
                      min={100}
                      max={950}
                      step={50}
                      value={selectedOverride?.bodyNumberStyle?.fontWeight ?? 900}
                      onChange={(event) => updateBodyNumberWithToolbar({ fontWeight: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-check">
                    <input
                      type="checkbox"
                      checked={selectedOverride?.bodyNumberStyle?.italic === true}
                      onChange={(event) => updateBodyNumberWithToolbar({ italic: event.target.checked })}
                    />
                    <span>기울임</span>
                  </label>
                  <select
                    aria-label="본문 번호 정렬"
                    value={
                      selectedOverride?.bodyNumberStyle?.textAlign ??
                      selectedOverride?.bodyNumberStyle?.align ??
                      "left"
                    }
                    onChange={(event) =>
                      updateBodyNumberWithToolbar({
                        textAlign: event.target.value as "left" | "center" | "right"
                      })
                    }
                  >
                    <option value="left">왼쪽</option>
                    <option value="center">가운데</option>
                    <option value="right">오른쪽</option>
                  </select>
                  <button
                    type="button"
                    className="ghost"
                    data-smoke-action="duplicate-body-number"
                    onClick={duplicateSelectedBodyNumberAsTextLayer}
                  >
                    텍스트로 복제
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    data-smoke-action="reset-body-number-automatic"
                    onClick={resetSelectedBodyNumber}
                    disabled={selectedBodyNumber?.state === "automatic"}
                  >
                    자동 번호로
                  </button>
                  <button
                    type="button"
                    className="danger"
                    data-smoke-action="delete-body-number"
                    onClick={() => {
                      if (editorToolbarTarget.kind === "body-number") {
                        deleteSemanticSlot(editorToolbarTarget.slotId);
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              ) : (
                <div className="floating-editor-toolbar-content" data-toolbar-target="card-typography">
                  <label className="toolbar-field">
                    <span>글자색</span>
                    <input
                      type="color"
                      value={selectedOverride?.typography?.color ?? preset.ink}
                      onChange={(event) => updateCardTypographyWithToolbar({ color: event.target.value })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>글자 투명도</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={selectedOverride?.typography?.textOpacity ?? 100}
                      onChange={(event) => updateCardTypographyWithToolbar({ textOpacity: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>크기</span>
                    <input
                      type="number"
                      min={65}
                      max={135}
                      value={Math.round((selectedOverride?.typography?.sizeScale ?? 1) * 100)}
                      onChange={(event) =>
                        updateCardTypographyWithToolbar({ sizeScale: Number(event.target.value) / 100 })
                      }
                    />
                  </label>
                  <label className="toolbar-field compact">
                    <span>굵기</span>
                    <input
                      type="number"
                      min={100}
                      max={950}
                      step={50}
                      value={selectedOverride?.typography?.weight ?? 700}
                      onChange={(event) => updateCardTypographyWithToolbar({ weight: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toolbar-check">
                    <input
                      type="checkbox"
                      checked={selectedOverride?.typography?.italic === true}
                      onChange={(event) => updateCardTypographyWithToolbar({ italic: event.target.checked })}
                    />
                    <span>기울임</span>
                  </label>
                  <select
                    aria-label="타이포 적용 범위"
                    value={selectedOverride?.typography?.scope ?? "all"}
                    onChange={(event) => updateCardTypographyWithToolbar({ scope: parseTypographyScope(event.target.value) })}
                  >
                    <option value="all">전체</option>
                    <option value="title">제목</option>
                    <option value="body">본문</option>
                  </select>
                </div>
              )}
            </div>
          ) : null}
          <p className="stage-status">{status}</p>
        </section>

        <aside className="inspector" aria-label="editor controls">
          <div className="inspector-tabs">
            {(["content", "design", "media", "export"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                className={inspectorTab === tab ? "active" : ""}
                data-smoke-action={`inspector-${tab}`}
                onClick={() => setInspectorTab(tab)}
              >
                {tab === "design" ? "디자인" : tab === "content" ? "콘텐츠" : tab === "media" ? "미디어" : "내보내기"}
              </button>
            ))}
          </div>
          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">양식 관리</p>
            <small className="hint">카드 수, 문구, 배지, 배경, 레이어 배치를 저장하거나 GPTs 템플릿팩으로 불러옵니다.</small>
            <select
              value={selectedPresetName}
              onChange={(event) => applyPresetByName(event.target.value)}
            >
              <option value="">— 저장된 양식 선택 —</option>
              {presets.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} ({entry.cards.length}장)
                </option>
              ))}
            </select>
            <div className="inspector-action-grid template-save">
              <input
                placeholder="양식 이름"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
              />
              <button type="button" onClick={savePreset}>
                저장
              </button>
              <button type="button" className="ghost" onClick={deletePreset}>
                삭제
              </button>
            </div>
            <div className="inspector-action-grid two">
              <button type="button" onClick={exportTemplate}>
                양식.md 내보내기
              </button>
              <button type="button" onClick={importFromFile}>
                작성한 파일 불러오기
              </button>
            </div>
            <button type="button" className="ghost wide-action" data-smoke-action="import-template-pack" onClick={importTemplatePack}>
              템플릿팩 ZIP 불러오기
            </button>
          </section>

          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">포인트 색상</p>
            <div className="swatches">
              {accentSwatches.map((swatch) => (
                <button
                  type="button"
                  key={swatch}
                  className={`swatch${accentColor === swatch ? " active" : ""}`}
                  style={{ background: swatch }}
                  onClick={() => setCustomAccent(swatch)}
                  aria-label={`포인트 색상 ${swatch}`}
                />
              ))}
            </div>
            <div className="accent-custom-row">
              <input
                type="color"
                aria-label="사용자 지정 포인트 색상"
                value={normalizeHexColor(accentColor) ?? "#6C5CE7"}
                onChange={(event) => setCustomAccent(event.target.value.toUpperCase())}
              />
              <input
                type="text"
                aria-label="포인트 색상 HEX"
                value={accentDraft}
                placeholder="#6C5CE7"
                onChange={(event) => setAccentDraft(event.target.value)}
                onBlur={() => {
                  const normalized = normalizeHexColor(accentDraft);
                  if (normalized) setCustomAccent(normalized);
                  else {
                    setAccentDraft(accentColor);
                    setStatus("포인트 색상은 #RRGGBB 형식으로 입력하세요.");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const normalized = normalizeHexColor(accentDraft);
                  if (normalized) {
                    setCustomAccent(normalized);
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
            <button type="button" className="ghost" onClick={() => setCustomAccent(null)}>
              스타일 기본값
            </button>
          </section>

          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">스타일 관리</p>
            <small className="hint">색상, 폰트, 배경 분위기, 테두리 같은 시각 스타일 JSON을 등록합니다.</small>
            <div className="row">
              <button type="button" onClick={exportDesignContract}>
                design.md 내보내기
              </button>
              <button type="button" className="ghost" onClick={insertSampleStyleJson}>
                샘플 JSON
              </button>
              <button type="button" className="ghost" onClick={deleteCurrentCustomStyle}>
                내 스타일 삭제
              </button>
            </div>
            <textarea
              className="style-json-input"
              placeholder="외부 AI가 만든 스타일 JSON을 붙여넣으세요."
              value={styleJsonInput}
              onChange={(event) => setStyleJsonInput(event.target.value)}
              spellCheck={false}
            />
            <button type="button" onClick={importCustomStyleFromText}>
              JSON 스타일 등록
            </button>
            <button type="button" className="ghost" onClick={importCustomStyleFromFile}>
              .json 파일 열기
            </button>
            <div className="gpts-shortcut" data-smoke-role="gpts-shortcut">
              <small className="hint">GPTs 바로가기 링크</small>
              <input
                placeholder="https://chatgpt.com/g/..."
                value={gptsTemplateBuilderUrlDraft}
                onChange={(event) => setGptsTemplateBuilderUrlDraft(event.target.value)}
                spellCheck={false}
              />
              <div className="row">
                <button type="button" className="ghost" onClick={saveGptsTemplateBuilderUrl}>
                  링크 저장
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={openGptsTemplateBuilder}
                  disabled={!settings.gptsTemplateBuilderUrl}
                >
                  GPTs 열기
                </button>
              </div>
            </div>
            {styleWarnings.length > 0 ? (
              <ul className="warning-list">
                {styleWarnings.slice(0, 3).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">폰트</p>
            <div className="row">
              <select
                value={selectedFontId ?? ""}
                onChange={(event) => void selectFont(event.target.value === "" ? null : event.target.value)}
                data-smoke-role="font-select"
              >
                <option value="">번들 Pretendard</option>
                {fontLibrary.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.displayName}
                  </option>
                ))}
              </select>
              <button type="button" onClick={importFont}>
                ttf/otf 추가
              </button>
            </div>
            <div
              className="font-sample"
              style={{
                fontFamily: selectedFontId
                  ? '"Cardnews User Font", "Pretendard", "Malgun Gothic", sans-serif'
                  : '"Pretendard", "Malgun Gothic", sans-serif'
              }}
            >
              <span>가나다 ABC</span>
              <small>{selectedFontId ? "선택 폰트" : "Pretendard"}</small>
            </div>
          </section>

          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">배경 이미지</p>
            <div className="row">
              <select
                data-smoke-role="global-background-select"
                value={backgroundId ?? ""}
                onChange={(event) =>
                  void applyBackgroundSelection(event.target.value === "" ? null : event.target.value)
                }
              >
                <option value="">없음</option>
                {backgroundLibrary.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.id.slice(-6)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addBackground}>
                파일 추가
              </button>
              <button type="button" data-smoke-action="background-manager-open" onClick={openBackgroundManager}>
                배경 관리
              </button>
              <button type="button" onClick={() => setStockSearchOpen(true)}>
                무료 이미지 검색
              </button>
            </div>
            {backgroundPreview ? (
              <img className="background-preview" src={backgroundPreview} alt="" />
            ) : null}
            <label className="dim-row">
              <span>하단 어둡기</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(backgroundDim * 100)}
                onChange={(event) => setCustomDim(Number(event.target.value) / 100)}
              />
              <small>{Math.round(backgroundDim * 100)}%</small>
            </label>
            <small className="hint">선택한 배경은 모든 스타일의 미리보기와 PNG 렌더에 반영됩니다.</small>
            <div className="stack-field">
              <span>Pixabay API 키</span>
              <div className="row">
                <input
                  type="password"
                  placeholder="키 없이도 브라우저 검색 가능"
                  value={pixabayApiKeyDraft}
                  onChange={(event) => setPixabayApiKeyDraft(event.target.value)}
                />
                <button type="button" onClick={savePixabayKey}>
                  저장
                </button>
              </div>
              <small className="hint">
                {settings.pixabayApiKey ? "API 검색 사용 중" : "키 미입력: 브라우저 폴백 사용"}
              </small>
            </div>
          </section>

          <section className="panel grow" hidden={inspectorTab !== "content"}>
            <p className="panel-title">
              카드 {selectedIndex + 1} / {cards.length}
              {selectedEntry?.error ? <em className="error-tag">파싱 오류</em> : null}
            </p>
            <div className="segmented">
              <button
                type="button"
                className={cardEditorTab === "content" ? "active" : ""}
                data-smoke-action="card-content-tab"
                onClick={() => setCardEditorTab("content")}
              >
                내용
              </button>
              <button
                type="button"
                className={cardEditorTab === "design" ? "active" : ""}
                data-smoke-action="card-design-tab"
                onClick={() => setCardEditorTab("design")}
              >
                디자인
              </button>
            </div>
            {cardEditorTab === "content" ? (
              <>
                {selectedEditorCard ? (
                  <div className="content-form" data-smoke-role="content-form">
                    <label className="stack-field">
                      <span>유형</span>
                      <select
                        value={selectedEditorCard.type}
                        onChange={(event) => updateStructuredCardType(event.target.value)}
                      >
                        {cardTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="stack-field">
                      <span>배지</span>
                      <input
                        value={selectedEditorCard.badge ?? ""}
                        onChange={(event) => updateStructuredOptionalField("badge", event.target.value)}
                      />
                    </label>
                    <label className="stack-field">
                      <span>제목</span>
                      <textarea
                        rows={2}
                        data-smoke-role="content-title"
                        value={selectedEditorCard.title}
                        onChange={(event) => updateStructuredTitle(event.target.value)}
                      />
                    </label>
                    <label className="stack-field">
                      <span>소제목</span>
                      <textarea
                        rows={2}
                        data-smoke-role="content-subtitle"
                        value={selectedEditorCard.subtitle ?? ""}
                        onChange={(event) => updateStructuredOptionalField("subtitle", event.target.value)}
                      />
                    </label>
                    <div className="content-form-section">
                      <div className="section-row">
                        <span>본문 문단</span>
                        <button type="button" onClick={addStructuredParagraph}>
                          추가
                        </button>
                      </div>
                      {selectedEditorCard.paragraphs.map((paragraph, paragraphIndex) => (
                        <div className="item-row" key={`paragraph-${paragraphIndex}`}>
                          <textarea
                            rows={2}
                            value={paragraph}
                            onChange={(event) => updateStructuredParagraph(paragraphIndex, event.target.value)}
                          />
                          <button type="button" onClick={() => removeStructuredParagraph(paragraphIndex)}>
                            삭제
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="content-form-section">
                      <div className="section-row">
                        <span>불릿</span>
                        <button type="button" onClick={addStructuredBullet}>
                          추가
                        </button>
                      </div>
                      {selectedEditorCard.bullets.map((bullet, bulletIndex) => (
                        <div className="item-row" key={`bullet-${bulletIndex}`}>
                          <textarea
                            rows={2}
                            value={bullet}
                            onChange={(event) => updateStructuredBullet(bulletIndex, event.target.value)}
                          />
                          <button type="button" onClick={() => removeStructuredBullet(bulletIndex)}>
                            삭제
                          </button>
                        </div>
                      ))}
                    </div>
                    <label className="stack-field">
                      <span>출처</span>
                      <input
                        value={selectedEditorCard.source ?? ""}
                        onChange={(event) => updateStructuredOptionalField("source", event.target.value)}
                      />
                    </label>
                    <label className="stack-field">
                      <span>강조</span>
                      <textarea
                        rows={2}
                        value={selectedEditorCard.emphasis ?? ""}
                        onChange={(event) => updateStructuredOptionalField("emphasis", event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}
                {selectedEditorEntry.error ? (
                  <p className="parse-error-text">{selectedEditorEntry.error.message}</p>
                ) : null}
                <details className="raw-editor" open={selectedEditorCard === undefined}>
                  <summary>원문 편집</summary>
                  <textarea
                    className="card-input raw-card-input"
                    data-smoke-role="raw-card-input"
                    value={cards[selectedIndex] ?? ""}
                    onChange={(event) => updateCard(selectedIndex, event.target.value)}
                    spellCheck={false}
                  />
                </details>
                <div className="grammar-hint">
                  <span>유형: 표지|본문|마무리</span>
                  <span>제목: / 소제목: / 배지:</span>
                  <span>본문: 문단, "- "는 불릿</span>
                  <span>출처: / 강조:</span>
                  <span>필드 줄바꿈 → 원문에서는 | 로 저장</span>
                  <span>*단어* → 포인트색 강조</span>
                </div>
              </>
            ) : (
              <div className="card-design-controls">
                <div className="chrome-controls">
                  <p className="panel-title">상단/하단 바</p>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={chromeConfig.header.visible}
                      onChange={(event) => updateChromeSlot("header", { visible: event.target.checked })}
                    />
                    <span>헤더 표시</span>
                  </label>
                  <div className="layer-field-grid two">
                    <label>
                      <span>헤더 색</span>
                      <input
                        data-smoke-role="chrome-header-color"
                        type="color"
                        value={chromeConfig.header.color}
                        onChange={(event) => updateChromeSlot("header", { color: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>헤더 크기</span>
                      <input
                        type="number"
                        min={18}
                        max={48}
                        value={chromeConfig.header.fontSize}
                        onChange={(event) => updateChromeSlot("header", { fontSize: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>헤더 굵기</span>
                      <input
                        type="number"
                        min={100}
                        max={950}
                        step={50}
                        value={chromeConfig.header.fontWeight}
                        onChange={(event) => updateChromeSlot("header", { fontWeight: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <div className="layer-field-grid three">
                    <label>
                      <span>헤더 X</span>
                      <input
                        type="number"
                        min={-40}
                        max={40}
                        value={chromeConfig.header.offsetX}
                        onChange={(event) => updateChromeSlot("header", { offsetX: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>헤더 Y</span>
                      <input
                        type="number"
                        min={-40}
                        max={40}
                        value={chromeConfig.header.offsetY}
                        onChange={(event) => updateChromeSlot("header", { offsetY: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={chromeConfig.pageNumber.visible}
                      onChange={(event) => updateChromePageNumber({ visible: event.target.checked })}
                    />
                    <span>페이지 번호 표시</span>
                  </label>
                  <div className="layer-field-grid three">
                    <label>
                      <span>페이지 형식</span>
                      <select
                        data-smoke-role="chrome-page-template"
                        value={resolvePageNumberTemplateValue(chromeConfig.pageNumber.template)}
                        onChange={(event) => {
                          if (event.target.value !== customPageNumberTemplateValue) {
                            updateChromePageNumber({ template: event.target.value });
                          }
                        }}
                      >
                        {pageNumberTemplatePresets.map((preset) => (
                          <option key={preset.template} value={preset.template}>
                            {preset.label}
                          </option>
                        ))}
                        {resolvePageNumberTemplateValue(chromeConfig.pageNumber.template) ===
                        customPageNumberTemplateValue ? (
                          <option value={customPageNumberTemplateValue}>직접 입력</option>
                        ) : null}
                      </select>
                      <small>
                        예: {renderPageNumber(chromeConfig.pageNumber.template, selectedCardNumber, cards.length)}
                      </small>
                      {resolvePageNumberTemplateValue(chromeConfig.pageNumber.template) ===
                      customPageNumberTemplateValue ? (
                        <input
                          data-smoke-role="chrome-page-template-custom"
                          value={chromeConfig.pageNumber.template}
                          onChange={(event) => updateChromePageNumber({ template: event.target.value })}
                        />
                      ) : null}
                    </label>
                    <label>
                      <span>페이지 색</span>
                      <input
                        data-smoke-role="chrome-page-color"
                        type="color"
                        value={chromeConfig.pageNumber.color}
                        onChange={(event) => updateChromePageNumber({ color: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>페이지 Y</span>
                      <input
                        data-smoke-role="chrome-page-offset-y"
                        type="number"
                        min={-40}
                        max={40}
                        value={chromeConfig.pageNumber.offsetY}
                        onChange={(event) => updateChromePageNumber({ offsetY: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>페이지 크기</span>
                      <input
                        type="number"
                        min={18}
                        max={48}
                        value={chromeConfig.pageNumber.fontSize}
                        onChange={(event) => updateChromePageNumber({ fontSize: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <label className="check-row">
                    <input
                      data-smoke-role="chrome-footer-visible"
                      type="checkbox"
                      checked={chromeConfig.footer.visible}
                      onChange={(event) => updateChromeSlot("footer", { visible: event.target.checked })}
                    />
                    <span>푸터 표시</span>
                  </label>
                  <div className="layer-field-grid two">
                    <label>
                      <span>푸터 색</span>
                      <input
                        data-smoke-role="chrome-footer-color"
                        type="color"
                        value={chromeConfig.footer.color}
                        onChange={(event) => updateChromeSlot("footer", { color: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>푸터 X</span>
                      <input
                        type="number"
                        min={-40}
                        max={40}
                        value={chromeConfig.footer.offsetX}
                        onChange={(event) => updateChromeSlot("footer", { offsetX: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>푸터 Y</span>
                      <input
                        type="number"
                        min={-40}
                        max={40}
                        value={chromeConfig.footer.offsetY}
                        onChange={(event) => updateChromeSlot("footer", { offsetY: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                </div>
                <label className="stack-field">
                  <span>카드 배경</span>
                  <select
                    value={
                      selectedOverride?.backgroundId === null
                        ? "__none__"
                        : selectedOverride?.backgroundId ?? "__inherit__"
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedBackgroundOverride(
                        value === "__inherit__" ? undefined : value === "__none__" ? null : value
                      );
                    }}
                  >
                    <option value="__inherit__">전역 배경 따름</option>
                    <option value="__none__">배경 없음</option>
                    {backgroundLibrary.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName} · {item.id.slice(-6)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="m22-media-panel" data-smoke-role="card-media-panel">
                  <p className="panel-title">이 카드 이미지/영상 배경</p>
                  <div className="segmented">
                    {(["inherit", "asset", "none"] as const).map((mode) => (
                      <button
                        type="button"
                        key={mode}
                        className={selectedBackgroundMedia.mode === mode ? "active" : ""}
                        data-smoke-action={`card-media-${mode}`}
                        onClick={() =>
                          updateSelectedOverride({
                            backgroundMedia: setBackgroundMediaMode(
                              selectedBackgroundMedia,
                              mode,
                              mediaAssets[0]?.id
                            )
                          })
                        }
                      >
                        {mode === "inherit" ? "전역 따름" : mode === "asset" ? "로컬" : "없음"}
                      </button>
                    ))}
                  </div>
                  {selectedBackgroundMedia.mode === "asset" ? (
                    <label className="stack-field">
                      <span>로컬 미디어</span>
                      <select
                        data-smoke-role="card-media-select"
                        value={selectedBackgroundMedia.mediaId}
                        onChange={(event) =>
                          updateSelectedOverride({ backgroundMedia: assignBackgroundMediaAsset(event.target.value) })
                        }
                      >
                        <option value="">선택</option>
                        {mediaAssets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {mediaAssetLabel(asset)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="row">
                    <button type="button" className="ghost" onClick={() => setInspectorTab("media")}>
                      미디어에서 가져오기
                    </button>
                  </div>
                  {selectedCardMediaAsset ? <small className="hint">{mediaAssetLabel(selectedCardMediaAsset)}</small> : null}
                </div>
                <div className="m22-scene-panel" data-smoke-role="scene-controls">
                  <p className="panel-title">영상 장면</p>
                  <div className="layer-field-grid two">
                    <label>
                      <span>장면 길이 방식</span>
                      <select
                        data-smoke-role="scene-duration-mode"
                        value={selectedScene.durationMode ?? "fixed"}
                        onChange={(event) =>
                          updateSelectedScene({
                            durationMode:
                              event.target.value === "fit-primary-video" ? "fit-primary-video" : "fixed"
                          })
                        }
                      >
                        <option value="fixed">직접 지정</option>
                        <option value="fit-primary-video">영상 길이에 맞춤</option>
                      </select>
                    </label>
                    <label>
                      <span>길이(초)</span>
                      <input
                        data-smoke-role="scene-duration-ms"
                        type="number"
                        min={0.5}
                        max={180}
                        step={0.1}
                        disabled={selectedScene.durationMode === "fit-primary-video"}
                        value={Number((selectedScene.durationMs / 1000).toFixed(1))}
                        onChange={(event) =>
                          updateSelectedScene({ durationMs: Number(event.target.value) * 1000 })
                        }
                      />
                    </label>
                    <label>
                      <span>전환</span>
                      <select
                        data-smoke-role="scene-transition"
                        value={selectedScene.transition}
                        onChange={(event) =>
                          updateSelectedScene({
                            transition:
                              event.target.value === "fade" ||
                              event.target.value === "slide-left" ||
                              event.target.value === "slide-up"
                                ? event.target.value
                                : "none"
                          })
                        }
                      >
                        <option value="none">없음</option>
                        <option value="fade">페이드</option>
                        <option value="slide-left">왼쪽 슬라이드</option>
                        <option value="slide-up">위 슬라이드</option>
                      </select>
                    </label>
                    <label>
                      <span>전환(ms)</span>
                      <input
                        data-smoke-role="scene-transition-ms"
                        type="number"
                        min={0}
                        max={5000}
                        step={100}
                        value={selectedScene.transitionMs}
                        onChange={(event) => updateSelectedScene({ transitionMs: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>대표 오디오</span>
                      <select
                        data-smoke-role="scene-primary-audio"
                        value={selectedScene.primaryAudioSourceId ?? ""}
                        onChange={(event) =>
                          updateSelectedScene({ primaryAudioSourceId: event.target.value || null })
                        }
                      >
                        <option value="">없음</option>
                        {selectedAudioCandidates.map((candidate) => (
                          <option key={candidate.sourceId} value={candidate.sourceId}>
                            {candidate.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="badge-controls" data-smoke-role="badge-controls">
                  <p className="panel-title">배지</p>
                  <label className="stack-field">
                    <span>배지 모양</span>
                    <select
                      data-smoke-role="badge-shape-select"
                      value={selectedOverride?.badge?.shape ?? "__preset__"}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelectedBadgeShape(value === "__preset__" ? null : parseBadgeShape(value));
                      }}
                    >
                      <option value="__preset__">스타일 프리셋 따름</option>
                      <option value="pill">타원</option>
                      <option value="rect">사각</option>
                      <option value="none">텍스트만</option>
                    </select>
                  </label>
                  <div className="stack-field">
                    <span>이미지 배지</span>
                    <div className="image-picker-control" data-smoke-role="badge-image-control">
                      <button
                        type="button"
                        data-smoke-action="open-badge-image-picker"
                        onClick={() => openImagePicker({ kind: "badge" }, selectedOverride?.badge?.imageId ?? null)}
                      >
                        이미지 선택
                      </button>
                      {selectedOverride?.badge?.imageId ? (
                        <button type="button" className="ghost" onClick={() => setSelectedBadgeImage(null)}>
                          지우기
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {selectedOverride?.badge?.imageId && imagePreviews[selectedOverride.badge.imageId] ? (
                    <div className="image-badge-preview" data-smoke-role="badge-image-preview">
                      <img src={imagePreviews[selectedOverride.badge.imageId]} alt="" />
                    </div>
                  ) : null}
                  <div className="stack-field">
                    <span>배지 글자색</span>
                    <div className="swatches compact-swatches" data-smoke-role="badge-text-color-swatches">
                      {accentSwatches.map((swatch) => (
                        <button
                          type="button"
                          key={swatch}
                          className={`swatch${selectedOverride?.badge?.textColor === swatch ? " active" : ""}`}
                          style={{ background: swatch }}
                          aria-label={`배지 글자색 ${swatch}`}
                          onClick={() => setSelectedBadgeTextColor(swatch)}
                        />
                      ))}
                    </div>
                    <div className="row">
                      <input
                        data-smoke-role="badge-text-color-input"
                        value={selectedOverride?.badge?.textColor ?? preset.badgeInk}
                        onChange={(event) => setSelectedBadgeTextColor(event.target.value)}
                        placeholder="#141414"
                      />
                      <input
                        type="color"
                        value={selectedOverride?.badge?.textColor ?? preset.badgeInk}
                        onChange={(event) => setSelectedBadgeTextColor(event.target.value)}
                        aria-label="배지 글자색 선택"
                      />
                      <button type="button" className="ghost" onClick={() => setSelectedBadgeTextColor(null)}>
                        스타일 기본값
                      </button>
                    </div>
                  </div>
                  <label className="dim-row">
                    <span>이미지 높이</span>
                    <input
                      data-smoke-role="badge-image-height"
                      type="range"
                      min={40}
                      max={200}
                      value={selectedOverride?.badge?.imageHeight ?? 96}
                      onChange={(event) => updateSelectedBadge({ imageHeight: Number(event.target.value) })}
                    />
                    <small>{selectedOverride?.badge?.imageHeight ?? 96}px</small>
                  </label>
                  <label className="dim-row">
                    <span>배경 제거 허용치</span>
                    <input
                      type="range"
                      min={1}
                      max={96}
                      value={backgroundRemovalTolerance}
                      onChange={(event) => setBackgroundRemovalTolerance(Number(event.target.value))}
                    />
                    <small>{backgroundRemovalTolerance}</small>
                  </label>
                </div>
                <div className="next-hint-controls" data-smoke-role="next-hint-controls">
                  <p className="panel-title">넘김 기호</p>
                  <label className="stack-field">
                    <span>표시 방식</span>
                    <select
                      data-smoke-role="next-hint-kind"
                      value={nextHintConfig.kind}
                      onChange={(event) => setNextHintKind(parseNextHintKind(event.target.value))}
                    >
                      <option value="arrows">기본 화살표</option>
                      <option value="image">이미지 선택</option>
                      <option value="none">없음</option>
                    </select>
                  </label>
                  {nextHintConfig.kind === "image" ? (
                    <>
                      <div className="stack-field">
                        <span>이미지</span>
                        <div className="image-picker-control" data-smoke-role="next-hint-image-control">
                          <button
                            type="button"
                            data-smoke-action="open-next-hint-image-picker"
                            onClick={() => openImagePicker({ kind: "nextHint" }, nextHintConfig.imageId ?? null)}
                          >
                            이미지 선택
                          </button>
                          {nextHintConfig.imageId ? (
                            <button type="button" className="ghost" onClick={() => setNextHintImage(null)}>
                              지우기
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {nextHintConfig.imageId && imagePreviews[nextHintConfig.imageId] ? (
                        <div className="image-badge-preview" data-smoke-role="next-hint-image-preview">
                          <img src={imagePreviews[nextHintConfig.imageId]} alt="" />
                        </div>
                      ) : null}
                      <label className="dim-row">
                        <span>이미지 높이</span>
                        <input
                          data-smoke-role="next-hint-height"
                          type="range"
                          min={24}
                          max={72}
                          value={nextHintConfig.height ?? 40}
                          onChange={(event) => setNextHintHeight(Number(event.target.value))}
                        />
                        <small>{nextHintConfig.height ?? 40}px</small>
                      </label>
                    </>
                  ) : null}
                </div>
                <div className="typography-controls" data-smoke-role="typography-controls">
                  <p className="panel-title">타이포그래피</p>
                  <div className="toolbar-color-row" data-smoke-role="typography-color-control">
                    <label className="stack-field">
                      <span>글자색</span>
                      <input
                        type="color"
                        value={selectedOverride?.typography?.color ?? preset.ink}
                        onChange={(event) => updateSelectedTypography("color", event.target.value)}
                      />
                    </label>
                    <button type="button" className="ghost" onClick={() => updateSelectedTypography("color", undefined)}>
                      스타일 기본값
                    </button>
                  </div>
                  <label className="dim-row">
                    <span>글자 투명도</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={selectedOverride?.typography?.textOpacity ?? 100}
                      onChange={(event) => updateSelectedTypography("textOpacity", Number(event.target.value))}
                    />
                    <small>{selectedOverride?.typography?.textOpacity ?? 100}%</small>
                  </label>
                  <label className="dim-row">
                    <span>텍스트 크기</span>
                    <input
                      type="range"
                      min={65}
                      max={135}
                      value={Math.round((selectedOverride?.typography?.sizeScale ?? 1) * 100)}
                      onChange={(event) => updateSelectedTypography("sizeScale", Number(event.target.value) / 100)}
                    />
                    <small>{Math.round((selectedOverride?.typography?.sizeScale ?? 1) * 100)}%</small>
                  </label>
                  <label className="dim-row">
                    <span>굵기</span>
                    <input
                      type="range"
                      min={100}
                      max={950}
                      step={50}
                      value={selectedOverride?.typography?.weight ?? 700}
                      onChange={(event) => updateSelectedTypography("weight", Number(event.target.value))}
                    />
                    <small>{selectedOverride?.typography?.weight ?? 700}</small>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selectedOverride?.typography?.italic === true}
                      onChange={(event) => updateSelectedTypography("italic", event.target.checked)}
                    />
                    <span>기울임</span>
                  </label>
                  <label className="stack-field">
                    <span>타이포 적용 범위</span>
                    <select
                      value={selectedOverride?.typography?.scope ?? "all"}
                      onChange={(event) => updateSelectedTypography("scope", parseTypographyScope(event.target.value))}
                    >
                      <option value="all">전체</option>
                      <option value="title">제목</option>
                      <option value="body">본문</option>
                    </select>
                  </label>
                  <label className="dim-row">
                    <span>자간</span>
                    <input
                      data-smoke-role="typography-letter-spacing"
                      type="range"
                      min={-5}
                      max={10}
                      value={Math.round((selectedOverride?.typography?.letterSpacing ?? 0) * 100)}
                      onChange={(event) => updateSelectedTypography("letterSpacing", Number(event.target.value) / 100)}
                    />
                    <small>{(selectedOverride?.typography?.letterSpacing ?? 0).toFixed(2)}em</small>
                  </label>
                  <label className="dim-row">
                    <span>행간</span>
                    <input
                      data-smoke-role="typography-line-height"
                      type="range"
                      min={110}
                      max={200}
                      value={Math.round((selectedOverride?.typography?.lineHeight ?? 1.1) * 100)}
                      onChange={(event) => updateSelectedTypography("lineHeight", Number(event.target.value) / 100)}
                    />
                    <small>{Math.round((selectedOverride?.typography?.lineHeight ?? 1.1) * 100)}%</small>
                  </label>
                </div>
                <label className="dim-row">
                  <span>밝기</span>
                  <input
                    type="range"
                    min={50}
                    max={150}
                    value={Math.round((selectedOverride?.adjust?.brightness ?? 1) * 100)}
                    onChange={(event) => updateSelectedAdjust("brightness", Number(event.target.value) / 100)}
                  />
                  <small>{Math.round((selectedOverride?.adjust?.brightness ?? 1) * 100)}%</small>
                </label>
                <label className="dim-row">
                  <span>대비</span>
                  <input
                    type="range"
                    min={50}
                    max={150}
                    value={Math.round((selectedOverride?.adjust?.contrast ?? 1) * 100)}
                    onChange={(event) => updateSelectedAdjust("contrast", Number(event.target.value) / 100)}
                  />
                  <small>{Math.round((selectedOverride?.adjust?.contrast ?? 1) * 100)}%</small>
                </label>
                <label className="dim-row">
                  <span>채도</span>
                  <input
                    type="range"
                    min={50}
                    max={150}
                    value={Math.round((selectedOverride?.adjust?.saturation ?? 1) * 100)}
                    onChange={(event) => updateSelectedAdjust("saturation", Number(event.target.value) / 100)}
                  />
                  <small>{Math.round((selectedOverride?.adjust?.saturation ?? 1) * 100)}%</small>
                </label>
                <div className="segmented">
                  <button
                    type="button"
                    className={(selectedOverride?.layout?.align ?? "left") === "left" ? "active" : ""}
                    onClick={() => updateSelectedLayout("align", "left")}
                  >
                    왼쪽
                  </button>
                  <button
                    type="button"
                    className={selectedOverride?.layout?.align === "center" ? "active" : ""}
                    onClick={() => updateSelectedLayout("align", "center")}
                  >
                    중앙
                  </button>
                </div>
                <label className="stack-field">
                  <span>제목 배치</span>
                  <select
                    value={selectedOverride?.layout?.titlePlacement?.mode ?? "flow"}
                    onChange={(event) => updateSelectedTitlePlacement(event.target.value === "card-y" ? "card-y" : "flow")}
                  >
                    <option value="flow">콘텐츠 흐름에 맞춤</option>
                    <option value="card-y">카드 전체에서 직접 배치</option>
                  </select>
                </label>
                {selectedOverride?.layout?.titlePlacement?.mode === "card-y" ? (
                  <label className="dim-row">
                    <span>제목 Y</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={selectedOverride.layout.titlePlacement.y}
                      onChange={(event) => updateSelectedTitlePlacement("card-y", Number(event.target.value))}
                    />
                    <small>{selectedOverride.layout.titlePlacement.y}%</small>
                  </label>
                ) : null}
                <label className="dim-row">
                  <span>콘텐츠 묶음 위치</span>
                  <input
                    type="range"
                    min={-20}
                    max={20}
                    value={selectedOverride?.layout?.offsetY ?? 0}
                    onChange={(event) => updateSelectedLayout("offsetY", Number(event.target.value))}
                  />
                  <small>{selectedOverride?.layout?.offsetY ?? 0}</small>
                </label>
                <label className="dim-row">
                  <span>배지 간격</span>
                  <input
                    data-smoke-role="badge-gap-slider"
                    type="range"
                    min={50}
                    max={200}
                    value={Math.round((selectedOverride?.layout?.gapBadge ?? 1) * 100)}
                    onChange={(event) => updateSelectedLayout("gapBadge", Number(event.target.value) / 100)}
                  />
                  <small>{Math.round((selectedOverride?.layout?.gapBadge ?? 1) * 100)}%</small>
                </label>
                <label className="dim-row">
                  <span>본문 간격</span>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    value={Math.round((selectedOverride?.layout?.gapSubtitle ?? 1) * 100)}
                    onChange={(event) => updateSelectedLayout("gapSubtitle", Number(event.target.value) / 100)}
                  />
                  <small>{Math.round((selectedOverride?.layout?.gapSubtitle ?? 1) * 100)}%</small>
                </label>
                <label className="dim-row">
                  <span>어둡기</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round((selectedOverride?.dim ?? backgroundDim) * 100)}
                    onChange={(event) => updateSelectedOverride({ dim: Number(event.target.value) / 100 })}
                  />
                  <small>{Math.round((selectedOverride?.dim ?? backgroundDim) * 100)}%</small>
                </label>
                <div className="layer-controls" data-smoke-role="layer-controls">
                  <p className="panel-title">레이어</p>
                  <div className="inspector-action-grid four">
                    <button type="button" data-smoke-action="add-text-layer" onClick={() => addLayer("text")}>
                      텍스트 박스
                    </button>
                    <button type="button" data-smoke-action="add-shape-layer" onClick={() => addLayer("shape")}>
                      모형
                    </button>
                    <button type="button" data-smoke-action="add-line-layer" onClick={() => addLayer("line")}>
                      선
                    </button>
                    <button type="button" onClick={() => addLayer("image")}>
                      이미지
                    </button>
                    <button type="button" data-smoke-action="add-video-layer" onClick={() => addLayer("video")}>
                      영상
                    </button>
                    <button
                      type="button"
                      data-smoke-action="import-video-layer"
                      onClick={() => void importMediaForSelection("video")}
                    >
                      영상 파일
                    </button>
                  </div>
                  {selectedLayer ? (
                    <div className="selected-layer-panel" data-smoke-role={`${selectedLayer.kind}-layer-panel`}>
                      <div className="layer-editor-header">
                        <strong>{layerLabel(selectedLayer)}</strong>
                        <div className="row">
                          <button type="button" className="ghost" onClick={() => changeLayerZ("back")}>
                            뒤로
                          </button>
                          <button type="button" className="ghost" onClick={() => changeLayerZ("forward")}>
                            앞으로
                          </button>
                        </div>
                      </div>
                      <label className="dim-row">
                        <span>불투명도</span>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={Math.round((selectedLayer.opacity ?? 1) * 100)}
                          onChange={(event) =>
                            updateSelectedLayer((layer) => ({ ...layer, opacity: Number(event.target.value) / 100 }))
                          }
                        />
                        <small>{Math.round((selectedLayer.opacity ?? 1) * 100)}%</small>
                      </label>
                      {selectedLayer.kind === "text" ? (
                        <div className="selected-layer-fields">
                          <textarea
                            className="layer-text-input"
                            value={selectedLayer.text}
                            onChange={(event) =>
                              updateSelectedLayer((layer) =>
                                layer.kind === "text" ? { ...layer, text: event.target.value } : layer
                              )
                            }
                          />
                          <label className="dim-row">
                            <span>글자 투명도</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={selectedLayer.textOpacity ?? 100}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "text" ? { ...layer, textOpacity: Number(event.target.value) } : layer
                                )
                              }
                            />
                            <small>{selectedLayer.textOpacity ?? 100}%</small>
                          </label>
                          <div className="layer-field-grid three">
                            <label>
                              <span>글자 색</span>
                              <input
                                type="color"
                                value={selectedLayer.color ?? preset.ink}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "text" ? { ...layer, color: event.target.value } : layer
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>글자 크기</span>
                              <input
                                data-smoke-role="text-layer-font-size"
                                type="number"
                                min={10}
                                max={144}
                                value={selectedLayer.fontSize ?? 40}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "text"
                                      ? { ...layer, fontSize: clampIntegerControl(Number(event.target.value), 10, 144) }
                                      : layer
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>굵기</span>
                              <input
                                data-smoke-role="text-layer-font-weight"
                                type="number"
                                min={100}
                                max={950}
                                step={50}
                                value={selectedLayer.fontWeight ?? 700}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "text"
                                      ? { ...layer, fontWeight: clampLayerFontWeight(Number(event.target.value)) }
                                      : layer
                                  )
                                }
                              />
                            </label>
                          </div>
                          <div className="row">
                            <label className="check-row compact">
                              <input
                                type="checkbox"
                                checked={selectedLayer.italic === true}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "text" ? { ...layer, italic: event.target.checked } : layer
                                  )
                                }
                              />
                              <span>기울기</span>
                            </label>
                            <select
                              data-smoke-role="text-layer-align"
                              value={selectedLayer.align ?? "left"}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "text"
                                    ? {
                                        ...layer,
                                        align:
                                          event.target.value === "center"
                                            ? "center"
                                            : event.target.value === "right"
                                              ? "right"
                                              : "left"
                                      }
                                    : layer
                                )
                              }
                            >
                              <option value="left">왼쪽</option>
                              <option value="center">가운데</option>
                              <option value="right">오른쪽</option>
                            </select>
                          </div>
                        </div>
                      ) : null}
                      {selectedLayer.kind === "shape" ? (
                        <div className="layer-field-grid two" data-smoke-role="shape-layer-controls">
                          <label>
                            <span>도형 색상</span>
                            <input
                              data-smoke-role="shape-fill-color"
                              type="color"
                              value={selectedLayer.fill}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "shape" ? { ...layer, fill: event.target.value } : layer
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>모양</span>
                            <select
                              value={selectedLayer.shape}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "shape"
                                    ? { ...layer, shape: event.target.value === "ellipse" ? "ellipse" : "rect" }
                                    : layer
                                )
                              }
                            >
                              <option value="rect">사각형</option>
                              <option value="ellipse">타원</option>
                            </select>
                          </label>
                        </div>
                      ) : null}
                      {selectedLayer.kind === "line" ? (
                        <div className="layer-field-grid three" data-smoke-role="line-layer-controls">
                          <label>
                            <span>선 색상</span>
                            <input
                              data-smoke-role="line-color"
                              type="color"
                              value={selectedLayer.color}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "line" ? { ...layer, color: event.target.value } : layer
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>선 두께</span>
                            <input
                              data-smoke-role="line-stroke-width"
                              type="number"
                              min={1}
                              max={40}
                              value={selectedLayer.thickness}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "line"
                                    ? { ...layer, thickness: clampIntegerControl(Number(event.target.value), 1, 40) }
                                    : layer
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>각도</span>
                            <input
                              data-smoke-role="line-rotation"
                              type="number"
                              min={-180}
                              max={180}
                              value={Math.round(
                                getLineLayerAngle(selectedLayer, { width: cardRatio.width, height: cardRatio.height })
                              )}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "line"
                                    ? rotateLineLayer(
                                        layer,
                                        clampLayerRotation(Number(event.target.value)),
                                        { width: cardRatio.width, height: cardRatio.height }
                                      )
                                    : layer
                                )
                              }
                            />
                          </label>
                        </div>
                      ) : null}
                      {selectedLayer.kind === "image" ? (
                        <div className="selected-layer-fields" data-smoke-role="image-layer-controls">
                          <div className="image-picker-control">
                            <button
                              type="button"
                              data-smoke-action="open-layer-image-picker"
                              onClick={() =>
                                openImagePicker(
                                  { kind: "layer", layerId: selectedLayer.id },
                                  selectedLayer.backgroundId || null
                                )
                              }
                            >
                              이미지 선택
                            </button>
                            {selectedLayer.backgroundId ? (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "image" ? { ...layer, backgroundId: "" } : layer
                                  )
                                }
                              >
                                지우기
                              </button>
                            ) : null}
                          </div>
                          {selectedLayer.backgroundId && imagePreviews[selectedLayer.backgroundId] ? (
                            <div className="image-badge-preview" data-smoke-role="image-layer-preview">
                              <img src={imagePreviews[selectedLayer.backgroundId]} alt="" />
                            </div>
                          ) : null}
                          <select
                            value={selectedLayer.objectFit ?? "cover"}
                            onChange={(event) =>
                              updateSelectedLayer((layer) =>
                                layer.kind === "image"
                                  ? { ...layer, objectFit: event.target.value === "contain" ? "contain" : "cover" }
                                  : layer
                              )
                            }
                          >
                            <option value="cover">채우기</option>
                            <option value="contain">맞추기</option>
                          </select>
                        </div>
                      ) : null}
                      {selectedLayer.kind === "video" ? (
                        <div className="selected-layer-fields" data-smoke-role="video-layer-controls">
                          <label className="stack-field">
                            <span>영상 파일</span>
                            <select
                              data-smoke-role="video-layer-media-select"
                              value={selectedLayer.mediaId}
                              onChange={(event) =>
                                updateSelectedLayer((layer) =>
                                  layer.kind === "video" ? { ...layer, mediaId: event.target.value } : layer
                                )
                              }
                            >
                              <option value="">선택</option>
                              {mediaAssets
                                .filter((asset) => asset.kind === "video")
                                .map((asset) => (
                                  <option key={asset.id} value={asset.id}>
                                    {mediaAssetLabel(asset)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button type="button" className="ghost" onClick={() => setInspectorTab("media")}>
                            미디어 탭 열기
                          </button>
                          <div className="layer-field-grid two">
                            <label>
                              <span>맞춤</span>
                              <select
                                value={selectedLayer.objectFit}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "video"
                                      ? { ...layer, objectFit: event.target.value === "contain" ? "contain" : "cover" }
                                      : layer
                                  )
                                }
                              >
                                <option value="cover">채우기</option>
                                <option value="contain">맞추기</option>
                              </select>
                            </label>
                            <label>
                              <span>볼륨</span>
                              <input
                                data-smoke-role="video-layer-volume"
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={selectedLayer.volume}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "video" ? { ...layer, volume: Number(event.target.value) } : layer
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>시작(ms)</span>
                              <input
                                data-smoke-role="video-layer-clip-start"
                                type="number"
                                min={0}
                                step={100}
                                value={selectedLayer.clipStartMs}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "video"
                                      ? { ...layer, clipStartMs: Math.max(0, Number(event.target.value)) }
                                      : layer
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>끝(ms)</span>
                              <input
                                data-smoke-role="video-layer-clip-end"
                                type="number"
                                min={0}
                                step={100}
                                value={selectedLayer.clipEndMs ?? ""}
                                onChange={(event) =>
                                  updateSelectedLayer((layer) =>
                                    layer.kind === "video"
                                      ? {
                                          ...layer,
                                          clipEndMs: event.target.value === "" ? null : Math.max(0, Number(event.target.value))
                                        }
                                      : layer
                                  )
                                }
                              />
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedLayers.map((layer) => (
                    <div className="layer-editor" key={layer.id}>
                      <div className="layer-editor-header">
                        <strong>{layer.kind}</strong>
                        <button type="button" className="ghost" onClick={() => removeLayer(layer.id)}>
                          삭제
                        </button>
                      </div>
                      {layer.kind === "line" ? (
                        <div className="quad-grid">
                          <label>
                            <span>X1</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={layer.x1}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line"
                                    ? normalizeLineLayer({ ...current, x1: Number(event.target.value) })
                                    : current
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>Y1</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={layer.y1}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line"
                                    ? normalizeLineLayer({ ...current, y1: Number(event.target.value) })
                                    : current
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>X2</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={layer.x2}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line"
                                    ? normalizeLineLayer({ ...current, x2: Number(event.target.value) })
                                    : current
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>Y2</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={layer.y2}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line"
                                    ? normalizeLineLayer({ ...current, y2: Number(event.target.value) })
                                    : current
                                )
                              }
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="quad-grid">
                          <label>
                            <span>X</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={layer.x}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) => ({ ...current, x: Number(event.target.value) }))
                              }
                            />
                          </label>
                          <label>
                            <span>Y</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={layer.y}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) => ({ ...current, y: Number(event.target.value) }))
                              }
                            />
                          </label>
                          <label>
                            <span>W</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={layer.width}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) => ({
                                  ...current,
                                  width: Number(event.target.value)
                                }))
                              }
                            />
                          </label>
                          <label>
                            <span>H</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={layer.height}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) => ({
                                  ...current,
                                  height: Number(event.target.value)
                                }))
                              }
                            />
                          </label>
                        </div>
                      )}
                      {layer.kind === "text" ? (
                        <textarea
                          className="layer-text-input"
                          value={layer.text}
                          onChange={(event) =>
                            updateLayer(layer.id, (current) =>
                              current.kind === "text" ? { ...current, text: event.target.value } : current
                            )
                          }
                        />
                      ) : null}
                      {layer.kind === "shape" ? (
                        <div className="layer-field-grid two">
                          <label>
                            <span>도형 색상</span>
                            <input
                              type="color"
                              value={layer.fill}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "shape" ? { ...current, fill: event.target.value } : current
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>모양</span>
                            <select
                              value={layer.shape}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "shape"
                                    ? { ...current, shape: event.target.value === "ellipse" ? "ellipse" : "rect" }
                                    : current
                                )
                              }
                            >
                              <option value="rect">사각형</option>
                              <option value="ellipse">타원</option>
                            </select>
                          </label>
                        </div>
                      ) : null}
                      {layer.kind === "line" ? (
                        <div className="layer-field-grid three">
                          <label>
                            <span>선 색상</span>
                            <input
                              type="color"
                              value={layer.color}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line" ? { ...current, color: event.target.value } : current
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>선 두께</span>
                            <input
                              type="number"
                              min={1}
                              max={40}
                              value={layer.thickness}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line"
                                    ? { ...current, thickness: clampIntegerControl(Number(event.target.value), 1, 40) }
                                    : current
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>각도</span>
                            <input
                              type="number"
                              min={-180}
                              max={180}
                              value={Math.round(getLineLayerAngle(layer, { width: cardRatio.width, height: cardRatio.height }))}
                              onChange={(event) =>
                                updateLayer(layer.id, (current) =>
                                  current.kind === "line"
                                    ? rotateLineLayer(
                                        current,
                                        clampLayerRotation(Number(event.target.value)),
                                        { width: cardRatio.width, height: cardRatio.height }
                                      )
                                    : current
                                )
                              }
                            />
                          </label>
                        </div>
                      ) : null}
                      {layer.kind === "image" ? (
                        <div className="selected-layer-fields">
                          <div className="image-picker-control">
                            <button
                              type="button"
                              onClick={() => openImagePicker({ kind: "layer", layerId: layer.id }, layer.backgroundId || null)}
                            >
                              이미지 선택
                            </button>
                            {layer.backgroundId ? (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() =>
                                  updateLayer(layer.id, (current) =>
                                    current.kind === "image" ? { ...current, backgroundId: "" } : current
                                  )
                                }
                              >
                                지우기
                              </button>
                            ) : null}
                          </div>
                          {layer.backgroundId && imagePreviews[layer.backgroundId] ? (
                            <div className="image-badge-preview">
                              <img src={imagePreviews[layer.backgroundId]} alt="" />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button type="button" className="ghost" onClick={resetSelectedOverride}>
                  전역 설정으로 초기화
                </button>
              </div>
            )}
            <div className="row">
              <button type="button" data-smoke-action="design-panel-add-card" onClick={addCard}>
                카드 추가
              </button>
              <button type="button" className="ghost" data-smoke-action="design-panel-remove-card" onClick={removeCard}>
                이 카드 삭제
              </button>
            </div>
          </section>

          <section className="panel media-panel" hidden={inspectorTab !== "media"}>
            <p className="panel-title">미디어</p>
            <ol className="media-workflow">
              <li>이미지 또는 영상을 라이브러리로 가져옵니다.</li>
              <li>적용할 위치를 현재 카드, 모든 카드, 영상 레이어 중에서 선택합니다.</li>
            </ol>
            <div className="inspector-action-grid two">
              <button
                type="button"
                data-smoke-action="import-media-image"
                onClick={() => void importMediaForSelection("image")}
              >
                이미지 가져오기
              </button>
              <button
                type="button"
                data-smoke-action="import-media-video"
                onClick={() => void importMediaForSelection("video")}
              >
                영상 가져오기
              </button>
            </div>
            <button type="button" className="ghost wide-action" onClick={() => void refreshMediaAssets()}>
              라이브러리 새로고침
            </button>

            <div className="media-scope-summary">
              <strong>현재 적용 상태</strong>
              <span>
                모든 카드: {selectedGlobalMediaAsset ? mediaAssetLabel(selectedGlobalMediaAsset) : "미디어 없음"}
              </span>
              <span>
                카드 {selectedCardNumber}: {selectedCardMediaAsset ? mediaAssetLabel(selectedCardMediaAsset) : "전역 따름"}
              </span>
            </div>

            <div className="m22-media-panel" data-smoke-role="global-media-panel">
              <p className="panel-title">모든 카드 배경</p>
              <div className="segmented">
                {(["inherit", "asset", "none"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    className={backgroundMedia.mode === mode ? "active" : ""}
                    data-smoke-action={`global-media-${mode}`}
                    onClick={() =>
                      setBackgroundMedia(setBackgroundMediaMode(backgroundMedia, mode, mediaAssets[0]?.id))
                    }
                  >
                    {mode === "inherit" ? "기본 배경" : mode === "asset" ? "라이브러리" : "미디어 없음"}
                  </button>
                ))}
              </div>
              {backgroundMedia.mode === "asset" ? (
                <label className="stack-field">
                  <span>전역 미디어</span>
                  <select
                    data-smoke-role="global-media-select"
                    value={backgroundMedia.mediaId}
                    onChange={(event) => setBackgroundMedia(assignBackgroundMediaAsset(event.target.value))}
                  >
                    <option value="">선택</option>
                    {mediaAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {mediaAssetLabel(asset)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="media-library" data-smoke-role="media-library">
              <div className="section-row">
                <strong>가져온 파일</strong>
                <small>{mediaAssets.length}개</small>
              </div>
              {mediaAssets.length === 0 ? (
                <p className="hint">아직 가져온 미디어가 없습니다.</p>
              ) : (
                <div className="media-library-list">
                  {mediaAssets.map((asset) => (
                    <button
                      type="button"
                      className="media-library-item"
                      key={asset.id}
                      onClick={() => {
                        setPendingMediaAsset(asset);
                        void loadMediaPreview(asset.id);
                      }}
                    >
                      <span>{mediaAssetLabel(asset)}</span>
                      <small>적용 위치 선택</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel" hidden={inspectorTab !== "export"}>
            <p className="panel-title">
              생성 결과
              {parseErrorCount > 0 ? <em className="error-tag">오류 {parseErrorCount}</em> : null}
            </p>
            {renderResult ? (
              <div className="render-output">
                <strong>
                  {approvedJobId === renderResult.jobId ? "승인 완료" : "승인 대기"} ·{" "}
                  {renderResult.cardCount}장
                </strong>
                {renderResult.gateReport.issues.length > 0 ? (
                  <ol className="gate-list">
                    {renderResult.gateReport.issues.slice(0, 4).map((issue) => (
                      <li key={`${issue.cardIndex}-${issue.slot}-${issue.gate}`}>
                        카드 {issue.cardIndex} · {issue.severity} · {issue.slot} · {issue.message}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <span>모든 게이트를 통과했습니다.</span>
                )}
                <div className="render-actions">
                  <button
                    type="button"
                    data-smoke-action="export-current-png"
                    onClick={exportCurrentCardPng}
                  >
                    현재 카드 PNG
                  </button>
                  <button type="button" data-smoke-action="export-zip" onClick={exportZip}>
                    전체 ZIP
                  </button>
                  <button type="button" onClick={openOutputFolder}>
                    폴더 열기
                  </button>
                  <button type="button" onClick={approveRenderResult}>
                    승인
                  </button>
                </div>
              </div>
            ) : (
              <span className="hint">상단 내보내기에서 PNG 또는 MP4를 선택하세요.</span>
            )}
            <div className="video-export-panel" data-smoke-role="mp4-export-panel">
              <p className="panel-title">MP4 영상 내보내기</p>
              <small className="hint">
                {videoExportSummary.label}
                {videoExportSummary.warningCount > 0 ? ` · 경고 ${videoExportSummary.warningCount}` : ""}
              </small>
              <div className="row">
                <button
                  type="button"
                  className="ghost"
                  data-smoke-action="cancel-video-export"
                  onClick={() => void cancelVideoExport()}
                  disabled={!isVideoExporting || !activeVideoExportJobId}
                >
                  취소
                </button>
              </div>
              {videoExportProgress ? (
                <div className="video-export-progress" data-smoke-role="mp4-export-progress">
                  <progress value={Math.round(videoExportProgress.percent)} max={100} />
                  <strong>
                    {videoExportStageLabel(videoExportProgress.stage)} ·{" "}
                    {Math.round(videoExportProgress.percent)}%
                  </strong>
                  <span>
                    경과 {formatElapsedMs(videoExportProgress.elapsedMs)}
                    {videoExportProgress.totalFrames
                      ? ` · 프레임 ${videoExportProgress.completedFrames ?? 0}/${videoExportProgress.totalFrames}`
                      : ""}
                  </span>
                  {videoExportProgress.message ? <span>{videoExportProgress.message}</span> : null}
                </div>
              ) : null}
              {videoExportError ? (
                <div className="video-export-error" role="alert" data-smoke-role="mp4-export-error">
                  <strong>내보내기를 완료하지 못했습니다.</strong>
                  <span>{videoExportError.message}</span>
                  <small>오류 코드: {videoExportError.code}</small>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void startVideoExport()}
                    disabled={isVideoExporting}
                  >
                    다시 시도
                  </button>
                </div>
              ) : null}
              {videoExportResult ? (
                <small className="hint" data-smoke-role="mp4-export-result">
                  저장됨: {videoExportResult.filePath} · {videoExportResult.framesWritten} frames
                </small>
              ) : null}
            </div>
            {hasProTools ? (
            <div className="project-panel">
              <p className="panel-title">프로젝트</p>
              <div className="row">
                <button type="button" onClick={saveProjectArchiveFile}>
                  프로젝트 저장(.cardnews)
                </button>
                <button type="button" onClick={loadProjectArchiveFile}>
                  프로젝트 열기
                </button>
              </div>
            </div>
            ) : (
              renderEditionLock("project_file", "프로젝트", ".cardnews 프로젝트 저장과 열기는 Pro에서 열립니다.")
            )}
            {hasProTools ? (
            <div className="bulk-panel">
              <p className="panel-title">CSV 대량 생성</p>
              <details className="bulk-binding-manager">
                <summary>양식 변수 연결 ({bulkBindings?.bindings.length ?? 0})</summary>
                <p className="hint">CSV 열로 바꿀 항목을 선택하세요. 텍스트 레이어도 페이지별로 연결됩니다.</p>
                <div className="bulk-binding-list">
                  {([
                    ["header", "공통 헤더", headerLabel],
                    ["footer", "공통 푸터", footerAccount]
                  ] as const).map(([field, label, value]) => {
                    const target: BulkBindingTarget = { kind: "deck", field };
                    return renderBulkBindingControl(target, label, value, field);
                  })}
                  {parsedEntries.map((entry, cardIndex) => (
                    <div className="bulk-binding-card" key={`bulk-card-${cardIndex + 1}`}>
                      <strong>{cardIndex + 1}페이지</strong>
                      {cardStandardBindingEntries(entry.card).map((option) => {
                        const target: BulkBindingTarget = {
                          kind: "standard",
                          cardNumber: cardIndex + 1,
                          field: option.field
                        };
                        return renderBulkBindingControl(
                          target,
                          `${cardIndex + 1}페이지 ${option.label}`,
                          option.value,
                          `${cardIndex + 1}-${option.field}`
                        );
                      })}
                      {(overrides[String(cardIndex + 1)]?.layers ?? [])
                        .filter((layer): layer is CardTextBoxLayer => layer.kind === "text")
                        .map((layer, layerIndex) => {
                          const target: BulkBindingTarget = {
                            kind: "layer-text",
                            cardNumber: cardIndex + 1,
                            layerId: layer.id,
                            property: "text"
                          };
                          return renderBulkBindingControl(
                            target,
                            `${cardIndex + 1}페이지 텍스트 ${layerIndex + 1}`,
                            layer.text,
                            `${cardIndex + 1}-${layer.id}`
                          );
                        })}
                    </div>
                  ))}
                </div>
              </details>
              <div className="row">
                <button type="button" onClick={exportBulkTemplate}>
                  CSV 템플릿
                </button>
                <button type="button" onClick={importBulkCsv}>
                  CSV 불러오기
                </button>
                <button type="button" onClick={runBulkGenerate} disabled={isRendering}>
                  BULK PNG
                </button>
              </div>
              <textarea
                className="bulk-csv-input"
                placeholder="CSV 템플릿을 내려받아 작성한 뒤 붙여넣거나 불러오세요."
                value={bulkCsvText}
                onChange={(event) => setBulkCsvText(event.target.value)}
                spellCheck={false}
              />
              {bulkResult ? (
                <div className="bulk-result">
                  <strong>
                    성공 {bulkResult.renderedCount}건 · 실패 {bulkResult.failedCount}건
                  </strong>
                  <span>{bulkResult.outputDir}</span>
                  <ol className="gate-list">
                    {bulkResult.rows.slice(0, 5).map((row) => (
                      <li key={`${row.rowNumber}-${row.outputName}`}>
                        {row.rowNumber}행 · {row.status} · {row.message ?? row.outputName}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
            ) : (
              renderEditionLock("bulk_csv", "CSV 대량 생성", "CSV 템플릿과 대량 PNG 생성은 Pro에서 열립니다.")
            )}
          </section>
        </aside>
      </div>
      {aiPanelOpen ? (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="AI assistant">
          <button
            type="button"
            className="drawer-scrim"
            aria-label="AI 패널 닫기"
            onClick={() => setAiPanelOpen(false)}
          />
          <aside className="ai-drawer" data-smoke-role="ai-panel">
            <div className="ai-drawer-header">
              <div>
                <strong>AI</strong>
                <span className={`status-dot ${selectedAiProvider?.installed ? "installed" : "missing"}`} />
              </div>
              <button type="button" className="ghost" onClick={() => setAiPanelOpen(false)}>
                닫기
              </button>
            </div>
            {hasProTools ? (
              <>
                <div className="ai-provider-strip">
                  <select
                    value={aiProviderId}
                    onChange={(event) => {
                      const nextProviderId = event.target.value;
                      if (nextProviderId === "claude" || nextProviderId === "codex" || nextProviderId === "gemini") {
                        void selectAiProvider(nextProviderId);
                      }
                    }}
                  >
                    {aiProviderOrder.map((providerId) => {
                      const provider = aiProviders.find((entry) => entry.id === providerId);
                      return (
                        <option key={providerId} value={providerId}>
                          {provider?.label ?? providerId} · {provider?.installed ? provider.version ?? "감지됨" : "미설치"}
                        </option>
                      );
                    })}
                  </select>
                  <button type="button" data-smoke-action="ai-refresh" onClick={refreshAiProviders}>
                    새로고침
                  </button>
                </div>
                {selectedAiProvider && !selectedAiProvider.installed ? (
                  <div className="ai-install-panel" data-smoke-role="ai-install-panel">
                    <strong>{selectedAiProvider.label} 설치</strong>
                    {selectedAiProvider.installRecipes?.length ? (
                      selectedAiProvider.installRecipes.map((recipe) => (
                        <div className="ai-install-recipe" key={recipe.id}>
                          <div>
                            <span>
                              {recipe.method}
                              {recipe.recommended ? " · 권장" : " · 대안"}
                            </span>
                            <code>{recipe.commandDisplay}</code>
                            <small>{recipe.prerequisites.join(" ")}</small>
                          </div>
                          <div className="ai-install-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => void openExternalLink(recipe.officialUrl)}
                            >
                              공식 안내
                            </button>
                            <button
                              type="button"
                              disabled={aiInstallBusy}
                              onClick={() => void installSelectedAiProvider(recipe.id)}
                            >
                              {aiInstallBusy ? "설치 확인 중..." : "설치"}
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="ai-install-hint">
                        <span>{selectedAiProvider.installHint}</span>
                        <button type="button" className="ghost" onClick={copySelectedAiInstallHint}>
                          복사
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
                <small className="hint">{aiStatus}</small>
                <div className="ai-default-instruction" data-smoke-role="ai-default-instruction-editor">
                  <label className="stack-field">
                    <span>AI 기본 지시문</span>
                    <textarea
                      value={aiDefaultInstructionDraft}
                      onChange={(event) => setAiDefaultInstructionDraft(event.target.value)}
                      placeholder={defaultAiInstruction}
                      spellCheck={false}
                    />
                  </label>
                  <div className="ai-composer-actions">
                    <button
                      type="button"
                      className="ghost"
                      data-smoke-action="reset-ai-default-instruction"
                      onClick={resetAiDefaultInstructionDraft}
                    >
                      기본값
                    </button>
                    <button
                      type="button"
                      data-smoke-action="save-ai-default-instruction"
                      onClick={() => void saveAiDefaultInstruction()}
                    >
                      지시문 저장
                    </button>
                  </div>
                </div>
                <div className="ai-thread" data-smoke-role="ai-thread">
                  {aiThread.length === 0 ? (
                    <div className="ai-welcome ai-bubble assistant">
                      <strong>안녕하세요. 꽁돈 AI입니다.</strong>
                      <p>아이디어 탐색부터 정보 정리, 문구와 카드 구성까지 편하게 대화로 함께 만들어요.</p>
                    </div>
                  ) : (
                    aiThread.map((message) => (
                      <div
                        key={message.id}
                        className={`ai-bubble ${message.role}${message.status === "error" ? " error" : ""}`}
                        data-smoke-role={message.role === "assistant" ? "ai-assistant-bubble" : "ai-user-bubble"}
                      >
                        {message.status === "loading" ? (
                          <p className="ai-loading" data-smoke-role="ai-progress">
                            {message.content}
                          </p>
                        ) : message.detectedDraft ? (
                          <p>양식.md 응답을 감지했습니다.</p>
                        ) : (
                          <>
                            {message.capabilityNote ? (
                              <span className="ai-capability-note">{message.capabilityNote}</span>
                            ) : null}
                            <p>{message.content}</p>
                          </>
                        )}
                        {message.detectedDraft ? (
                          <div className="ai-draft-detection">
                            <span data-smoke-role="ai-draft-card-count">
                              카드 {message.detectedDraft.cardCount}장 감지
                            </span>
                            <details>
                              <summary>양식.md 보기</summary>
                              <pre>{message.detectedDraft.templateText}</pre>
                            </details>
                            <button
                              type="button"
                              data-smoke-action="ai-apply-draft"
                              onClick={() => applyAiDraft(message.detectedDraft?.templateText ?? "")}
                            >
                              카드에 적용
                            </button>
                          </div>
                        ) : null}
                        {message.status === "error" && message.retryRequest ? (
                          <button
                            type="button"
                            className="ghost"
                            data-smoke-action="ai-retry"
                            onClick={() => retryAiMessage(message.retryRequest)}
                            disabled={aiBusy}
                          >
                            다시 시도
                          </button>
                        ) : null}
                        {message.nextActions && message.nextActions.length > 0 ? (
                          <div className="ai-next-actions">
                            {message.nextActions.map((action) => (
                              <button
                                type="button"
                                className="ghost"
                                key={`${message.id}-${action.kind}-${action.label}`}
                                data-smoke-action={aiNextActionSmokeId(action)}
                                onClick={() => handleAiNextAction(action)}
                                disabled={aiBusy}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                <div className="ai-preset-chips">
                  <button type="button" data-smoke-action="ai-preset-topic" onClick={() => runAiPreset("topic")}>
                    주제 아이디어
                  </button>
                  <button type="button" data-smoke-action="ai-preset-research" onClick={() => runAiPreset("research")}>
                    자료 정리
                  </button>
                  <button type="button" data-smoke-action="ai-preset-draft" onClick={() => runAiPreset("draft")}>
                    카드 구성
                  </button>
                  <button type="button" data-smoke-action="ai-preset-image" onClick={() => runAiPreset("image")}>
                    이미지 방향
                  </button>
                </div>
                <textarea
                  ref={aiInputRef}
                  className="ai-composer-input"
                  data-smoke-role="ai-input"
                  value={aiInput}
                  onChange={(event) => setAiInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendAiMessage();
                    }
                  }}
                  placeholder="무엇을 만들고 싶은지 편하게 말씀해주세요. Shift+Enter로 줄바꿈할 수 있어요."
                  spellCheck={false}
                />
                <div className="ai-composer-actions">
                  <button type="button" className="ghost" data-smoke-action="ai-reset-thread" onClick={resetAiThread}>
                    새 대화
                  </button>
                  <button
                    type="button"
                    className="primary"
                    data-smoke-action="ai-send"
                    onClick={() => void sendAiMessage()}
                    disabled={aiBusy || !aiInput.trim()}
                  >
                    {aiBusy ? "전송 중" : "보내기"}
                  </button>
                </div>
              </>
            ) : (
              renderEditionLock("ai_panel", "AI", "프로그램 내 AI 대본 생성과 자동 적용은 Pro에서 열립니다.")
            )}
          </aside>
        </div>
      ) : null}
      {exportDialogOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
           <div
             ref={exportDialogRef}
             className="export-dialog"
             data-smoke-role="export-dialog"
             tabIndex={-1}
           >
            <div className="modal-header">
              <strong id="export-dialog-title">내보내기</strong>
              <button type="button" className="ghost" onClick={() => setExportDialogOpen(false)}>
                닫기
              </button>
            </div>
            <p className="hint">카드 이미지 묶음 또는 세로형 영상을 선택하세요.</p>
            <div className="export-choice-grid">
              <button
                type="button"
                data-smoke-action="export-png-choice"
                onClick={() => {
                  setExportDialogOpen(false);
                  void runGenerate();
                }}
              >
                <strong>PNG 카드</strong>
                <span>전체 카드를 렌더링한 뒤 현재 PNG 또는 ZIP으로 저장</span>
              </button>
              <button
                type="button"
                data-smoke-action="export-mp4-choice"
                onClick={() => {
                  setVideoProjectMode("video");
                  setExportDialogOpen(false);
                  void startVideoExport();
                }}
              >
                <strong>MP4 영상</strong>
                <span>카드별 시간과 전환을 적용한 1080×1920 영상</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingMediaAsset ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="media-assignment-title">
          <div className="media-assignment-dialog" data-smoke-role="media-assignment-dialog">
            <div className="modal-header">
              <strong id="media-assignment-title">가져온 미디어 적용</strong>
              <button type="button" className="ghost" onClick={() => setPendingMediaAsset(null)}>
                나중에
              </button>
            </div>
            <p>{mediaAssetLabel(pendingMediaAsset)}</p>
            {mediaPreviews[pendingMediaAsset.id] ? (
              pendingMediaAsset.kind === "video" ? (
                <video src={mediaPreviews[pendingMediaAsset.id]} controls muted playsInline />
              ) : (
                <img src={mediaPreviews[pendingMediaAsset.id]} alt="" />
              )
            ) : null}
             <div className="media-assignment-grid">
               <button type="button" onClick={() => assignImportedMedia("card")}>
                 현재 카드 배경
               </button>
              <button type="button" onClick={() => assignImportedMedia("global")}>
                모든 카드 배경
              </button>
              <button
                type="button"
                disabled={pendingMediaAsset.kind !== "video"}
                onClick={() => assignImportedMedia("video-layer")}
               >
                 현재 카드 영상 레이어
               </button>
               <button
                 type="button"
                 className="ghost"
                 onClick={() => {
                   setPendingMediaAsset(null);
                   setStatus("미디어를 보관함에 추가했습니다. 카드에는 아직 적용하지 않았습니다.");
                 }}
               >
                 보관함에만 추가
               </button>
             </div>
          </div>
        </div>
      ) : null}
      {backgroundManagerOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="background manager">
          <div className="image-picker-modal" data-smoke-role="background-manager-modal">
            <div className="modal-header">
              <strong>배경 이미지 관리</strong>
              <button type="button" className="ghost" onClick={closeBackgroundManager}>
                닫기
              </button>
            </div>
            <div className="image-picker-toolbar">
              <button type="button" data-smoke-action="background-manager-add" onClick={addBackground}>
                파일 추가
              </button>
              <input
                className="image-picker-search"
                data-smoke-role="background-manager-search"
                value={backgroundManagerSearch}
                onChange={(event) => setBackgroundManagerSearch(event.target.value)}
                placeholder="파일 이름 또는 ID 검색"
              />
              <button
                type="button"
                className="ghost danger"
                data-smoke-action="background-manager-delete"
                onClick={() => void deleteManagedBackground()}
                disabled={backgroundManagerDeleteDisabled}
                title={
                  backgroundManagerUsages.length > 0
                    ? "사용 중인 배경은 전역/카드/레이어에서 먼저 해제해야 합니다."
                    : "선택한 배경 이미지를 삭제합니다."
                }
              >
                {backgroundManagerBusy ? "처리 중" : "삭제"}
              </button>
            </div>
            {backgroundManagerSelectedId && backgroundPreviews[backgroundManagerSelectedId] ? (
              <div className="image-picker-preview" data-smoke-role="background-manager-selected-preview">
                <img src={backgroundPreviews[backgroundManagerSelectedId]} alt="" />
              </div>
            ) : null}
            {backgroundManagerUsages.length > 0 ? (
              <small className="hint danger-hint">
                사용 중: {backgroundManagerUsages.map((usage) => usage.label).join(", ")}
              </small>
            ) : null}
            <div className="image-picker-grid" data-smoke-role="background-manager-grid">
              {filteredBackgroundLibrary.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`image-picker-item${backgroundManagerSelectedId === item.id ? " active" : ""}`}
                  data-smoke-action="background-manager-select"
                  data-smoke-background-id={item.id}
                  onClick={() => {
                    setBackgroundManagerSelectedId(item.id);
                    void loadBackgroundPreview(item.id);
                  }}
                >
                  {backgroundPreviews[item.id] ? <img src={backgroundPreviews[item.id]} alt="" /> : <span>미리보기</span>}
                  <small title={`${item.displayName} · ${item.id}`}>
                    <span>{item.displayName}</span>
                    <span className="image-picker-id">{item.id.slice(-6)}</span>
                  </small>
                </button>
              ))}
            </div>
            <div className="image-picker-actions">
              <button
                type="button"
                className="ghost"
                data-smoke-action="background-manager-clear"
                onClick={() => setBackgroundManagerSelectedId(null)}
              >
                배경 없음
              </button>
              <button
                type="button"
                className="primary"
                data-smoke-action="background-manager-apply"
                onClick={() => void applyManagedBackground()}
              >
                전역 배경으로 적용
              </button>
            </div>
            {backgroundManagerSelectedItem ? (
              <small className="hint">
                {backgroundManagerSelectedItem.displayName} · {backgroundManagerSelectedItem.id}
                {backgroundManagerSelectedItem.attribution ? ` · ${backgroundManagerSelectedItem.attribution}` : ""}
              </small>
            ) : null}
          </div>
        </div>
      ) : null}
      {imagePickerTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="image picker">
          <div className="image-picker-modal" data-smoke-role="image-picker-modal">
            <div className="modal-header">
              <strong>이미지 관리</strong>
              <button type="button" className="ghost" onClick={closeImagePicker}>
                닫기
              </button>
            </div>
            <div className="image-picker-toolbar">
              <button type="button" data-smoke-action="image-picker-add" onClick={addImageThroughPicker}>
                파일 추가
              </button>
              <input
                className="image-picker-search"
                data-smoke-role="image-picker-search"
                value={imagePickerSearch}
                onChange={(event) => setImagePickerSearch(event.target.value)}
                placeholder="이름 또는 ID 검색"
              />
              <label className="dim-row">
                <span>다음 배경 제거에 적용</span>
                <input
                  type="range"
                  min={1}
                  max={96}
                  value={backgroundRemovalTolerance}
                  onChange={(event) => setBackgroundRemovalTolerance(Number(event.target.value))}
                />
                <small>{backgroundRemovalTolerance}</small>
              </label>
              <button
                type="button"
                data-smoke-action="image-picker-remove-background"
                onClick={removeSelectedPickerBackground}
                disabled={!imagePickerSelectedId || imagePickerBusy}
              >
                {imagePickerBusy ? "처리 중" : "배경 제거"}
              </button>
              <button
                type="button"
                className="ghost danger"
                data-smoke-action="image-picker-delete"
                onClick={() => void deleteSelectedPickerImage()}
                disabled={imagePickerDeleteDisabled}
                title={imagePickerUsages.length > 0 ? "사용 중인 이미지는 먼저 카드에서 해제해야 합니다." : "선택한 이미지를 삭제합니다."}
              >
                삭제
              </button>
            </div>
            {imagePickerSelectedId && imagePreviews[imagePickerSelectedId] ? (
              <div className="image-picker-preview checkerboard" data-smoke-role="image-picker-selected-preview">
                <img src={imagePreviews[imagePickerSelectedId]} alt="" />
              </div>
            ) : null}
            {imagePickerUsages.length > 0 ? (
              <small className="hint danger-hint">사용 중: {imagePickerUsages.map((usage) => usage.label).join(", ")}</small>
            ) : null}
            <div className="image-picker-grid" data-smoke-role="image-picker-grid">
              {filteredImageLibrary.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`image-picker-item${imagePickerSelectedId === item.id ? " active" : ""}`}
                  data-smoke-action="image-picker-select"
                  data-smoke-image-id={item.id}
                  onClick={() => {
                    setImagePickerSelectedId(item.id);
                    void loadImagePreview(item.id);
                  }}
                >
                  {imagePreviews[item.id] ? <img src={imagePreviews[item.id]} alt="" /> : <span>미리보기</span>}
                  <small title={item.id}>
                    <span>{item.displayName}</span>
                    <span className="image-picker-id">{item.id.slice(-6)}</span>
                  </small>
                </button>
              ))}
            </div>
            <div className="image-picker-actions">
              <button type="button" className="ghost" data-smoke-action="image-picker-clear" onClick={() => applyImagePickerSelection(null)}>
                선택 해제
              </button>
              <button
                type="button"
                className="primary"
                data-smoke-action="image-picker-apply"
                onClick={() => applyImagePickerSelection(imagePickerSelectedId)}
                disabled={!imagePickerSelectedId}
              >
                선택
              </button>
            </div>
            {imagePickerSelectedItem ? <small className="hint">{imagePickerSelectedItem.displayName}</small> : null}
          </div>
        </div>
      ) : null}
      {stockSearchOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="free image search">
          <div className="stock-modal">
            <div className="modal-header">
              <strong>Pixabay 무료 이미지 검색</strong>
              <button type="button" className="ghost" onClick={() => setStockSearchOpen(false)}>
                닫기
              </button>
            </div>
            <div className="row">
              <input
                value={stockQuery}
                onChange={(event) => setStockQuery(event.target.value)}
                placeholder="예: money, office, finance"
              />
              <button type="button" onClick={searchStockImages} disabled={stockLoading}>
                {stockLoading ? "검색 중" : "검색"}
              </button>
            </div>
            {stockFallbackUrl ? (
              <p className="hint">브라우저에서 열린 Pixabay 결과를 내려받은 뒤 파일 추가로 등록하세요.</p>
            ) : null}
            <div className="stock-grid">
              {stockImages.map((image) => (
                <button
                  type="button"
                  key={image.id}
                  className="stock-card"
                  onClick={() => void addStockImageToLibrary(image)}
                >
                  <img src={image.previewUrl} alt="" />
                  <span>{image.author}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {infoOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="about Cardnews Studio">
          <div className="info-modal">
            <div className="modal-header">
              <strong>Cardnews Studio</strong>
              <button type="button" className="ghost" onClick={() => setInfoOpen(false)}>
                닫기
              </button>
            </div>
            <p>Creator credit</p>
            <button type="button" className="credit-link" onClick={() => void openExternalLink(threadsUrl)}>
              Threads {threadsDisplay}
            </button>
            <button type="button" className="ghost" onClick={() => void openExternalLink(kakaoInquiryUrl)}>
              AX문의/강의 문의
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
