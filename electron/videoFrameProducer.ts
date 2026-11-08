import { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCardText } from "../src/domain/cardParser.js";
import type { Card, CardnewsError, CardOverride, Deck, MediaAssetRef, WorkspaceState } from "../src/domain/types.js";
import { buildCardHtml } from "../src/render-engine/cardTemplate.js";
import { createRenderWindowOptions } from "../src/render-engine/renderWindowConfig.js";
import type { StylePreset } from "../src/render-engine/stylePresets.js";
import type { VideoExportPlan } from "../src/domain/videoExport.js";
import {
  compileVideoTimeline,
  findCompiledTransitionAt,
  findCompiledSceneAt,
  getFrameTimestampMs,
  type CompiledVideoScene,
  type CompiledVideoTransition,
  type FrameOwnershipManifest
} from "../src/domain/videoTimeline.js";
import type { VideoFrame, VideoFrameProducer } from "./videoExporter.js";

export type FrameCaptureLoadInput = {
  readonly cardIndex: number;
  readonly html: string;
  readonly ownership: FrameOwnershipManifest;
  readonly timestampMs: number;
};

export type FrameCaptureAdapter = {
  readonly loadCard: (input: FrameCaptureLoadInput) => Promise<void>;
  readonly seek: (timestampMs: number, ownership?: FrameOwnershipManifest) => Promise<void>;
  readonly captureRgba: () => Promise<Buffer>;
  readonly close: () => Promise<void>;
};

export type CreateWorkspaceFrameProducerInput = {
  readonly workspace: WorkspaceState;
  readonly totalFrames: number;
  readonly storageRoot: string;
  readonly signal?: AbortSignal;
  readonly fontCss?: string;
  readonly customStyles?: readonly StylePreset[];
  readonly captureAdapter?: FrameCaptureAdapter;
  readonly createCaptureAdapter?: (plan: VideoExportPlan) => Promise<FrameCaptureAdapter> | FrameCaptureAdapter;
};

export type TransitionCompositeInput = {
  readonly outgoing: Buffer;
  readonly incoming: Buffer;
  readonly width: number;
  readonly height: number;
  readonly progress: number;
  readonly type: "fade" | "slide-left" | "slide-up";
};

const videoSurfaceCss = `
  <style id="cardnews-video-export-surface">
    html, body { width: 1080px; height: 1920px; margin: 0; overflow: hidden; background: #fff; }
    .card { width: 1080px !important; height: 1920px !important; }
    .layer-video, .photo[data-media-kind="video"] { background-image: none !important; }
    .cardnews-export-video { display: block; height: 100%; inset: 0; object-position: center; position: absolute; width: 100%; }
  </style>`;

export function createWorkspaceFrameProducer(input: CreateWorkspaceFrameProducerInput): VideoFrameProducer {
  return async function* produceFrames(plan): AsyncIterable<VideoFrame> {
    const deck = buildDeckFromWorkspace(input.workspace);
    const timeline = compileVideoTimeline(deck);
    const createAdapter = input.createCaptureAdapter ?? createBrowserWindowCaptureAdapter;
    const primaryAdapter = input.captureAdapter ?? (await createAdapter(plan));
    let transitionAdapter: FrameCaptureAdapter | undefined;
    const loadedCardByAdapter = new Map<FrameCaptureAdapter, number>();

    try {
      for (let index = 1; index <= input.totalFrames; index += 1) {
        throwIfAborted(input.signal);
        const frameIndex = index - 1;
        const timestampMs = getFrameTimestampMs(frameIndex, plan.fps as 30);
        const scene = findCompiledSceneAt(timeline, timestampMs);
        const transition = findCompiledTransitionAt(timeline, timestampMs);
        const data = transition
          ? await captureTransitionFrame(
              transition,
              primaryAdapter,
              transitionAdapter ?? (transitionAdapter = await createAdapter(plan)),
              loadedCardByAdapter,
              deck,
              input,
              plan,
              timestampMs
            )
          : await captureSceneFrame(
              scene,
              primaryAdapter,
              loadedCardByAdapter,
              deck,
              input,
              plan,
              timestampMs
            );
        if (data.byteLength !== plan.width * plan.height * 4) {
          throw new Error(`Captured frame size mismatch: expected ${plan.width * plan.height * 4}, got ${data.byteLength}`);
        }
        if (isBlankRgba(data)) {
          throw new Error(`Captured frame ${index} for card ${scene.cardIndex} was blank.`);
        }
        yield { index, data };
      }
    } finally {
      await Promise.all(
        [...new Set([primaryAdapter, transitionAdapter].filter((adapter): adapter is FrameCaptureAdapter => Boolean(adapter)))]
          .map((adapter) => adapter.close())
      );
    }
  };
}

