import {
  defaultCardSceneSettings,
  minSceneDurationMs,
  normalizeCardSceneSettings,
  normalizeVideoLayer
} from "./media.js";
import { resolveEffectiveCardBackgroundMedia, type EffectiveBackgroundMedia } from "./mediaResolver.js";
import type { Card, CardSceneSettings, CardVideoLayer, Deck, MediaAssetRef } from "./types.js";

export const videoTimelineFrameRate = 30;
export const videoTimelineWidth = 1080;
export const videoTimelineHeight = 1920;
export const videoTimelineMaxSceneDurationMs = 180_000;
export const videoTimelineMaxDurationMs = 600_000;

export type CompiledVideoSource = {
  readonly sourceId: string;
  readonly mediaId: string;
  readonly kind: "background" | "layer";
  readonly layerId?: string;
  readonly hasAudio: boolean;
  readonly muted: boolean;
  readonly clipStartMs: number;
  readonly clipEndMs: number | null;
  readonly volume: number;
  readonly playback: "play-through" | "final-frame-hold";
};

export type CompiledVideoDurationMode = "fixed" | "fit-primary-video";

export type FrameOwnershipManifest = {
  readonly cardIndex: number;
  readonly sceneId: string;
  readonly localTimeMs: number;
  readonly activeMediaIds: readonly string[];
  readonly activeVideoLayerIds: readonly string[];
};

export type CompiledVideoScene = {
  readonly id: string;
  readonly cardIndex: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly endMs: number;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly durationMode: CompiledVideoDurationMode;
  readonly transition: CardSceneSettings["transition"];
  readonly transitionMs: number;
  readonly primaryAudioSourceId: string | null;
  readonly ownership: Omit<FrameOwnershipManifest, "localTimeMs">;
  readonly background: EffectiveBackgroundMedia;
  readonly videoLayers: readonly CardVideoLayer[];
  readonly sources: readonly CompiledVideoSource[];
  readonly warnings: readonly string[];
};

export type CompiledVideoTimeline = {
  readonly width: 1080;
  readonly height: 1920;
  readonly frameRate: 30;
  readonly durationMs: number;
  readonly frameCount: number;
  readonly scenes: readonly CompiledVideoScene[];
  readonly digest: string;
  readonly warnings: readonly string[];
};

export type CompiledVideoTransition = {
  readonly outgoing: CompiledVideoScene;
  readonly incoming: CompiledVideoScene;
  readonly progress: number;
  readonly timestampMs: number;
  readonly type: Exclude<CardSceneSettings["transition"], "none">;
};

export function compileVideoTimeline(deck: Pick<Deck, "cards" | "overrides" | "backgroundId" | "backgroundMedia" | "mediaAssets" | "sceneDefaults">): CompiledVideoTimeline {
  const assets = new Map((deck.mediaAssets ?? []).map((asset) => [asset.id, asset]));
  const sceneDefaults = normalizeCardSceneSettings(deck.sceneDefaults, defaultCardSceneSettings);
  const sceneInputs = deck.cards.map((card, index) => {
    const override = deck.overrides?.[String(card.index)] ?? deck.overrides?.[String(index + 1)];
    const scene = normalizeCardSceneSettings(override?.scene, sceneDefaults);
    const durationMode = getDurationMode(override?.scene ?? scene);
    const background = resolveEffectiveCardBackgroundMedia(deck, card, override);
    const videoLayers = (override?.layers ?? [])
      .filter((layer): layer is CardVideoLayer => layer.kind === "video")
      .map((layer) => normalizeVideoLayer(layer, assets.get(layer.mediaId)?.durationMs));

    return {
      card,
      override,
      scene,
      durationMode,
      background,
      videoLayers
    };
  });

  const compiledScenes: CompiledVideoScene[] = [];
  const timelineWarnings: string[] = [];
  let cursorMs = 0;

  for (let index = 0; index < sceneInputs.length; index += 1) {
    const input = sceneInputs[index]!;
    const next = sceneInputs[index + 1];
    const transitionMs = next
      ? clampTransitionForAdjacentScenes(input.scene.transition, input.scene.transitionMs, resolveSceneDurationMs(input.scene, input.durationMode, input.background, input.videoLayers, assets), resolveSceneDurationMs(next.scene, next.durationMode, next.background, next.videoLayers, assets))
      : 0;
    const durationMs = resolveSceneDurationMs(input.scene, input.durationMode, input.background, input.videoLayers, assets);
    const startMs = cursorMs;
    const endMs = startMs + durationMs;
    const sceneWarnings = [...input.background.warnings];
    const sources = compileSceneSources(input.card, input.background, input.videoLayers, assets, input.scene, durationMs, sceneWarnings);
    const id = `scene:${input.card.index}`;
    const startFrame = getFrameCount(startMs);
    const endFrameExclusive = getFrameCount(endMs);
    timelineWarnings.push(...sceneWarnings);

    compiledScenes.push({
      id,
      cardIndex: input.card.index,
      startMs,
      durationMs,
      endMs,
      startFrame,
      endFrameExclusive,
      durationMode: input.durationMode,
      transition: transitionMs > 0 ? input.scene.transition : "none",
      transitionMs,
      primaryAudioSourceId: sources.primaryAudioSourceId,
      ownership: {
        cardIndex: input.card.index,
        sceneId: id,
        activeMediaIds: unique(sources.sources.map((source) => source.mediaId)),
        activeVideoLayerIds: sources.sources
          .filter((source) => source.kind === "layer" && source.layerId)
          .map((source) => source.layerId as string)
      },
      background: input.background,
      videoLayers: input.videoLayers,
      sources: sources.sources,
      warnings: sceneWarnings
    });

    cursorMs = endMs - transitionMs;
  }

  const durationMs = Math.max(0, compiledScenes.length === 0 ? 0 : compiledScenes[compiledScenes.length - 1]!.endMs);
  if (durationMs > videoTimelineMaxDurationMs) {
    throw new RangeError(`Compiled video timeline exceeds ${videoTimelineMaxDurationMs}ms.`);
  }
  return {
    width: videoTimelineWidth,
    height: videoTimelineHeight,
    frameRate: videoTimelineFrameRate,
    durationMs,
    frameCount: getFrameCount(durationMs),
    scenes: compiledScenes,
    digest: buildTimelineDigest(compiledScenes, durationMs),
    warnings: timelineWarnings
  };
}

