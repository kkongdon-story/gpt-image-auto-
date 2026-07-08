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
import { parseCardText } from "../domain/cardParser";
import { defaultChromeConfig, normalizeChromeConfig } from "../domain/chromeConfig";
import { buildBulkCsvTemplate } from "../domain/csvBulk";
import { buildTemplateDocument, parseDeckDocument } from "../domain/deckImporter";
import {
  getLineLayerAngle,
  getLineLayerRenderGeometry,
  normalizeLineLayer,
  rotateLineLayer,
  setLineLayerEndpoint,
  translateLineLayer
} from "../domain/lineLayer";
import type {
  AppSettings,
  BackgroundLibraryItem,
  BulkRenderResult,
  Card,
  CardLayer,
  CardLineLayer,
  CardOverride,
  CardOverrideMap,
  CardnewsError,
  CardnewsResult,
  ChromeSlotStyle,
  ChromePageNumberStyle,
  DeckDraft,
  Deck,
  DeckPreset,
  FontData,
  FontLibraryItem,
  RenderJobResult,
  StockImage,
  StockImageDownloadInput,
  StylePresetRecord,
  WorkspaceState
} from "../domain/types";
import { buildCardHtml, buildFontFaceCss } from "../render-engine/cardTemplate";
import { buildDesignContract, buildSampleStyleJson, parseStyleJson } from "../render-engine/customStyles";
import {
  accentSwatches,
  defaultStyleId,
  resolveStylePreset,
  stylePresets
} from "../render-engine/stylePresets";

const maxCards = 12;
const defaultHeaderLabel = "MONEY NOTE";
const defaultFooterAccount = "kkongdon_story";
const threadsUrl = "https://www.threads.com/@kkongdon_story";
const kakaoInquiryUrl = "https://open.kakao.com/me/kkongdon";

function normalizeFooterAccount(value: string): string {
  const trimmed = value.trim();
  const withoutAt = trimmed.replace(/^@+/, "").trim();
  return withoutAt.length > 0 ? withoutAt : defaultFooterAccount;
}

type InspectorTab = "design" | "content" | "export";
type CardEditorTab = "content" | "design";

type ParsedCardEntry = {
  readonly card: Card;
  readonly error: CardnewsError | undefined;
};

type LayerRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

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
    }
  | {
      readonly kind: "line-move";
      readonly layerId: string;
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startLayer: CardLineLayer;
    }
  | {
      readonly kind: "line-endpoint";
      readonly layerId: string;
      readonly endpoint: LineEndpoint;
      readonly startLayer: CardLineLayer;
    }
  | {
      readonly kind: "resize";
      readonly layerId: string;
      readonly handle: ResizeHandle;
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startRect: LayerRect;
    };

const resizeHandles: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

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
  return "이미지";
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
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