async function captureTransitionFrame(
  transition: CompiledVideoTransition,
  outgoingAdapter: FrameCaptureAdapter,
  incomingAdapter: FrameCaptureAdapter,
  loadedCardByAdapter: Map<FrameCaptureAdapter, number>,
  deck: Deck,
  input: CreateWorkspaceFrameProducerInput,
  plan: VideoExportPlan,
  timestampMs: number
): Promise<Buffer> {
  const [outgoing, incoming] = await Promise.all([
    captureSceneFrame(
      transition.outgoing,
      outgoingAdapter,
      loadedCardByAdapter,
      deck,
      input,
      plan,
      timestampMs
    ),
    captureSceneFrame(
      transition.incoming,
      incomingAdapter,
      loadedCardByAdapter,
      deck,
      input,
      plan,
      timestampMs
    )
  ]);
  return compositeTransitionRgba({
    outgoing,
    incoming,
    width: plan.width,
    height: plan.height,
    progress: transition.progress,
    type: transition.type
  });
}

async function captureSceneFrame(
  scene: CompiledVideoScene,
  adapter: FrameCaptureAdapter,
  loadedCardByAdapter: Map<FrameCaptureAdapter, number>,
  deck: Deck,
  input: CreateWorkspaceFrameProducerInput,
  plan: VideoExportPlan,
  timestampMs: number
): Promise<Buffer> {
  const localTimestampMs = Math.max(0, Math.min(scene.durationMs, timestampMs - scene.startMs));
  const ownership: FrameOwnershipManifest = {
    ...scene.ownership,
    localTimeMs: localTimestampMs
  };
  if (loadedCardByAdapter.get(adapter) !== scene.cardIndex) {
    const card = deck.cards.find((candidate) => candidate.index === scene.cardIndex);
    if (!card) {
      throw new Error(`Compiled timeline references missing card ${scene.cardIndex}.`);
    }
    const override = deck.overrides?.[String(scene.cardIndex)];
    await adapter.loadCard({
      cardIndex: scene.cardIndex,
      html: buildVideoCardHtml({
        card,
        customStyles: input.customStyles ?? [],
        deck,
        plan,
        scene,
        storageRoot: input.storageRoot,
        ...(input.fontCss ? { fontCss: input.fontCss } : {}),
        ...(override ? { override } : {})
      }),
      ownership,
      timestampMs: localTimestampMs
    });
    loadedCardByAdapter.set(adapter, scene.cardIndex);
  }
  throwIfAborted(input.signal);
  await adapter.seek(localTimestampMs, ownership);
  throwIfAborted(input.signal);
  return adapter.captureRgba();
}