export function getFrameTimestampMs(frameIndex: number, frameRate: 30 = videoTimelineFrameRate): number {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError(`Frame index must be a non-negative integer: ${frameIndex}`);
  }
  return (frameIndex * 1000) / frameRate;
}

export function findCompiledSceneAt(timeline: CompiledVideoTimeline, timestampMs: number): CompiledVideoScene {
  if (timeline.scenes.length === 0) {
    throw new RangeError("Compiled video timeline has no scenes.");
  }
  const bounded = Math.max(0, Math.min(timestampMs, Math.max(0, timeline.durationMs - Number.EPSILON)));
  return timeline.scenes.find((scene) => bounded >= scene.startMs && bounded < scene.endMs) ?? timeline.scenes[timeline.scenes.length - 1]!;
}

export function findCompiledTransitionAt(
  timeline: CompiledVideoTimeline,
  timestampMs: number
): CompiledVideoTransition | null {
  for (let index = 0; index + 1 < timeline.scenes.length; index += 1) {
    const outgoing = timeline.scenes[index]!;
    const incoming = timeline.scenes[index + 1]!;
    if (
      outgoing.transition === "none" ||
      outgoing.transitionMs <= 0 ||
      timestampMs < incoming.startMs ||
      timestampMs >= outgoing.endMs
    ) {
      continue;
    }
    return {
      outgoing,
      incoming,
      progress: clampNumber((timestampMs - incoming.startMs) / outgoing.transitionMs, 0, 1),
      timestampMs,
      type: outgoing.transition
    };
  }
  return null;
}

export function getFrameOwnershipManifest(timeline: CompiledVideoTimeline, frameIndex: number): FrameOwnershipManifest {
  const timestampMs = getFrameTimestampMs(frameIndex, timeline.frameRate);
  const scene = findCompiledSceneAt(timeline, timestampMs);
  return {
    ...scene.ownership,
    localTimeMs: Math.max(0, Math.min(scene.durationMs, timestampMs - scene.startMs))
  };
}

function compileSceneSources(
  card: Card,
  background: EffectiveBackgroundMedia,
  videoLayers: readonly CardVideoLayer[],
  assets: ReadonlyMap<string, MediaAssetRef>,
  scene: CardSceneSettings,
  sceneDurationMs: number,
  warnings: string[]
): { readonly primaryAudioSourceId: string | null; readonly sources: readonly CompiledVideoSource[] } {
  const rawSources: CompiledVideoSource[] = [];

  if (background.status === "asset" && background.asset.kind === "video") {
    rawSources.push({
      sourceId: backgroundSourceId(card.index),
      mediaId: background.asset.id,
      kind: "background",
      hasAudio: background.asset.hasAudio === true,
      muted: true,
      clipStartMs: 0,
      clipEndMs: background.asset.durationMs ?? null,
      volume: 1,
      playback: getPlaybackPolicy(sceneDurationMs, background.asset.durationMs ?? null)
    });
  }

  for (const layer of videoLayers) {
    const asset = assets.get(layer.mediaId);
    if (!asset) {
      warnings.push(`Missing video layer media asset on card ${card.index}: ${layer.mediaId}`);
    }

    rawSources.push({
      sourceId: layerSourceId(layer.id),
      mediaId: layer.mediaId,
      kind: "layer",
      layerId: layer.id,
      hasAudio: asset?.hasAudio === true,
      muted: true,
      clipStartMs: layer.clipStartMs,
      clipEndMs: layer.clipEndMs,
      volume: layer.volume,
      playback: getPlaybackPolicy(sceneDurationMs, getClipDurationMs(layer, asset))
    });
  }

  const primaryAudioSourceId = resolvePrimaryAudioSource(card.index, scene.primaryAudioSourceId, rawSources, warnings);
  return {
    primaryAudioSourceId,
    sources: rawSources.map((source) => ({
      ...source,
      muted: source.sourceId !== primaryAudioSourceId
    }))
  };
}

