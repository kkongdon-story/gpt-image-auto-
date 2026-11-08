import type {
  BackgroundMediaSelection,
  BodyNumberDefault,
  BodyNumberMode,
  CardOverrideMap,
  CardLayer,
  CardSceneSettings,
  CardSceneTransition,
  CardVideoLayer,
  MediaAssetRef,
  SemanticItemPlacement,
  SemanticSlotPlacement,
  VideoProjectMode
} from "./types.js";

export const defaultBackgroundMediaSelection: BackgroundMediaSelection = { mode: "inherit" };
export const defaultDeckBackgroundMediaSelection: BackgroundMediaSelection = { mode: "none" };

export const minSceneDurationMs = 500;
export const maxSceneDurationMs = 180000;
export const defaultCardSceneSettings: CardSceneSettings = {
  durationMs: 3000,
  durationMode: "fixed",
  transition: "none",
  transitionMs: 0,
  primaryAudioSourceId: null
};

const validTransitions = new Set<CardSceneTransition>(["none", "fade", "slide-left", "slide-up"]);
const validAnchors = new Set<SemanticSlotPlacement["anchor"]>(["top-left", "top-center", "top-right"]);
const validBodyNumberDefaults = new Set<BodyNumberDefault>(["show", "hide"]);
const validBodyNumberModes = new Set<BodyNumberMode>(["inherit", "show", "hide"]);

type VideoProjectModeSnapshot = {
  readonly backgroundMedia?: BackgroundMediaSelection | undefined;
  readonly mediaAssets?: readonly MediaAssetRef[] | undefined;
  readonly overrides?: CardOverrideMap | undefined;
};

export function normalizeVideoProjectMode(
  input: unknown,
  snapshot: VideoProjectModeSnapshot = {}
): VideoProjectMode {
  if (input === "cards" || input === "video") {
    return input;
  }

  const videoIds = new Set(
    (snapshot.mediaAssets ?? [])
      .filter((asset) => asset.kind === "video")
      .map((asset) => asset.id)
  );
  const isVideoSelection = (selection: BackgroundMediaSelection | undefined): boolean =>
    selection?.mode === "asset" && videoIds.has(selection.mediaId);

  if (isVideoSelection(snapshot.backgroundMedia)) {
    return "video";
  }

  for (const override of Object.values(snapshot.overrides ?? {})) {
    if (
      isVideoSelection(override.backgroundMedia) ||
      (override.layers ?? []).some((layer) => layer.kind === "video")
    ) {
      return "video";
    }
  }

  return "cards";
}

export function normalizeDeckBackgroundMediaSelection(
  input: unknown,
  legacyBackgroundId?: string | null
): BackgroundMediaSelection {
  const selection = normalizeBackgroundMediaSelection(input);
  if (selection.mode === "asset" || selection.mode === "none") {
    return selection;
  }

  const legacy = normalizeMediaId(legacyBackgroundId);
  return legacy ? { mode: "asset", mediaId: legacy } : defaultDeckBackgroundMediaSelection;
}

export function normalizeCardBackgroundMediaSelection(
  input: unknown,
  legacyBackgroundId?: string | null
): BackgroundMediaSelection {
  const selection = normalizeBackgroundMediaSelection(input);
  if (selection.mode !== "inherit") {
    return selection;
  }

  if (legacyBackgroundId === null) {
    return { mode: "none" };
  }

  const legacy = normalizeMediaId(legacyBackgroundId);
  return legacy ? { mode: "asset", mediaId: legacy } : defaultBackgroundMediaSelection;
}

export function normalizeBackgroundMediaSelection(input: unknown): BackgroundMediaSelection {
  if (!isRecord(input)) {
    return defaultBackgroundMediaSelection;
  }

  if (input["mode"] === "none") {
    return { mode: "none" };
  }

  if (input["mode"] === "asset") {
    const mediaId = normalizeMediaId(input["mediaId"]);
    return mediaId ? { mode: "asset", mediaId } : defaultBackgroundMediaSelection;
  }

  return defaultBackgroundMediaSelection;
}

export function normalizeCardSceneSettings(
  input: unknown,
  fallback: CardSceneSettings = defaultCardSceneSettings
): CardSceneSettings {
  const record = isRecord(input) ? input : {};
  const durationMs = clampNumber(record["durationMs"], minSceneDurationMs, maxSceneDurationMs, fallback.durationMs);
  const transition = validTransitions.has(record["transition"] as CardSceneTransition)
    ? (record["transition"] as CardSceneTransition)
    : fallback.transition;
  const maxTransitionMs = Math.min(2000, Math.floor(durationMs / 2));
  const transitionMs =
    transition === "none" ? 0 : clampNumber(record["transitionMs"], 0, maxTransitionMs, fallback.transitionMs);
  const primaryAudioSourceId = normalizeAudioSourceId(record["primaryAudioSourceId"]);
  const durationMode = record["durationMode"] === "fit-primary-video" ? "fit-primary-video" : "fixed";

  return {
    durationMs,
    durationMode,
    transition,
    transitionMs,
    primaryAudioSourceId
  };
}