export function compositeTransitionRgba(input: TransitionCompositeInput): Buffer {
  const expectedBytes = input.width * input.height * 4;
  if (input.outgoing.byteLength !== expectedBytes || input.incoming.byteLength !== expectedBytes) {
    throw new Error("Transition frame size mismatch.");
  }
  const progress = Math.max(0, Math.min(1, input.progress));
  if (input.type === "fade") {
    const output = Buffer.allocUnsafe(expectedBytes);
    for (let offset = 0; offset < expectedBytes; offset += 1) {
      output[offset] = Math.round(
        (input.outgoing[offset] ?? 0) * (1 - progress) + (input.incoming[offset] ?? 0) * progress
      );
    }
    return output;
  }
  const output = Buffer.alloc(expectedBytes);
  const horizontal = input.type === "slide-left";
  const shift = Math.round((horizontal ? input.width : input.height) * progress);
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const outgoingX = horizontal ? x + shift : x;
      const outgoingY = horizontal ? y : y + shift;
      const incomingX = horizontal ? x - (input.width - shift) : x;
      const incomingY = horizontal ? y : y - (input.height - shift);
      const outputOffset = (y * input.width + x) * 4;
      const source =
        outgoingX >= 0 && outgoingX < input.width && outgoingY >= 0 && outgoingY < input.height
          ? { frame: input.outgoing, x: outgoingX, y: outgoingY }
          : { frame: input.incoming, x: incomingX, y: incomingY };
      const sourceOffset = (source.y * input.width + source.x) * 4;
      source.frame.copy(output, outputOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return output;
}

function buildDeckFromWorkspace(workspace: WorkspaceState): Deck {
  const cards: Card[] = [];
  workspace.cards.forEach((rawText, offset) => {
    const parsed = parseCardText(rawText, offset + 1);
    if (isCardnewsError(parsed)) {
      throw new Error(`카드 ${offset + 1}: ${parsed.message}`);
    }
    cards.push(parsed);
  });

  return {
    id: "current",
    headerLabel: workspace.headerLabel,
    footerAccount: workspace.footerAccount,
    cards,
    styleId: workspace.styleId,
    ...(workspace.chrome ? { chrome: workspace.chrome } : {}),
    ...(workspace.accentColor ? { accentColor: workspace.accentColor } : {}),
    ...(typeof workspace.backgroundDim === "number" ? { backgroundDim: workspace.backgroundDim } : {}),
    ...(workspace.backgroundId ? { backgroundId: workspace.backgroundId } : {}),
    ...(workspace.backgroundMedia ? { backgroundMedia: workspace.backgroundMedia } : {}),
    ...(workspace.mediaAssets ? { mediaAssets: workspace.mediaAssets } : {}),
    ...(workspace.sceneDefaults ? { sceneDefaults: workspace.sceneDefaults } : {}),
    ...(workspace.bodyNumberDefault ? { bodyNumberDefault: workspace.bodyNumberDefault } : {}),
    ...(workspace.fontId ? { fontId: workspace.fontId } : {}),
    ...(workspace.nextHint ? { nextHint: workspace.nextHint } : {}),
    ...(workspace.overrides ? { overrides: workspace.overrides } : {})
  };
}

function isCardnewsError(value: unknown): value is CardnewsError {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

function buildVideoCardHtml(input: {
  readonly card: Card;
  readonly customStyles: readonly StylePreset[];
  readonly deck: Deck;
  readonly fontCss?: string;
  readonly override?: CardOverride;
  readonly plan: VideoExportPlan;
  readonly scene: CompiledVideoScene;
  readonly storageRoot: string;
}): string {
  const assetCssUrls = buildAssetCssUrls(input.deck.mediaAssets ?? [], input.storageRoot, "poster");
  const mediaUrls = buildAssetCssUrls(input.deck.mediaAssets ?? [], input.storageRoot, "media");
  const backgroundSource = input.scene.sources.find((source) => source.kind === "background");
  const html = buildCardHtml({
    assetCssUrls,
    backgroundCssUrl: undefined,
    card: input.card,
    customStyles: input.customStyles,
    deck: input.deck,
    ...(input.fontCss ? { fontCss: input.fontCss } : {}),
    ...(input.override ? { override: input.override } : {})
  });

  return html
    .replace("</head>", `${videoSurfaceCss}</head>`)
    .replace(
      `data-slot="background" data-media-kind="video"`,
      backgroundSource
        ? `data-slot="background" data-media-kind="video" data-media-id="${escapeAttribute(backgroundSource.mediaId)}" data-source-id="${escapeAttribute(backgroundSource.sourceId)}" data-clip-start-ms="${backgroundSource.clipStartMs}"${backgroundSource.clipEndMs !== null ? ` data-clip-end-ms="${backgroundSource.clipEndMs}"` : ""}`
        : `data-slot="background" data-media-kind="video"`
    )
    .replace(
      "</body>",
      `<script>${buildVideoReadinessScript(mediaUrls, input.plan.width, input.plan.height, input.scene)}</script></body>`
    );
}

function buildAssetCssUrls(
  assets: readonly MediaAssetRef[],
  storageRoot: string,
  mode: "media" | "poster"
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    assets.map((asset) => {
      const relativePath = mode === "poster" && asset.kind === "video"
        ? asset.posterRelativePath ?? asset.relativePath
        : asset.relativePath;
      return [asset.id, pathToFileURL(resolveManagedMediaPath(storageRoot, relativePath)).toString()];
    })
  );
}

function resolveManagedMediaPath(storageRoot: string, relativePath: string): string {
  return path.join(storageRoot, "media", ...relativePath.split("/"));
}

function buildVideoReadinessScript(
  mediaUrls: Readonly<Record<string, string>>,
  width: number,
  height: number,
  scene: CompiledVideoScene
): string {
  const sourceMetadata = Object.fromEntries(
    scene.sources.map((source) => [
      source.sourceId,
      {
        clipStartMs: source.clipStartMs,
        clipEndMs: source.clipEndMs,
        layerId: source.layerId ?? null,
        mediaId: source.mediaId
      }
    ])
  );
  return `
    (() => {
      const mediaUrls = ${JSON.stringify(mediaUrls)};
      const sourceMetadata = ${JSON.stringify(sourceMetadata)};
      const target = { width: ${width}, height: ${height} };
      function attachVideo(container) {
        const mediaId = container.getAttribute("data-media-id");
        const source = mediaId ? mediaUrls[mediaId] : undefined;
        if (!source || container.querySelector("video")) return;
        const video = document.createElement("video");
        video.className = "cardnews-export-video";
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = source;
        video.style.objectFit = container.style.backgroundSize === "contain" ? "contain" : "cover";
        container.appendChild(video);
      }
      document.querySelectorAll('[data-media-kind="video"]').forEach((container) => {
        const mediaId = container.getAttribute("data-media-id");
        const slot = container.getAttribute("data-slot") || "";
        const layerId = container.getAttribute("data-layer-id") || (slot.startsWith("layer-") ? slot.slice("layer-".length) : null);
        const match = Object.entries(sourceMetadata).find(([_sourceId, source]) =>
          source.mediaId === mediaId && (!source.layerId || source.layerId === layerId)
        );
        if (match) {
          const [sourceId, source] = match;
          container.setAttribute("data-source-id", sourceId);
          if (source.layerId) container.setAttribute("data-layer-id", source.layerId);
          container.setAttribute("data-clip-start-ms", String(source.clipStartMs));
          if (source.clipEndMs !== null) container.setAttribute("data-clip-end-ms", String(source.clipEndMs));
        }
      });
      document.querySelectorAll('[data-media-kind="video"]').forEach(attachVideo);
      window.__CARDNEWS_VIDEO_SEEK__ = async (timestampMs, expected) => {
        const videos = Array.from(document.querySelectorAll("video.cardnews-export-video"));
        await Promise.all(videos.map(async (video) => {
          if (video.readyState < 1) {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Video metadata timeout")), 5000);
              video.addEventListener("loadedmetadata", () => {
                clearTimeout(timeout);
                resolve(true);
              }, { once: true });
              video.addEventListener("error", () => {
                clearTimeout(timeout);
                reject(new Error("Video metadata failed"));
              }, { once: true });
              video.load();
            });
          }
          const parent = video.parentElement;
          const clipStartMs = Number(parent?.getAttribute("data-clip-start-ms") || "0");
          const clipEndRaw = parent?.getAttribute("data-clip-end-ms") || "";
          const clipEndMs = clipEndRaw ? Number(clipEndRaw) : Number.NaN;
          const sourceDurationMs = Number.isFinite(video.duration) ? video.duration * 1000 : clipStartMs + timestampMs;
          const endMs = Number.isFinite(clipEndMs) ? clipEndMs : sourceDurationMs;
          const seekMs = Math.min(Math.max(clipStartMs, endMs - 1000 / 30), clipStartMs + Math.max(0, timestampMs));
          const targetSeconds = Math.max(0, seekMs / 1000);
          if (Math.abs(video.currentTime - targetSeconds) > 0.001) {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Video seek timeout")), 5000);
              video.addEventListener("seeked", () => {
                clearTimeout(timeout);
                resolve(true);
              }, { once: true });
              video.addEventListener("error", () => {
                clearTimeout(timeout);
                reject(new Error("Video seek failed"));
              }, { once: true });
              video.currentTime = targetSeconds;
            });
          }
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const activeMediaIds = Array.from(new Set(videos.map((video) => video.parentElement?.getAttribute("data-media-id")).filter(Boolean))).sort();
        const activeVideoLayerIds = Array.from(new Set(videos.map((video) => video.parentElement?.getAttribute("data-layer-id")).filter(Boolean))).sort();
        const actual = {
          activeMediaIds,
          activeVideoLayerIds,
          cardIndex: ${scene.cardIndex}
        };
        if (expected) {
          const same = (left, right) => JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
          if (actual.cardIndex !== expected.cardIndex || !same(activeMediaIds, expected.activeMediaIds) || !same(activeVideoLayerIds, expected.activeVideoLayerIds)) {
            throw new Error("Frame ownership mismatch: " + JSON.stringify({ expected, actual }));
          }
        }
        return {
          ...actual,
          cardExists: Boolean(document.querySelector(".card")),
          height: window.innerHeight,
          videoCount: videos.length,
          width: window.innerWidth,
          target
        };
      };
    })();
  `;
}

async function createBrowserWindowCaptureAdapter(plan: VideoExportPlan): Promise<FrameCaptureAdapter> {
  const dimensions = { width: plan.width, height: plan.height };
  const window = new BrowserWindow(createRenderWindowOptions(dimensions));
  window.setContentSize(plan.width, plan.height);
  window.webContents.setZoomFactor(1);
  window.webContents.setFrameRate(plan.fps);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-video-"));
  let htmlCounter = 0;

  return {
    loadCard: async ({ html }) => {
      htmlCounter += 1;
      const htmlPath = path.join(tempRoot, `card-${htmlCounter}.html`);
      await fs.writeFile(htmlPath, html, "utf8");
      await window.loadURL(pathToFileURL(htmlPath).toString());
      await waitForDocumentReadiness(window, plan.width, plan.height);
    },
    seek: async (timestampMs, ownership) => {
      const result = await window.webContents.executeJavaScript(`
        window.__CARDNEWS_VIDEO_SEEK__
          ? window.__CARDNEWS_VIDEO_SEEK__(${JSON.stringify(timestampMs)}, ${JSON.stringify(ownership)})
          : { cardExists: Boolean(document.querySelector(".card")), width: window.innerWidth, height: window.innerHeight, videoCount: 0 }
      `) as unknown;
      if (!isReadyProbe(result, plan.width, plan.height)) {
        throw new Error("카드 HTML이 MP4 캡처 준비 상태에 도달하지 못했습니다.");
      }
    },
    captureRgba: async () => {
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: plan.width, height: plan.height });
      return nativeBitmapToRgba(image.toBitmap());
    },
    close: async () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
      await fs.rm(tempRoot, { force: true, recursive: true }).catch(() => undefined);
    }
  };
}