function resolvePrimaryAudioSource(
  cardIndex: number,
  requestedPrimary: string | null,
  sources: readonly CompiledVideoSource[],
  warnings: string[]
): string | null {
  if (!requestedPrimary) {
    return null;
  }

  const source = sources.find((candidate) => candidate.sourceId === requestedPrimary);
  if (!source || !source.hasAudio || source.volume <= 0) {
    warnings.push(`Primary audio source is unavailable on card ${cardIndex}: ${requestedPrimary}`);
    return null;
  }

  return source.sourceId;
}

function clampTransitionForAdjacentScenes(
  transition: CardSceneSettings["transition"],
  transitionMs: number,
  currentDurationMs: number,
  nextDurationMs: number
): number {
  if (transition === "none") {
    return 0;
  }
  return Math.min(transitionMs, Math.floor(currentDurationMs / 2), Math.floor(nextDurationMs / 2));
}

function getPlaybackPolicy(sceneDurationMs: number, sourceDurationMs: number | null): CompiledVideoSource["playback"] {
  return sourceDurationMs !== null && sourceDurationMs < sceneDurationMs ? "final-frame-hold" : "play-through";
}

function getClipDurationMs(layer: CardVideoLayer, asset: MediaAssetRef | undefined): number | null {
  if (!asset?.durationMs) {
    return null;
  }
  const clipEnd = layer.clipEndMs ?? asset.durationMs;
  return Math.max(0, clipEnd - layer.clipStartMs);
}

function getFrameCount(durationMs: number): number {
  return Math.ceil((durationMs / 1000) * videoTimelineFrameRate);
}

function getDurationMode(scene: CardSceneSettings): CompiledVideoDurationMode {
  const value = (scene as unknown as Record<string, unknown>)["durationMode"];
  return value === "fit-primary-video" ? "fit-primary-video" : "fixed";
}

function resolveSceneDurationMs(
  scene: CardSceneSettings,
  durationMode: CompiledVideoDurationMode,
  background: EffectiveBackgroundMedia,
  videoLayers: readonly CardVideoLayer[],
  assets: ReadonlyMap<string, MediaAssetRef>
): number {
  if (durationMode !== "fit-primary-video") {
    return scene.durationMs;
  }
  const primaryDuration = getPrimaryVideoDurationMs(background, videoLayers, assets);
  return clampNumber(primaryDuration ?? scene.durationMs, minSceneDurationMs, videoTimelineMaxSceneDurationMs);
}

function getPrimaryVideoDurationMs(
  background: EffectiveBackgroundMedia,
  videoLayers: readonly CardVideoLayer[],
  assets: ReadonlyMap<string, MediaAssetRef>
): number | undefined {
  if (background.status === "asset" && background.asset.kind === "video" && background.asset.durationMs) {
    return background.asset.durationMs;
  }
  for (const layer of videoLayers) {
    const durationMs = getClipDurationMs(layer, assets.get(layer.mediaId));
    if (durationMs && durationMs > 0) {
      return durationMs;
    }
  }
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function buildTimelineDigest(scenes: readonly CompiledVideoScene[], durationMs: number): string {
  return JSON.stringify({
    durationMs,
    scenes: scenes.map((scene) => ({
      cardIndex: scene.cardIndex,
      startMs: scene.startMs,
      endMs: scene.endMs,
      startFrame: scene.startFrame,
      endFrameExclusive: scene.endFrameExclusive,
      durationMode: scene.durationMode,
      transition: scene.transition,
      transitionMs: scene.transitionMs,
      activeMediaIds: scene.ownership.activeMediaIds,
      activeVideoLayerIds: scene.ownership.activeVideoLayerIds
    }))
  });
}

function backgroundSourceId(cardIndex: number): string {
  return `background:${cardIndex}`;
}

function layerSourceId(layerId: string): string {
  return `layer:${layerId}`;
}