export function normalizeCardLayer(layer: CardLayer, mediaDurationMs?: number): CardLayer {
  return layer.kind === "video" ? normalizeVideoLayer(layer, mediaDurationMs) : layer;
}

export function normalizeVideoLayer(input: unknown, mediaDurationMs?: number): CardVideoLayer {
  const record = isRecord(input) ? input : {};
  const sourceDuration = typeof mediaDurationMs === "number" && Number.isFinite(mediaDurationMs) ? Math.max(0, mediaDurationMs) : undefined;
  const clipStartMax = sourceDuration ?? maxSceneDurationMs;
  const clipStartMs = clampNumber(record["clipStartMs"], 0, clipStartMax, 0);
  const rawClipEnd = record["clipEndMs"];
  const clipEndMs =
    typeof rawClipEnd === "number" && Number.isFinite(rawClipEnd)
      ? Math.max(clipStartMs + 1, Math.min(sourceDuration ?? rawClipEnd, rawClipEnd))
      : null;

  return {
    id: normalizeString(record["id"], "video-layer"),
    kind: "video",
    x: clampNumber(record["x"], 0, 100, 0),
    y: clampNumber(record["y"], 0, 100, 0),
    width: clampNumber(record["width"], 1, 100, 100),
    height: clampNumber(record["height"], 1, 100, 100),
    ...(Number.isFinite(record["zIndex"]) ? { zIndex: Math.trunc(record["zIndex"] as number) } : {}),
    ...(typeof record["opacity"] === "number" ? { opacity: clampNumber(record["opacity"], 0, 1, 1) } : {}),
    mediaId: normalizeString(record["mediaId"], ""),
    objectFit: record["objectFit"] === "contain" ? "contain" : "cover",
    clipStartMs,
    clipEndMs,
    volume: clampNumber(record["volume"], 0, 1, 1)
  };
}

export function normalizeSemanticSlotPlacement(input: unknown): SemanticSlotPlacement {
  if (!isRecord(input) || input["mode"] !== "card") {
    return {
      mode: "flow",
      x: 0,
      y: 0,
      anchor: "top-left"
    };
  }

  const width = optionalClampedNumber(input["width"], 1, 100);
  const height = optionalClampedNumber(input["height"], 1, 100);
  const anchor = validAnchors.has(input["anchor"] as SemanticSlotPlacement["anchor"])
    ? (input["anchor"] as SemanticSlotPlacement["anchor"])
    : "top-left";

  return {
    mode: "card",
    x: clampNumber(input["x"], 0, 100, 0),
    y: clampNumber(input["y"], 0, 100, 0),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    anchor
  };
}

export function normalizeSemanticItemPlacement(input: unknown): SemanticItemPlacement {
  if (!isRecord(input) || input["mode"] !== "card") {
    return {
      mode: "flow",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      anchor: "top-left"
    };
  }

  const anchor = validAnchors.has(input["anchor"] as SemanticItemPlacement["anchor"])
    ? (input["anchor"] as SemanticItemPlacement["anchor"])
    : "top-left";

  return {
    mode: "card",
    x: clampNumber(input["x"], 0, 100, 0),
    y: clampNumber(input["y"], 0, 100, 0),
    width: clampNumber(input["width"], 1, 100, 1),
    height: clampNumber(input["height"], 1, 100, 1),
    anchor
  };
}

export function normalizeBodyNumberDefault(input: unknown): BodyNumberDefault {
  return validBodyNumberDefaults.has(input as BodyNumberDefault) ? (input as BodyNumberDefault) : "show";
}

export function normalizeBodyNumberMode(input: unknown): BodyNumberMode {
  return validBodyNumberModes.has(input as BodyNumberMode) ? (input as BodyNumberMode) : "inherit";
}

export function isBodyNumberVisible(globalDefault: unknown, cardMode: unknown): boolean {
  const normalizedCardMode = normalizeBodyNumberMode(cardMode);
  if (normalizedCardMode === "show") {
    return true;
  }
  if (normalizedCardMode === "hide") {
    return false;
  }
  return normalizeBodyNumberDefault(globalDefault) === "show";
}

function normalizeMediaId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAudioSourceId(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return normalizeMediaId(value) ?? null;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function optionalClampedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