async function waitForDocumentReadiness(window: BrowserWindow, width: number, height: number): Promise<void> {
  const ready = await window.webContents.executeJavaScript(`
    (async () => {
      const fontsReady = await Promise.race([
        document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000))
      ]);
      const imagesReady = await Promise.race([
        Promise.all(Array.from(document.images).map((image) => {
          if (image.complete) return image.naturalWidth > 0 || !image.currentSrc;
          return new Promise((resolve) => {
            image.addEventListener("load", () => resolve(true), { once: true });
            image.addEventListener("error", () => resolve(false), { once: true });
          });
        })).then((values) => values.every(Boolean)),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000))
      ]);
      return {
        cardExists: Boolean(document.querySelector(".card")),
        fontsReady,
        imagesReady,
        height: window.innerHeight,
        width: window.innerWidth
      };
    })()
  `) as unknown;
  if (!isReadyProbe(ready, width, height)) {
    throw new Error("카드 HTML이 비어 있거나 렌더 준비 상태에 도달하지 못했습니다.");
  }
}

function isReadyProbe(value: unknown, width: number, height: number): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record["cardExists"] === true && record["width"] === width && record["height"] === height;
}

function nativeBitmapToRgba(bitmap: Buffer): Buffer {
  const rgba = Buffer.allocUnsafe(bitmap.byteLength);
  for (let offset = 0; offset + 3 < bitmap.byteLength; offset += 4) {
    rgba[offset] = bitmap[offset + 2] ?? 0;
    rgba[offset + 1] = bitmap[offset + 1] ?? 0;
    rgba[offset + 2] = bitmap[offset] ?? 0;
    rgba[offset + 3] = bitmap[offset + 3] ?? 0;
  }
  return rgba;
}

function isBlankRgba(data: Buffer): boolean {
  for (const byte of data) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("MP4 export was cancelled.");
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