function StageCanvas({
  html,
  cardWidth,
  cardHeight,
  editMode,
  layers,
  selectedLayerId,
  editingLayerId,
  editingText,
  onSelectLayer,
  onTransformLayer,
  onTransformLineLayer,
  onNudgeLayer,
  onDeleteLayer,
  onStartTextEdit,
  onEditingTextChange,
  onCommitTextEdit,
  onCancelTextEdit
}: {
  readonly html: string;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly editMode: boolean;
  readonly layers: readonly CardLayer[];
  readonly selectedLayerId: string | null;
  readonly editingLayerId: string | null;
  readonly editingText: string;
  readonly onSelectLayer: (layerId: string | null) => void;
  readonly onTransformLayer: (layerId: string, rect: LayerRect) => void;
  readonly onTransformLineLayer: (layerId: string, layer: CardLineLayer) => void;
  readonly onNudgeLayer: (layerId: string, deltaXPercent: number, deltaYPercent: number) => void;
  readonly onDeleteLayer: (layerId: string) => void;
  readonly onStartTextEdit: (layer: CardLayer) => void;
  readonly onEditingTextChange: (value: string) => void;
  readonly onCommitTextEdit: () => void;
  readonly onCancelTextEdit: () => void;
}): ReactElement {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const draftRectRef = useRef<{ readonly layerId: string; readonly rect: LayerRect } | null>(null);
  const draftLineRef = useRef<{ readonly layerId: string; readonly layer: CardLineLayer } | null>(null);
  const [scale, setScale] = useState(0.4);
  const [draftRect, setDraftRect] = useState<{ readonly layerId: string; readonly rect: LayerRect } | null>(null);
  const [draftLine, setDraftLineState] = useState<{ readonly layerId: string; readonly layer: CardLineLayer } | null>(
    null
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  const editingLayer = layers.find((layer): layer is TextLayer => layer.id === editingLayerId && layer.kind === "text");

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

  function rectFor(layer: CardLayer): LayerRect {
    return draftRect?.layerId === layer.id ? draftRect.rect : layerRect(layer);
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
    const rect = rectFor(layer);
    dragRef.current = {
      kind: "move",
      layerId: layer.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect
    };
    setDraft({ layerId: layer.id, rect });
  }

  function beginResize(event: ReactPointerEvent<HTMLElement>, layer: CardLayer, handle: ResizeHandle): void {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    onSelectLayer(layer.id);
    const rect = rectFor(layer);
    dragRef.current = {
      kind: "resize",
      layerId: layer.id,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: rect
    };
    setDraft({ layerId: layer.id, rect });
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
    const currentLayer = lineFor(layer);
    dragRef.current = {
      kind: "line-move",
      layerId: layer.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLayer: currentLayer
    };
    setDraftLine({ layerId: layer.id, layer: currentLayer });
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
    const currentLayer = lineFor(layer);
    dragRef.current = {
      kind: "line-endpoint",
      layerId: layer.id,
      endpoint,
      startLayer: currentLayer
    };
    setDraftLine({ layerId: layer.id, layer: currentLayer });
  }

  function updateDraft(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    const overlay = overlayRef.current;
    if (!drag || !overlay) {
      return;
    }
    const bounds = overlay.getBoundingClientRect();
    if (drag.kind === "line-endpoint") {
      const pointerX = ((event.clientX - bounds.left) / bounds.width) * 100;
      const pointerY = ((event.clientY - bounds.top) / bounds.height) * 100;
      setDraftLine({
        layerId: drag.layerId,
        layer: setLineLayerEndpoint(
          drag.startLayer,
          drag.endpoint,
          pointerX,
          pointerY,
          event.shiftKey,
          { width: cardWidth, height: cardHeight }
        )
      });
      return;
    }

    const deltaXPercent = ((event.clientX - drag.startClientX) / bounds.width) * 100;
    const deltaYPercent = ((event.clientY - drag.startClientY) / bounds.height) * 100;
    if (drag.kind === "line-move") {
      setDraftLine({
        layerId: drag.layerId,
        layer: translateLineLayer(drag.startLayer, deltaXPercent, deltaYPercent)
      });
      return;
    }

    const nextRect =
      drag.kind === "move"
        ? transformMoveRect(drag.startRect, deltaXPercent, deltaYPercent)
        : transformResizeRect(drag.startRect, drag.handle, deltaXPercent, deltaYPercent);
    setDraft({
      layerId: drag.layerId,
      rect: event.shiftKey ? nextRect : snapLayerRect(nextRect, cardWidth, cardHeight)
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
    dragRef.current = null;
    setDraft(null);
    setDraftLine(null);
  }

  function handleOverlayKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!editMode || !selectedLayer || editingLayerId) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDeleteLayer(selectedLayer.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectLayer(null);
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    const horizontal = (step / cardWidth) * 100;
    const vertical = (step / cardHeight) * 100;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onNudgeLayer(selectedLayer.id, -horizontal, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onNudgeLayer(selectedLayer.id, horizontal, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onNudgeLayer(selectedLayer.id, 0, -vertical);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onNudgeLayer(selectedLayer.id, 0, vertical);
    }
  }

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
          pointerEvents: editMode ? "none" : "auto",
          transform: `scale(${scale})`
        }}
      />
      {editMode ? (
        <div
          className="edit-overlay"
          ref={overlayRef}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              onSelectLayer(null);
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
          {editingLayer ? (
            <textarea
              className="layer-inline-textarea"
              value={editingText}
              style={{
                ...layerStyle(rectFor(editingLayer)),
                color: editingLayer.color ?? "inherit",
                fontSize: `${Math.max(10, (editingLayer.fontSize ?? 40) * scale)}px`,
                fontStyle: editingLayer.italic === true ? "italic" : "normal",
                fontWeight: editingLayer.fontWeight ?? 700,
                textAlign: editingLayer.align ?? "left"
              }}
              autoFocus
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onEditingTextChange(event.target.value)}
              onBlur={onCommitTextEdit}
              onKeyDown={(event) => {
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
  const [customDim, setCustomDim] = useState<number | null>(null);
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<CardOverrideMap>({});
  const [backgroundPreviews, setBackgroundPreviews] = useState<Readonly<Record<string, string>>>({});
  const [backgroundLibrary, setBackgroundLibrary] = useState<readonly BackgroundLibraryItem[]>([]);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [fontLibrary, setFontLibrary] = useState<readonly FontLibraryItem[]>([]);
  const [selectedFontId, setSelectedFontId] = useState<string | null>(null);
  const [customStyles, setCustomStyles] = useState<readonly StylePresetRecord[]>([]);
  const [styleJsonInput, setStyleJsonInput] = useState("");
  const [styleWarnings, setStyleWarnings] = useState<readonly string[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [pixabayApiKeyDraft, setPixabayApiKeyDraft] = useState("");
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [stockQuery, setStockQuery] = useState("money background");
  const [stockImages, setStockImages] = useState<readonly StockImage[]>([]);
  const [stockFallbackUrl, setStockFallbackUrl] = useState<string | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerText, setEditingLayerText] = useState("");
  const [railWidth, setRailWidth] = useState(150);
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
  const workspaceReady = useRef(false);
  const fontBlobUrlRef = useRef<string | null>(null);

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
      backgroundId,
      selectedFontId,
      overrides
    ]
  );

  const previewHtmls = useMemo(
    () =>
      previewDeck.cards.map((card) => {
        const override = overrides[String(card.index)];
        const cardBackgroundId = override?.backgroundId === null ? null : override?.backgroundId ?? backgroundId;
        return buildCardHtml({
          assetCssUrls: backgroundPreviews,
          backgroundCssUrl: cardBackgroundId ? backgroundPreviews[cardBackgroundId] : undefined,
          card,
          customStyles,
          deck: previewDeck,
          ...(fontCss ? { fontCss } : {}),
          ...(override ? { override } : {})
        });
      }),
    [previewDeck, backgroundId, backgroundPreviews, customStyles, overrides, fontCss]
  );

  const parseErrorCount = parsedEntries.filter((entry) => entry.error).length;
  const selectedEntry = parsedEntries[selectedIndex];
  const selectedCardNumber = selectedIndex + 1;
  const selectedOverride = overrides[String(selectedCardNumber)];
  const selectedLayers = useMemo(() => selectedOverride?.layers ?? [], [selectedOverride]);
  const selectedLayer = selectedLayers.find((layer) => layer.id === selectedLayerId);

  // ── 시작 시 라이브러리/프리셋/워크스페이스 복원 ──
  useEffect(() => {
    void (async () => {
      const [
        libraryResult,
        presetsResult,
        workspaceResult,
        customStylesResult,
        settingsResult,
        fontLibraryResult
      ] = await Promise.all([
        window.cardnews.listBackgroundLibrary(),
        window.cardnews.listDeckPresets(),
        window.cardnews.loadWorkspace(),
        window.cardnews.listCustomStyles(),
        window.cardnews.loadSettings(),
        window.cardnews.listFontLibrary()
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
      if (!isCardnewsError(settingsResult)) {
        setSettings(settingsResult);
        setPixabayApiKeyDraft(settingsResult.pixabayApiKey ?? "");
      }

      if (!isCardnewsError(workspaceResult) && workspaceResult) {
        applySnapshot(workspaceResult);
        setStatus("이전 작업을 복원했습니다.");
      }

      workspaceReady.current = true;

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
    selectedFontId,
    overrides,
    railWidth,
    selectedIndex
  ]);

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
        if (layer.kind === "image") {
          ids.add(layer.backgroundId);
        }
      }
    }

    for (const id of ids) {
      if (!backgroundPreviews[id]) {
        void loadBackgroundPreview(id);
      }
    }
  }, [backgroundId, backgroundPreviews, overrides]);

  useEffect(() => () => clearFontBlobUrl(), []);

  useEffect(() => {
    setSelectedLayerId(null);
    setEditingLayerId(null);
    setEditingLayerText("");
  }, [selectedIndex]);

  useEffect(() => {
    if (selectedLayerId && !selectedLayers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(null);
      setEditingLayerId(null);
      setEditingLayerText("");
    }
  }, [selectedLayerId, selectedLayers]);

  function applySnapshot(snapshot: {
    readonly headerLabel: string;
    readonly footerAccount: string;
    readonly chrome?: ReturnType<typeof normalizeChromeConfig>;
    readonly styleId: string;
    readonly accentColor?: string;
    readonly backgroundDim?: number;
    readonly backgroundId?: string;
    readonly aspectRatio?: string;
    readonly fontId?: string;
    readonly overrides?: CardOverrideMap;
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
    if (snapshot.aspectRatio && aspectRatios.some((ratio) => ratio.id === snapshot.aspectRatio)) {
      setAspectRatioId(snapshot.aspectRatio);
    }
    setSelectedFontId(snapshot.fontId ?? null);

    const nextCards = snapshot.cards.slice(0, maxCards);
    if (nextCards.length > 0) {
      setCards(nextCards);
      setSelectedIndex(Math.min(snapshot.selectedIndex ?? 0, nextCards.length - 1));
    }
    setOverrides(snapshot.overrides ?? {});
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

    const library = await window.cardnews.listBackgroundLibrary();
    if (!isCardnewsError(library)) {
      setBackgroundLibrary(library);
    }

    setStatus(`배경 추가: ${added.displayName} · 목록에서 선택하면 적용됩니다.`);
  }

  async function openExternalLink(url: string): Promise<void> {
    const result = await window.cardnews.openExternalLink(url);
    if (isCardnewsError(result)) {
      setStatus(result.message);
    }
  }

  function updateSelectedOverride(next: CardOverride): void {
    updateSelectedOverrideWith((currentOverride) => ({ ...currentOverride, ...next }));
  }

  function updateSelectedOverrideWith(updater: (currentOverride: CardOverride) => CardOverride): void {
    const key = String(selectedCardNumber);
    setOverrides((current) => {
      const merged = updater(current[key] ?? {});
      const updated = { ...current, [key]: merged };
      return removeEmptyOverrides(updated);
    });
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
        [field]: value
      }
    });
  }

  function updateSelectedTypography(
    field: "sizeScale" | "weight" | "italic",
    value: number | boolean | undefined
  ): void {
    updateSelectedOverride({
      typography: {
        ...(selectedOverride?.typography ?? {}),
        ...(value === undefined ? {} : { [field]: value })
      }
    });
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

  function selectLayer(layerId: string | null): void {
    setSelectedLayerId(layerId);
    if (layerId) {
      setEditMode(true);
    } else {
      setEditingLayerId(null);
      setEditingLayerText("");
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

  function startLayerTextEdit(layer: CardLayer): void {
    if (layer.kind !== "text") {
      return;
    }
    setSelectedLayerId(layer.id);
    setEditingLayerId(layer.id);
    setEditingLayerText(layer.text);
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
          backgroundId: backgroundLibrary[0]?.id ?? backgroundId ?? "",
          objectFit: "cover"
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
            override.typography !== undefined ||
            (override.layers !== undefined && override.layers.length > 0)
        )
      )
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
    const nextSettings: AppSettings = {
      ...(pixabayApiKeyDraft.trim() ? { pixabayApiKey: pixabayApiKeyDraft.trim() } : {})
    };
    const saved = await window.cardnews.saveSettings(nextSettings);
    if (isCardnewsError(saved)) {
      setStatus(saved.message);
      return;
    }

    setSettings(nextSettings);
    setStatus(nextSettings.pixabayApiKey ? "Pixabay API 키를 저장했습니다." : "Pixabay API 키를 비웠습니다.");
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
        ? `${document.fileName} → 카드 ${parsed.cards.length}장 · 경고: ${parsed.warnings[0]}`
        : `${document.fileName} → 카드 ${parsed.cards.length}장을 불러왔습니다.`
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
      ...(customAccent ? { accentColor: customAccent } : {}),
      ...(customDim !== null ? { backgroundDim: customDim } : {}),
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
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

  function addCard(): void {
    if (cards.length >= maxCards) {
      setStatus(`카드는 최대 ${maxCards}장까지 만들 수 있습니다.`);
      return;
    }

    const nextIndex = cards.length;
    setCards((current) => [
      ...current,
      `유형: 본문\n제목: 카드 ${current.length + 1} 제목\n본문: 내용을 입력하세요.`
    ]);
    setSelectedIndex(nextIndex);
  }

  function removeCard(): void {
    if (cards.length <= 1) {
      setStatus("카드는 최소 1장이 필요합니다.");
      return;
    }

    setCards((current) => current.filter((_, index) => index !== selectedIndex));
    setSelectedIndex((current) => Math.max(0, Math.min(current, cards.length - 2)));
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
    void loadFontCss(null);
    setOverrides({});
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

  async function exportProjectFile(): Promise<void> {
    const savedWorkspace = await window.cardnews.saveWorkspace(buildWorkspaceState());
    if (isCardnewsError(savedWorkspace)) {
      setStatus(savedWorkspace.message);
      return;
    }

    const saved = await window.cardnews.exportProject();
    setStatus(isCardnewsError(saved) ? saved.message : `프로젝트 저장: ${saved.filePath}`);
  }

  async function importProjectFile(): Promise<void> {
    const imported = await window.cardnews.importProject();
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

  async function exportBulkTemplate(): Promise<void> {
    const saved = await window.cardnews.exportBulkCsvTemplate(buildBulkCsvTemplate(styleId, aspectRatioId));
    setStatus(isCardnewsError(saved) ? saved.message : `CSV 템플릿 저장: ${saved}`);
  }

  async function importBulkCsv(): Promise<void> {
    const imported = await window.cardnews.importBulkCsvFile();
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
      const result = await window.cardnews.renderBulkCsv(bulkCsvText);
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
      ...(customAccent ? { accentColor: customAccent } : {}),
      ...(customDim !== null ? { backgroundDim: customDim } : {}),
      ...(backgroundId ? { backgroundId } : {}),
      ...(selectedFontId ? { fontId: selectedFontId } : {}),
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      railWidth,
      cards,
      selectedIndex
    };
  }

  return (
    <main className="studio">
      {fontCss ? <style>{fontCss}</style> : null}
      <header className="topbar">
        <button type="button" className="brand brand-button" onClick={() => setInfoOpen(true)}>
          <strong>Cardnews Studio</strong>
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
          <span>멘션</span>
          <input
            data-smoke-role="mention-input"
            value={footerAccount}
            onChange={(event) => setFooterAccount(event.target.value)}
          />
        </label>
        <div className="topbar-actions">
          <button
            type="button"
            className="credit-pill threads-pill"
            data-smoke-role="threads-link"
            aria-label="Threads @kkongdon_story 열기"
            title="Threads @kkongdon_story"
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
          <button type="button" className="ghost" data-smoke-action="reset-workspace" onClick={resetWorkspace}>
            초기화
          </button>
          <button
            type="button"
            className="primary"
            onClick={runGenerate}
            disabled={isRendering}
            data-smoke-action="generate"
          >
            {isRendering ? "생성 중..." : "PNG 생성"}
          </button>
        </div>
      </header>

      <div className="panes" style={{ gridTemplateColumns: `${railWidth}px 6px 1fr 360px` }}>
        <aside className="slide-rail" aria-label="slide thumbnails">
          {previewHtmls.map((html, index) => (
            <button
              type="button"
              key={index}
              className={`slide-thumb${index === selectedIndex ? " active" : ""}${
                parsedEntries[index]?.error ? " has-error" : ""
              }`}
              onClick={() => setSelectedIndex(index)}
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
            editingLayerId={editingLayerId}
            editingText={editingLayerText}
            onSelectLayer={selectLayer}
            onTransformLayer={transformLayer}
            onTransformLineLayer={transformLineLayer}
            onNudgeLayer={nudgeLayer}
            onDeleteLayer={removeLayer}
            onStartTextEdit={startLayerTextEdit}
            onEditingTextChange={setEditingLayerText}
            onCommitTextEdit={commitLayerTextEdit}
            onCancelTextEdit={cancelLayerTextEdit}
          />
          <p className="stage-status">{status}</p>
        </section>

        <aside className="inspector" aria-label="editor controls">
          <div className="inspector-tabs">
            {(["design", "content", "export"] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                className={inspectorTab === tab ? "active" : ""}
                data-smoke-action={`inspector-${tab}`}
                onClick={() => setInspectorTab(tab)}
              >
                {tab === "design" ? "디자인" : tab === "content" ? "콘텐츠" : "내보내기"}
              </button>
            ))}
          </div>
          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">양식</p>
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
            <div className="row">
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
            <div className="row">
              <button type="button" onClick={exportTemplate}>
                양식.md 내보내기
              </button>
              <button type="button" onClick={importFromFile}>
                작성한 파일 불러오기
              </button>
            </div>
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
            <button type="button" className="ghost" onClick={() => setCustomAccent(null)}>
              스타일 기본값
            </button>
          </section>

          <section className="panel" hidden={inspectorTab !== "design"}>
            <p className="panel-title">스타일 관리</p>
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
                value={backgroundId ?? ""}
                onChange={(event) =>
                  void applyBackgroundSelection(event.target.value === "" ? null : event.target.value)
                }
              >
                <option value="">없음</option>
                {backgroundLibrary.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addBackground}>
                파일 추가
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
                <textarea
                  className="card-input"
                  value={cards[selectedIndex] ?? ""}
                  onChange={(event) => updateCard(selectedIndex, event.target.value)}
                  spellCheck={false}
                />
                {selectedEntry?.error ? (
                  <p className="parse-error-text">{selectedEntry.error.message}</p>
                ) : null}
                <div className="grammar-hint">
                  <span>유형: 표지|본문|마무리</span>
                  <span>제목: / 소제목: / 배지:</span>
                  <span>본문: 문단, "- "는 불릿</span>
                  <span>출처: / 강조:</span>
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
                  <div className="layer-field-grid three">
                    <label>
                      <span>헤더 색</span>
                      <input
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
                  <div className="layer-field-grid two">
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
                  <div className="layer-field-grid two">
                    <label>
                      <span>페이지 형식</span>
                      <input
                        data-smoke-role="chrome-page-template"
                        value={chromeConfig.pageNumber.template}
                        onChange={(event) => updateChromePageNumber({ template: event.target.value })}
                      />
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
                        type="color"
                        value={chromeConfig.footer.color}
                        onChange={(event) => updateChromeSlot("footer", { color: event.target.value })}
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
                        {item.displayName}
                      </option>
                    ))}
                  </select>
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
                <label className="dim-row">
                  <span>세로 위치</span>
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
                <div className="layer-controls">
                  <p className="panel-title">레이어</p>
                  <div className="row">
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
                        <select
                          value={layer.backgroundId}
                          onChange={(event) =>
                            updateLayer(layer.id, (current) =>
                              current.kind === "image" ? { ...current, backgroundId: event.target.value } : current
                            )
                          }
                        >
                          <option value="">이미지 선택</option>
                          {backgroundLibrary.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName}
                            </option>
                          ))}
                        </select>
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
              <button type="button" onClick={addCard}>
                카드 추가
              </button>
              <button type="button" className="ghost" onClick={removeCard}>
                이 카드 삭제
              </button>
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
              <span className="hint">PNG 생성 버튼을 누르면 전체 카드를 렌더링합니다.</span>
            )}
            <div className="project-panel">
              <p className="panel-title">프로젝트</p>
              <div className="row">
                <button type="button" onClick={exportProjectFile}>
                  프로젝트 저장(.cardnews)
                </button>
                <button type="button" onClick={importProjectFile}>
                  프로젝트 열기
                </button>
              </div>
            </div>
            <div className="bulk-panel">
              <p className="panel-title">CSV 대량 생성</p>
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
          </section>
        </aside>
      </div>
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
              Threads @
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
