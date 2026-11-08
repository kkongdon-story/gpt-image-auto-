// noqa: SIZE_OK - Lite keeps one Electron bootstrap and IPC surface for edition-parity audits; split with main.ts only after a shared-main migration plan is approved.
import AdmZip from "adm-zip";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCardText } from "../src/domain/cardParser.js";
import { stripProDeck, stripProDeckDraft, stripProDeckPreset, stripProWorkspaceState } from "../src/domain/editionFilter.js";
import { isAllowedExternalUrl, isAllowedGptsTemplateBuilderUrl } from "../src/domain/externalLinks.js";
import {
  createPixabayApiUrl,
  createPixabayFallbackUrl,
  parsePixabayImages
} from "../src/domain/imageProviders.js";
import type {
  AppSettings,
  BackgroundLibraryItem,
  CardnewsError,
  CardnewsResult,
  Deck,
  DeckDraft,
  FontData,
  RenderJobResult,
  StockImageDownloadInput,
  StockImageSearchResult,
  StylePresetRecord,
  StyleProfile,
  WorkspaceState
} from "../src/domain/types.js";
import { buildFontFaceCss } from "../src/render-engine/cardTemplate.js";
import { renderDeckOffscreen } from "../src/render-engine/offscreenRenderer.js";
import { isSafeStylePresetRecord } from "../src/render-engine/styleSafety.js";
import {
  createMediaAssetUrl,
  installMediaProtocolHandler,
  registerMediaProtocolScheme
} from "./mediaProtocol.js";

// Windows 일부 배포/QA 환경에서 Chromium sandboxed GPU helper가 DLL 로드 실패
// (exit_code=-1073741515)로 offscreen paint를 시작하지 못한다. 앱은 로컬 파일만
// 로드하고 nodeIntegration=false/contextIsolation=true를 유지하므로 PNG 렌더 안정성을
// 위해 Chromium process sandbox를 끈다.
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();
registerMediaProtocolScheme();
import {
  addBackgroundToLibrary,
  addImageToLibrary,
  buildDeckFromDraft,
  copyImageToDeckAssets,
  currentDeckId,
  deleteCustomStyle,
  deleteDeckPresetFromStore,
  findLibraryBackground,
  findLibraryFont,
  findLibraryImage,
  fontCssFormatForExtension,
  fontMimeTypeForExtension,
  getCardnewsStorageRoot,
  getRenderOutputDirectory,
  isRenderJobId,
  importFontToLibrary,
  isDeckPreset,
  isWorkspaceState,
  listBackgroundLibrary,
  listCustomStyles,
  listDeckPresets,
  listFontLibrary,
  listImageLibrary,
  loadAppSettings,
  loadDeck,
  loadWorkspaceState,
  removeImageFromLibrary,
  removeBackgroundFromLibrary,
  saveAppSettings,
  saveCustomStyle,
  saveDeckDraft,
  saveDeckPresetToStore,
  saveWorkspaceState,
  type StoredLocalImage
} from "../src/storage/deckStore.js";
import {
  deleteMediaAsset,
  getMediaAsset,
  importMediaAsset,
  listMediaAssets,
  type MediaLibraryError,
  type MediaLibraryUsageRef
} from "../src/storage/mediaLibrary.js";
import type { Mp4ExportInput, Mp4ExportProgress } from "../src/domain/cardnews-api.js";
import { compileVideoTimeline } from "../src/domain/videoTimeline.js";
import { defaultFfmpegManifest, type FfmpegProbe } from "./ffmpegPreflight.js";
import { exportVideoMp4 } from "./videoExporter.js";
import type { VideoExportAudioSegment } from "./videoExporter.js";
import { createWorkspaceFrameProducer } from "./videoFrameProducer.js";
import { createVideoMediaProbe } from "./videoMediaProbe.js";
import { importTemplatePackArchive } from "./templatePackImporter.js";
import { runBackgroundManagerSmoke } from "./backgroundManagerSmoke.js";
import {
  createStockDownloadPath,
  fetchAllowedPixabayImage,
  isSafeStockImageDownloadInput,
  readResponseBytesWithLimit
} from "./stockImageDownload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
const smokeAction = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_ACTION"];
const smokeScreenshotPath = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_SCREENSHOT"];
const smokeTextPath = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_TEXT"];
const smokeViewportWidth = app.isPackaged
  ? undefined
  : process.env["CARDNEWS_SMOKE_VIEWPORT_WIDTH"];
const smokeViewportHeight = app.isPackaged
  ? undefined
  : process.env["CARDNEWS_SMOKE_VIEWPORT_HEIGHT"];
if (smokeAction) {
  const smokeUserDataPath = path.join(app.getPath("temp"), "cardnews-studio-smoke", `${process.pid}-${smokeAction}`);
  mkdirSync(smokeUserDataPath, { recursive: true });
  app.setPath("userData", smokeUserDataPath);
}
let selectedStyleReferenceImages: readonly StoredLocalImage[] = [];
let approvedStyleProfile: StyleProfile | undefined;

type SmokeActionResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

function invalidInput(message: string): { ok: false; code: "invalid_input"; message: string } {
  return { ok: false, code: "invalid_input", message };
}

function notImplemented(message: string): { ok: false; code: "not_implemented"; message: string } {
  return { ok: false, code: "not_implemented", message };
}

function styleExtractionFailed(message: string): {
  ok: false;
  code: "style_extraction_failed";
  message: string;
} {
  return { ok: false, code: "style_extraction_failed", message };
}

function externalServiceFailed(message: string): {
  ok: false;
  code: "external_service_failed";
  message: string;
} {
  return { ok: false, code: "external_service_failed", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function storageRoot(): string {
  return getCardnewsStorageRoot(app.getPath("userData"));
}

const activeVideoExports = new Map<string, AbortController>();

function mediaLibraryErrorWithUsages(
  error: MediaLibraryError,
  usages?: readonly MediaLibraryUsageRef[]
): MediaLibraryError & { readonly usages?: readonly MediaLibraryUsageRef[] } {
  return usages && usages.length > 0 ? { ...error, usages } : error;
}

function isMediaLibraryError(value: unknown): value is MediaLibraryError {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { readonly ok?: unknown }).ok === false
  );
}

async function chooseMediaFile(kind?: unknown): Promise<string | undefined> {
  const normalizedKind = kind === "image" || kind === "video" ? kind : undefined;
  const filters =
    normalizedKind === "image"
      ? [{ extensions: ["png", "jpg", "jpeg", "webp"], name: "Images" }]
      : normalizedKind === "video"
        ? [{ extensions: ["mp4"], name: "MP4 Video" }]
        : [{ extensions: ["png", "jpg", "jpeg", "webp", "mp4"], name: "Images and MP4 Video" }];
  const result = await dialog.showOpenDialog({ filters, properties: ["openFile"] });
  return result.canceled ? undefined : result.filePaths[0];
}

async function importManagedMedia(kind?: unknown): Promise<unknown> {
  const expectedKind = kind === "image" || kind === "video" ? kind : undefined;
  const filePath = await chooseMediaFile(expectedKind);
  if (!filePath) {
    return invalidInput("미디어 선택이 취소되었습니다.");
  }

  return importMediaAsset(storageRoot(), filePath, {
    ...(expectedKind ? { expectedKind } : {}),
    videoProbe: createVideoMediaProbe({
      trustedResourcesRoot: process.resourcesPath,
      ffmpegProbe: createFfmpegProbe(),
      pathApi: path.win32
    })
  });
}

async function getManagedMediaPreview(mediaId: unknown): Promise<unknown> {
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    return invalidInput("미디어 id가 올바르지 않습니다.");
  }
  const asset = await getMediaAsset(storageRoot(), mediaId);
  if (isMediaLibraryError(asset)) {
    return asset;
  }
  if (asset.missing) {
    return { ok: false, code: "not_found", message: "미디어 파일이 저장소에서 사라졌습니다." };
  }
  if (asset.kind === "video") {
    return createMediaAssetUrl(asset.id);
  }

  const previewPath = asset.posterAbsolutePath ?? asset.absolutePath;
  const image = nativeImage.createFromPath(previewPath);
  if (image.isEmpty()) {
    return { ok: false, code: "corrupt_media", message: "미디어 미리보기를 만들 수 없습니다." };
  }
  const { width } = image.getSize();
  const resized = width > 720 ? image.resize({ width: 720 }) : image;
  return `data:image/jpeg;base64,${resized.toJPEG(82).toString("base64")}`;
}

async function listManagedMediaUsage(mediaId: unknown): Promise<unknown> {
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    return invalidInput("미디어 id가 올바르지 않습니다.");
  }
  const workspace = await loadWorkspaceState(storageRoot());
  return workspace ? findMediaUsages(workspace, mediaId) : [];
}

async function deleteManagedMedia(mediaId: unknown): Promise<unknown> {
  if (typeof mediaId !== "string" || mediaId.length === 0) {
    return invalidInput("미디어 id가 올바르지 않습니다.");
  }
  const usages = (await listManagedMediaUsage(mediaId)) as readonly MediaLibraryUsageRef[];
  const result = await deleteMediaAsset(storageRoot(), { id: mediaId, usages });
  return isMediaLibraryError(result) ? mediaLibraryErrorWithUsages(result, usages) : result;
}

function findMediaUsages(workspace: WorkspaceState, mediaId: string): readonly MediaLibraryUsageRef[] {
  const usages: MediaLibraryUsageRef[] = [];
  if (workspace.backgroundMedia?.mode === "asset" && workspace.backgroundMedia.mediaId === mediaId) {
    usages.push({ workspaceId: "current", role: "global-background" });
  }
  for (const [cardIndex, override] of Object.entries(workspace.overrides ?? {})) {
    const numericCardIndex = Number.parseInt(cardIndex, 10);
    if (override.backgroundMedia?.mode === "asset" && override.backgroundMedia.mediaId === mediaId) {
      usages.push({ workspaceId: "current", cardIndex: numericCardIndex, role: "card-background" });
    }
    for (const layer of override.layers ?? []) {
      if (layer.kind === "video" && layer.mediaId === mediaId) {
        usages.push({ workspaceId: "current", cardIndex: numericCardIndex, layerId: layer.id, role: "video-layer" });
      }
      if (layer.kind === "image" && layer.backgroundId === mediaId) {
        usages.push({ workspaceId: "current", cardIndex: numericCardIndex, layerId: layer.id, role: "image-layer" });
      }
    }
  }
  return usages;
}

async function exportManagedVideo(input: unknown): Promise<unknown> {
  if (!isMp4ExportInput(input)) {
    return invalidInput("MP4 출력 입력 형식이 올바르지 않습니다.");
  }
  const result = await dialog.showSaveDialog({
    defaultPath: `cardnews-${new Date().toISOString().slice(0, 10)}.mp4`,
    filters: [{ extensions: ["mp4"], name: "MP4" }]
  });
  if (result.canceled || !result.filePath) {
    return invalidInput("MP4 저장이 취소되었습니다.");
  }

  const outputPath = ensureMp4Extension(result.filePath);
  const jobId = `video-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
  const controller = new AbortController();
  activeVideoExports.set(jobId, controller);
  const fontCss = await buildRenderFontCss(input.workspace.fontId);
  if (isCardnewsError(fontCss)) {
    activeVideoExports.delete(jobId);
    return fontCss;
  }
  const deck = buildDeckForVideoExport(input.workspace);
  if (isCardnewsError(deck)) {
    activeVideoExports.delete(jobId);
    return deck;
  }
  const timeline = compileVideoTimeline(deck);
  const totalFrames = timeline.frameCount;
  const audioSegments = await resolvePrimaryAudioSegments(timeline);

  let exported: Awaited<ReturnType<typeof exportVideoMp4>>;
  try {
    exported = await exportVideoMp4(
      {
        outputPath,
        outputRoot: path.dirname(outputPath),
        overwrite: input.overwrite === true,
        totalFrames,
        totalDurationMs: timeline.durationMs,
        ...(audioSegments.length > 0 ? { audioSegments } : {}),
        signal: controller.signal,
        onProgress: (progress) => broadcastVideoProgress({
          jobId,
          stage: progress.stage,
          percent: progress.percent,
          ...(progress.completedFrames !== undefined ? { completedFrames: progress.completedFrames } : {}),
          ...(progress.totalFrames !== undefined ? { totalFrames: progress.totalFrames } : {}),
          ...(progress.message ? { message: progress.message } : {}),
          ...(progress.elapsedMs !== undefined ? { elapsedMs: progress.elapsedMs } : {})
        })
      },
      {
        trustedResourcesRoot: process.resourcesPath,
        manifest: defaultFfmpegManifest,
        ffmpegProbe: createFfmpegProbe(),
        spawn,
        frameProducer: createWorkspaceFrameProducer({
          ...(fontCss ? { fontCss } : {}),
          signal: controller.signal,
          storageRoot: storageRoot(),
          totalFrames,
          workspace: input.workspace
        }),
        pathApi: path.win32
      }
    );
  } catch (error) {
    activeVideoExports.delete(jobId);
    if (controller.signal.aborted) {
      return { ok: false, code: "cancelled", message: "MP4 export was cancelled.", jobId };
    }
    throw error;
  }
  activeVideoExports.delete(jobId);
  if (exported.ok === false) {
    return { ...exported, jobId };
  }
  return { ok: true, jobId, filePath: exported.outputPath, framesWritten: exported.framesWritten };
}

async function resolvePrimaryAudioSegments(
  timeline: ReturnType<typeof compileVideoTimeline>
): Promise<readonly VideoExportAudioSegment[]> {
  const segments: VideoExportAudioSegment[] = [];
  for (const scene of timeline.scenes) {
    const primarySource = scene.sources.find((source) => source.hasAudio && !source.muted);
    if (!primarySource || primarySource.volume <= 0) {
      continue;
    }
    const asset = await getMediaAsset(storageRoot(), primarySource.mediaId);
    if (isMediaLibraryError(asset) || asset.missing || asset.kind !== "video" || asset.hasAudio !== true) {
      continue;
    }
    const sourceEndMs = primarySource.clipEndMs ?? asset.durationMs ?? primarySource.clipStartMs + scene.durationMs;
    const sourceDurationMs = Math.max(0, sourceEndMs - primarySource.clipStartMs);
    const durationMs = Math.min(scene.durationMs, sourceDurationMs);
    if (durationMs <= 0) {
      continue;
    }
    segments.push({
      path: asset.absolutePath,
      sceneStartMs: scene.startMs,
      clipStartMs: primarySource.clipStartMs,
      durationMs,
      volume: primarySource.volume
    });
  }
  return segments;
}

function buildDeckForVideoExport(workspace: WorkspaceState): CardnewsResult<Deck> {
  const cards: Deck["cards"][number][] = [];
  for (const [offset, rawText] of workspace.cards.entries()) {
    const parsed = parseCardText(rawText, offset + 1);
    if (isCardnewsError(parsed)) {
      return parsed;
    }
    cards.push(parsed);
  }

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

function cancelManagedVideoExport(jobId: unknown): { readonly ok: true; readonly jobId: string } | {
  readonly ok: false;
  readonly code: "invalid_input" | "cancelled";
  readonly message: string;
  readonly jobId?: string;
} {
  if (typeof jobId !== "string" || jobId.length === 0) {
    return { ok: false, code: "invalid_input", message: "MP4 작업 id가 올바르지 않습니다." };
  }
  const controller = activeVideoExports.get(jobId);
  if (!controller) {
    return { ok: false, code: "cancelled", message: "진행 중인 MP4 작업을 찾지 못했습니다.", jobId };
  }
  controller.abort();
  return { ok: true, jobId };
}

function isMp4ExportInput(input: unknown): input is Mp4ExportInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "workspace" in input &&
    isWorkspaceState((input as { readonly workspace?: unknown }).workspace)
  );
}

function createFfmpegProbe(): FfmpegProbe {
  return {
    run: (filePath, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(filePath, args, { windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(stderr || `FFmpeg probe exited with ${code ?? 1}`));
          }
        });
      })
  };
}

function broadcastVideoProgress(progress: Mp4ExportProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("cardnews:video:progress", progress);
  }
}

function ensureMp4Extension(filePath: string): string {
  return path.extname(filePath).toLowerCase() === ".mp4" ? filePath : `${filePath}.mp4`;
}

function parseSmokeWindowDimension(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 720 && parsedValue <= 4096
    ? parsedValue
    : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function captureSmokePng(mainWindow: BrowserWindow): Promise<Buffer> {
  if (!mainWindow.isVisible()) {
    mainWindow.showInactive();
    await delay(300);
  }

  let lastFailure = "capturePage returned no image";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await delay(500);
    try {
      const screenshot = await mainWindow.webContents.capturePage();
      if (!screenshot.isEmpty()) {
        return screenshot.toPNG();
      }
      lastFailure = "capturePage returned an empty image";
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "non-Error rejection";
    }
  }

  throw new Error(lastFailure);
}

async function reloadSmokeWindow(mainWindow: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onLoad = (): void => {
      clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = setTimeout(() => {
      mainWindow.webContents.removeListener("did-finish-load", onLoad);
      reject(new Error("Timed out waiting for template-pack smoke reload."));
    }, 10_000);
    mainWindow.webContents.once("did-finish-load", onLoad);
    mainWindow.webContents.reload();
  });
}

function createWindow(): void {
  const hasSmokeWindowSize =
    smokeViewportWidth !== undefined || smokeViewportHeight !== undefined;
  const smokeWindowWidth = hasSmokeWindowSize
    ? parseSmokeWindowDimension(smokeViewportWidth, 1280)
    : 1280;
  const smokeWindowHeight = hasSmokeWindowSize
    ? parseSmokeWindowDimension(smokeViewportHeight, 880)
    : 880;
  const mainWindow = new BrowserWindow({
    width: smokeWindowWidth,
    height: smokeWindowHeight,
    useContentSize: hasSmokeWindowSize,
    show: !hasSmokeWindowSize,
    paintWhenInitiallyHidden: true,
    minWidth: 1080,
    minHeight: 720,
    title: "Cardnews Studio Lite",
    backgroundColor: "#f4f7f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  if (hasSmokeWindowSize) {
    mainWindow.setContentSize(smokeWindowWidth, smokeWindowHeight);
  }

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.once("did-finish-load", () => {
      scheduleSmokeCapture(mainWindow);
    });
    return;
  }

  void mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => {
    scheduleSmokeCapture(mainWindow);
  });
}

function scheduleSmokeCapture(mainWindow: BrowserWindow): void {
  if (!smokeAction) {
    return;
  }

  setTimeout(() => {
    runSmokeCapture(mainWindow).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Unexpected smoke failure");
      app.exit(1);
    });
  }, 800);
}

async function runSmokeCapture(mainWindow: BrowserWindow): Promise<void> {
  const result = await runSmokeAction(mainWindow);

  if (smokeScreenshotPath) {
    await fs.mkdir(path.dirname(smokeScreenshotPath), { recursive: true });
    await fs.writeFile(smokeScreenshotPath, await captureSmokePng(mainWindow));
  }

  if (smokeTextPath) {
    const text = await mainWindow.webContents.executeJavaScript("document.body.innerText");
    await fs.mkdir(path.dirname(smokeTextPath), { recursive: true });
    await fs.writeFile(smokeTextPath, String(text), "utf8");
  }

  if (!result.ok) {
    console.error(result.message);
    mainWindow.destroy();
    app.exit(1);
    return;
  }

  console.log(`CARDNEWS_SMOKE_ACTION ${smokeAction ?? "none"} PASS`);
  mainWindow.destroy();
  app.exit(0);
}

async function runSmokeAction(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  switch (smokeAction) {
    case "edition-lite-regression":
      return await runEditionLiteRegressionSmoke(mainWindow);
    case "m15-toolbar":
      return await runM15LiteToolbarSmoke(mainWindow);
    case "background-manager-regression":
      return await runBackgroundManagerSmoke(mainWindow, storageRoot());
    case "edition-lite-basic-flow":
      return await runEditionLiteBasicFlowSmoke(mainWindow);
    case "template-pack-import":
      return await runTemplatePackImportSmoke(mainWindow);
    default:
      return { ok: false, message: `Unknown CARDNEWS_SMOKE_ACTION: ${smokeAction ?? ""}` };
  }
}

async function runM15LiteToolbarSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const node = document.querySelector(selector);
          if (node) {
            return node;
          }
          await wait(80);
        }
        throw new Error("Lite M15 toolbar selector missing: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await wait(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Lite M15 toolbar action is not a button: " + action);
        }
        button.click();
        await wait(160);
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native value setter for " + element.tagName);
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const readLayerStyle = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Lite preview iframe was not readable.");
        }
        return iframe.contentDocument.querySelector(".layer-text")?.getAttribute("style") ?? "";
      };

      window.confirm = () => true;
      await wait(900);
      await clickAction("reset-workspace");
      const editToggle = await waitFor('[data-smoke-action="toggle-edit-mode"]');
      if (editToggle instanceof HTMLButtonElement && !editToggle.classList.contains("active")) {
        editToggle.click();
        await wait(160);
      }
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await clickAction("add-text-layer");
      await waitFor('[data-smoke-role="layer-box"]');
      const toolbar = await waitFor('[data-smoke-role="floating-editor-toolbar"] [data-toolbar-target="text-layer"]');
      if (!(toolbar instanceof HTMLElement)) {
        throw new Error("Lite M15 toolbar target was not an HTMLElement.");
      }
      const colorInput = toolbar.querySelector('input[type="color"]');
      const sizeInput = toolbar.querySelector('input[type="number"]');
      if (!(colorInput instanceof HTMLInputElement) || !(sizeInput instanceof HTMLInputElement)) {
        throw new Error("Lite M15 toolbar inputs were not available.");
      }
      setNativeValue(colorInput, "#336699");
      setNativeValue(sizeInput, 72);
      await waitUntil(
        () => readLayerStyle().includes("#336699") && readLayerStyle().includes("font-size: 72px"),
        () => "Lite M15 toolbar did not update preview layer: " + readLayerStyle()
      );

      return {
        layerStyle: readLayerStyle(),
        toolbarText: toolbar.textContent ?? "",
        toolbarVisible: true
      };
    })()
  `);

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Lite M15 toolbar smoke did not return a result." };
  }

  const record = result as Record<string, unknown>;
  const layerStyle = typeof record["layerStyle"] === "string" ? record["layerStyle"] : "";
  if (record["toolbarVisible"] !== true || !layerStyle.includes("#336699") || !layerStyle.includes("font-size: 72px")) {
    return { ok: false, message: `Lite M15 toolbar smoke failed: ${JSON.stringify(record)}` };
  }

  return { ok: true };
}

async function runTemplatePackImportSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const zipPath = await createTemplatePackSmokeZip(app.getPath("userData"));
  const imported = await importTemplatePackArchive(storageRoot(), zipPath);
  if (isCardnewsError(imported)) {
    return { ok: false, message: imported.message };
  }
  if (imported.cardCount !== 1 || imported.backgroundCount !== 1) {
    return { ok: false, message: `Template-pack smoke imported unexpected counts: ${JSON.stringify(imported)}` };
  }

  const workspace = await loadWorkspaceState(storageRoot());
  if (
    !workspace ||
    workspace.headerLabel !== "M13 SMOKE" ||
    workspace.footerAccount !== "kkongdon_story" ||
    workspace.cards.length !== 1 ||
    !workspace.cards[0]?.includes("템플릿팩 스모크")
  ) {
    return { ok: false, message: "Template-pack smoke import did not save the expected workspace." };
  }

  const deck = buildDeckFromDraft(
    `template-pack-smoke-${Date.now()}`,
    deckDraftFromWorkspace(workspace),
    undefined
  );
  if (isCardnewsError(deck)) {
    return { ok: false, message: deck.message };
  }
  const renderJobId = `template-pack-smoke-${Date.now()}`;
  const rendered = await renderDeckToOutput(
    deck,
    renderJobId,
    getRenderOutputDirectory(storageRoot(), renderJobId),
    await listCustomStyles(storageRoot())
  );
  if (isCardnewsError(rendered)) {
    return { ok: false, message: rendered.message };
  }
  const firstCard = rendered.cards[0];
  if (
    rendered.cardCount !== 1 ||
    !firstCard ||
    firstCard.bytes < 100 ||
    !firstCard.previewDataUrl.startsWith("data:image/png;base64,")
  ) {
    return { ok: false, message: `Template-pack smoke render failed: ${JSON.stringify(rendered)}` };
  }

  await reloadSmokeWindow(mainWindow);
  await delay(800);

  return { ok: true };
}

function deckDraftFromWorkspace(workspace: WorkspaceState): DeckDraft {
  return {
    headerLabel: workspace.headerLabel,
    footerAccount: workspace.footerAccount,
    cards: workspace.cards.map((rawText, cardIndex) => ({ index: cardIndex + 1, rawText })),
    styleId: workspace.styleId,
    ...(workspace.accentColor ? { accentColor: workspace.accentColor } : {}),
    ...(typeof workspace.backgroundDim === "number" ? { backgroundDim: workspace.backgroundDim } : {}),
    ...(workspace.aspectRatio ? { aspectRatio: workspace.aspectRatio } : {}),
    ...(workspace.backgroundId ? { backgroundId: workspace.backgroundId } : {}),
    ...(workspace.fontId ? { fontId: workspace.fontId } : {}),
    ...(workspace.chrome ? { chrome: workspace.chrome } : {}),
    ...(workspace.nextHint ? { nextHint: workspace.nextHint } : {}),
    ...(workspace.overrides ? { overrides: workspace.overrides } : {})
  };
}

async function createTemplatePackSmokeZip(root: string): Promise<string> {
  const smokeRoot = path.join(root, "m13-template-pack-smoke");
  await fs.mkdir(smokeRoot, { recursive: true });
  const zipPath = path.join(smokeRoot, "m13-template-pack-smoke.zip");
  const zip = new AdmZip();
  zip.addFile("template.json", Buffer.from(JSON.stringify({
    schema: "kkongdon.cardnews.template-pack.v1",
    name: "M13 Smoke Template Pack",
    style: {
      name: "M13 Smoke Style",
      usesPhoto: true,
      pageBackground: "#111111",
      ink: "#ffffff",
      inkSub: "#f5f5f5",
      accentDefault: "#ffd23c",
      badgeBackground: "#ffd23c",
      badgeInk: "#111111",
      defaultDim: 0.2
    },
    chrome: {
      header: "M13 SMOKE",
      footer: "kkongdon_story",
      pageFormat: "{n} / {total}"
    },
    cards: [
      {
        type: "cover",
        backgroundImage: "backgrounds/card-01-clean.png",
        badge: "M13 SMOKE",
        title: "템플릿팩 스모크",
        subtitle: "불러오기 검증",
        layers: [
          { kind: "shape", x: 8, y: 8, width: 18, height: 7, fill: "#ffd23c", radius: 2 },
          { kind: "line", x1: 70, y1: 84, x2: 94, y2: 84, thickness: 3, color: "#ffffff" }
        ]
      }
    ]
  }, null, 2), "utf8"));
  zip.addFile("backgrounds/card-01-clean.png", createSmokePng());
  await fs.writeFile(zipPath, zip.toBuffer());
  return zipPath;
}

function createSmokePng(): Buffer {
  const size = 24;
  const bitmap = Buffer.alloc(size * size * 4);
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const offset = pixel * 4;
    bitmap[offset] = 0x11;
    bitmap[offset + 1] = 0x1d;
    bitmap[offset + 2] = 0x2f;
    bitmap[offset + 3] = 0xff;
  }
  const image = nativeImage.createFromBitmap(bitmap, { width: size, height: size });
  if (image.isEmpty()) {
    throw new Error("Template-pack smoke image could not be created.");
  }
  return image.toPNG();
}

async function runEditionLiteRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (selector) => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const node = document.querySelector(selector);
          if (node) {
            return node;
          }
          await wait(50);
        }
        throw new Error("Missing selector: " + selector);
      };

      const editionResult = await window.cardnews.getEdition();
      const lockedResult = await window.cardnews.requestLockedFeature("bulk_csv");
      const root = await waitFor('[data-smoke-edition="lite"]');
      const contentTab = await waitFor('[data-smoke-action="inspector-content"]');
      contentTab.click();
      await wait(80);
      const designTab = await waitFor('[data-smoke-action="card-design-tab"]');
      designTab.click();
      await wait(80);
      const editToggle = await waitFor('[data-smoke-action="toggle-edit-mode"]');
      if (editToggle instanceof HTMLButtonElement && !editToggle.classList.contains("active")) {
        editToggle.click();
        await wait(120);
      }
      const addTextLayer = await waitFor('[data-smoke-action="add-text-layer"]');
      if (!(addTextLayer instanceof HTMLButtonElement)) {
        throw new Error("Lite text layer add button was not available.");
      }
      addTextLayer.click();
      await wait(160);
      const floatingToolbar = await waitFor('[data-smoke-role="floating-editor-toolbar"] [data-toolbar-target="text-layer"]');
      const typographyColorControl = await waitFor('[data-smoke-role="typography-color-control"]');
      const hasFloatingTextToolbar = floatingToolbar instanceof HTMLElement;
      const hasTypographyColorControl = typographyColorControl instanceof HTMLElement;
      const exportTab = await waitFor('[data-smoke-action="inspector-export"]');
      exportTab.click();
      await wait(80);
      const aiButton = await waitFor('[data-smoke-action="open-ai-panel"]');
      if (aiButton instanceof HTMLButtonElement) {
        aiButton.click();
        await wait(120);
      }

      const requiredLocks = [
        "project_file",
        "bulk_csv",
        "ai_panel"
      ];
      const requiredDesignControls = [
        "badge-controls",
        "next-hint-controls",
        "typography-controls",
        "layer-controls",
        "chrome-page-template"
      ];
      const renderedLocks = Array.from(document.querySelectorAll('[data-smoke-role="edition-lock"]'))
        .map((node) => node.getAttribute("data-smoke-feature"))
        .filter(Boolean);
      const missingLocks = requiredLocks.filter((featureCode) => !renderedLocks.includes(featureCode));
      const designLocks = ["card_design", "chrome_style", "overlay_edit", "badge_image", "next_hint_image"];
      const remainingDesignLocks = designLocks.filter((featureCode) => renderedLocks.includes(featureCode));
      const missingDesignControls = requiredDesignControls.filter((role) => !document.querySelector('[data-smoke-role="' + role + '"]'));
      const lockButton = document.querySelector('[data-smoke-action="locked-bulk_csv"]');
      if (lockButton instanceof HTMLButtonElement) {
        lockButton.click();
        await wait(80);
      }

      const proKeys = [
        "import" + "Bulk" + "Csv" + "File",
        "export" + "Bulk" + "Csv" + "Template",
        "render" + "Bulk" + "Csv",
        "remove" + "Image" + "Background",
        "export" + "Project",
        "import" + "Project",
        "list" + "Ai" + "Providers",
        "run" + "Ai" + "Chat"
      ];
      return {
        editionResult,
        rootEdition: root.getAttribute("data-smoke-edition"),
        lockedResult,
        hasRail: Boolean(document.querySelector(".slide-rail .slide-thumb")),
        hasStagePreview: Boolean(document.querySelector(".stage iframe[sandbox='allow-same-origin']")),
        hasInspectorTabs: ["design", "content", "export"].every((tab) =>
          Boolean(document.querySelector('[data-smoke-action="inspector-' + tab + '"]'))
        ),
        hasLock: renderedLocks.length > 0,
        renderedLocks,
        missingLocks,
        remainingDesignLocks,
        missingDesignControls,
        hasFloatingTextToolbar,
        hasTypographyColorControl,
        statusText: document.querySelector(".stage-status")?.textContent ?? "",
        hasProApi: proKeys.some((key) => key in window.cardnews)
      };
    })()
  `);
  const evidence = typeof result === "object" && result !== null ? result : {};
  const editionResult = "editionResult" in evidence ? evidence.editionResult : undefined;
  const lockedResult = "lockedResult" in evidence ? evidence.lockedResult : undefined;
  const rootEdition = "rootEdition" in evidence ? evidence.rootEdition : undefined;
  const hasLock = "hasLock" in evidence && evidence.hasLock === true;
  const hasRail = "hasRail" in evidence && evidence.hasRail === true;
  const hasStagePreview = "hasStagePreview" in evidence && evidence.hasStagePreview === true;
  const hasInspectorTabs = "hasInspectorTabs" in evidence && evidence.hasInspectorTabs === true;
  const missingLocks = Array.isArray(evidence.missingLocks) ? evidence.missingLocks : ["missing lock evidence"];
  const remainingDesignLocks = Array.isArray(evidence.remainingDesignLocks)
    ? evidence.remainingDesignLocks
    : ["missing design lock evidence"];
  const missingDesignControls = Array.isArray(evidence.missingDesignControls)
    ? evidence.missingDesignControls
    : ["missing design control evidence"];
  const hasFloatingTextToolbar = "hasFloatingTextToolbar" in evidence && evidence.hasFloatingTextToolbar === true;
  const hasTypographyColorControl =
    "hasTypographyColorControl" in evidence && evidence.hasTypographyColorControl === true;
  const hasProApi = "hasProApi" in evidence && evidence.hasProApi === true;

  if (
    typeof editionResult !== "object" ||
    editionResult === null ||
    !("edition" in editionResult) ||
    editionResult.edition !== "lite"
  ) {
    return { ok: false, message: "Lite edition info was not exposed." };
  }

  if (rootEdition !== "lite") {
    return { ok: false, message: "Shared Lite App root did not expose data-smoke-edition=lite." };
  }

  if (
    typeof lockedResult !== "object" ||
    lockedResult === null ||
    !("ok" in lockedResult) ||
    lockedResult.ok !== false ||
    !("code" in lockedResult) ||
    lockedResult.code !== "not_implemented"
  ) {
    return { ok: false, message: "Locked feature did not return an unsupported result." };
  }

  if (!hasRail) {
    return { ok: false, message: "Lite shared shell did not render the slide rail thumbnails." };
  }

  if (!hasStagePreview) {
    return { ok: false, message: "Lite shared shell did not render the stage preview iframe." };
  }

  if (!hasInspectorTabs) {
    return { ok: false, message: "Lite shared shell did not render the inspector tab structure." };
  }

  if (!hasLock) {
    return { ok: false, message: "Lite lock panel was not rendered." };
  }

  if (missingLocks.length > 0) {
    return { ok: false, message: `Lite lock stubs missing: ${missingLocks.join(", ")}` };
  }

  if (remainingDesignLocks.length > 0) {
    return { ok: false, message: `Lite design controls are still locked: ${remainingDesignLocks.join(", ")}` };
  }

  if (missingDesignControls.length > 0) {
    return { ok: false, message: `Lite design controls missing: ${missingDesignControls.join(", ")}` };
  }

  if (!hasFloatingTextToolbar || !hasTypographyColorControl) {
    return {
      ok: false,
      message: `Lite shared M15 controls missing: ${JSON.stringify({ hasFloatingTextToolbar, hasTypographyColorControl })}`
    };
  }

  if (hasProApi) {
    return { ok: false, message: "Lite bridge exposed a locked API." };
  }

  return { ok: true };
}

async function runEditionLiteBasicFlowSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitUntil = async (predicate, message) => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (predicate()) {
            return;
          }
          await wait(100);
        }
        throw new Error(message());
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor?.set?.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const styleSelect = document.querySelector(".topbar-style-select");
      if (!(styleSelect instanceof HTMLSelectElement)) {
        throw new Error("Style select missing.");
      }
      styleSelect.value = styleSelect.options[1]?.value ?? styleSelect.value;
      styleSelect.dispatchEvent(new Event("change", { bubbles: true }));

      const contentTab = document.querySelector('[data-smoke-action="inspector-content"]');
      if (!(contentTab instanceof HTMLButtonElement)) {
        throw new Error("Content tab missing.");
      }
      contentTab.click();
      await waitUntil(
        () => document.querySelector('[data-smoke-action="card-design-tab"]') instanceof HTMLButtonElement,
        () => "Card design tab missing."
      );
      const cardDesignTab = document.querySelector('[data-smoke-action="card-design-tab"]');
      if (!(cardDesignTab instanceof HTMLButtonElement)) {
        throw new Error("Card design tab missing after wait.");
      }
      cardDesignTab.click();
      await waitUntil(
        () => document.querySelector('[data-smoke-role="chrome-header-color"]') instanceof HTMLInputElement,
        () => "Chrome color controls missing."
      );
      const previousChromeColors = [];
      for (const role of ["chrome-header-color", "chrome-page-color", "chrome-footer-color"]) {
        const colorInput = document.querySelector('[data-smoke-role="' + role + '"]');
        if (!(colorInput instanceof HTMLInputElement)) {
          throw new Error("Chrome color input missing: " + role);
        }
        previousChromeColors.push([role, colorInput.value]);
        setNativeValue(colorInput, "#ffffff");
      }

      const cardContentTab = document.querySelector('[data-smoke-action="card-content-tab"]');
      if (!(cardContentTab instanceof HTMLButtonElement)) {
        throw new Error("Card content tab missing.");
      }
      cardContentTab.click();
      await waitUntil(
        () => document.querySelector('[data-smoke-role="content-title"]') instanceof HTMLTextAreaElement,
        () => "Content title field missing."
      );

      const titleInput = document.querySelector('[data-smoke-role="content-title"]');
      if (!(titleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content title field missing after wait.");
      }
      setNativeValue(titleInput, "Lite 기본 플로우 검증");

      const generate = document.querySelector('[data-smoke-action="generate"]');
      if (!(generate instanceof HTMLButtonElement)) {
        throw new Error("Generate button missing.");
      }
      generate.click();
      await waitUntil(
        () => {
          const text = document.querySelector(".stage-status")?.textContent ?? "";
          return text.includes("렌더 완료:") || text.includes("게이트 실패") || text.includes("렌더 실패");
        },
        () => "Lite render did not finish: " + (document.querySelector(".stage-status")?.textContent ?? "")
      );

      for (const [role, value] of previousChromeColors) {
        const colorInput = document.querySelector('[data-smoke-role="' + role + '"]');
        if (colorInput instanceof HTMLInputElement) {
          setNativeValue(colorInput, value);
        }
      }
      await wait(400);

      return {
        styleValue: styleSelect.value,
        titleValue: titleInput.value,
        statusText: document.querySelector(".stage-status")?.textContent ?? ""
      };
    })()
  `);

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Lite basic flow smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const statusText = typeof record["statusText"] === "string" ? record["statusText"] : "";
  if (record["titleValue"] !== "Lite 기본 플로우 검증" || !statusText.includes("렌더 완료:")) {
    return { ok: false, message: `Lite basic flow failed: ${JSON.stringify(record)}` };
  }

  return { ok: true };
}

async function chooseImageFiles(allowsMultipleSelection: boolean): Promise<readonly string[] | undefined> {
  const result = await dialog.showOpenDialog({
    filters: [{ extensions: ["png", "jpg", "jpeg", "webp"], name: "Images" }],
    properties: allowsMultipleSelection ? ["openFile", "multiSelections"] : ["openFile"]
  });

  return result.canceled ? undefined : result.filePaths;
}

async function chooseFontFile(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    filters: [{ extensions: ["ttf", "otf", "woff2"], name: "Fonts" }],
    properties: ["openFile"]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseTemplatePackFile(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    filters: [{ extensions: ["zip"], name: "Kkongdon Template Pack" }],
    properties: ["openFile"]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

function validateImageDecode(filePath: string): CardnewsResult<void> {
  const image = nativeImage.createFromPath(filePath);
  return image.isEmpty() ? invalidInput("이미지를 디코딩할 수 없습니다.") : undefined;
}

function isAppSettings(input: unknown): input is AppSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    (record["pixabayApiKey"] === undefined || typeof record["pixabayApiKey"] === "string") &&
    (record["aiDefaultProviderId"] === undefined || isAiProviderIdSetting(record["aiDefaultProviderId"])) &&
    (record["gptsTemplateBuilderUrl"] === undefined ||
      (typeof record["gptsTemplateBuilderUrl"] === "string" &&
        isAllowedGptsTemplateBuilderUrl(record["gptsTemplateBuilderUrl"])))
  );
}

function isAiProviderIdSetting(input: unknown): boolean {
  return input === "claude" || input === "codex" || input === "gemini";
}

function isStylePresetRecord(input: unknown): input is StylePresetRecord {
  return isSafeStylePresetRecord(input);
}

async function renderDeckToOutput(
  deck: Deck,
  jobId: string,
  outputDir: string,
  customStyles: readonly StylePresetRecord[]
): Promise<CardnewsResult<RenderJobResult>> {
  const renderAssets = await resolveDeckRenderAssets(deck);
  const fontCss = await buildRenderFontCss(deck.fontId);
  if (isCardnewsError(fontCss)) {
    return fontCss;
  }

  return renderDeckOffscreen({
    ...renderAssets,
    appVersion: app.getVersion(),
    customStyles,
    deck: stripProDeck(deck),
    edition: "lite",
    jobId,
    outputDir,
    ...(fontCss ? { fontCss } : {})
  });
}

async function resolveDeckRenderAssets(deck: Deck): Promise<{
  readonly assetImagePathById: Readonly<Record<string, string>>;
  readonly backgroundImagePath: string | undefined;
  readonly backgroundImagePathByCardIndex: Readonly<Record<string, string | null>>;
}> {
  const libraryBackground = deck.backgroundId
    ? await findLibraryBackground(storageRoot(), deck.backgroundId)
    : undefined;
  const backgroundImagePath = libraryBackground?.absolutePath;
  const backgroundImagePathByCardIndex: Record<string, string | null> = {};
  const assetImagePathById: Record<string, string> = {};

  if (deck.backgroundId && backgroundImagePath) {
    assetImagePathById[deck.backgroundId] = backgroundImagePath;
  }

  if (deck.nextHint?.kind === "image" && deck.nextHint.imageId) {
    const nextHintImage = await findLibraryImage(storageRoot(), deck.nextHint.imageId);
    if (nextHintImage) {
      assetImagePathById[deck.nextHint.imageId] = nextHintImage.absolutePath;
    }
  }

  for (const [cardIndex, override] of Object.entries(deck.overrides ?? {})) {
    if (override.backgroundId === null) {
      backgroundImagePathByCardIndex[cardIndex] = null;
    } else if (override.backgroundId) {
      const overrideBackground = await findLibraryBackground(storageRoot(), override.backgroundId);
      backgroundImagePathByCardIndex[cardIndex] = overrideBackground?.absolutePath ?? null;
      if (overrideBackground) {
        assetImagePathById[override.backgroundId] = overrideBackground.absolutePath;
      }
    }

    if (override.badge?.imageId && !assetImagePathById[override.badge.imageId]) {
      const badgeImage = await findLibraryImage(storageRoot(), override.badge.imageId);
      if (badgeImage) {
        assetImagePathById[override.badge.imageId] = badgeImage.absolutePath;
      }
    }

    for (const layer of override.layers ?? []) {
      if (layer.kind !== "image" || assetImagePathById[layer.backgroundId]) {
        continue;
      }

      const layerBackground = await findLibraryBackground(storageRoot(), layer.backgroundId);
      if (layerBackground) {
        assetImagePathById[layer.backgroundId] = layerBackground.absolutePath;
        continue;
      }

      const layerImage = await findLibraryImage(storageRoot(), layer.backgroundId);
      if (layerImage) {
        assetImagePathById[layer.backgroundId] = layerImage.absolutePath;
      }
    }
  }

  return { assetImagePathById, backgroundImagePath, backgroundImagePathByCardIndex };
}

async function buildRenderFontCss(fontId?: string): Promise<CardnewsResult<string | undefined>> {
  const fontData = await loadFontData(fontId);
  if (fontId && !fontData) {
    return invalidInput("선택한 폰트를 라이브러리에서 찾지 못했습니다.");
  }

  return fontData
    ? buildFontFaceCss(`data:${fontData.mimeType};base64,${fontData.base64}`, {
        family: fontData.cssFamily,
        format: fontData.cssFormat
      })
    : undefined;
}

let cachedBundledFont: FontData | null | undefined;

async function loadFontData(fontId?: string | null): Promise<FontData | undefined> {
  if (fontId) {
    const font = await findLibraryFont(storageRoot(), fontId);
    if (!font) {
      return undefined;
    }

    const filePath = path.join(storageRoot(), "library", "fonts", `${font.entry.id}.${font.entry.extension}`);
    try {
      const base64 = (await fs.readFile(filePath)).toString("base64");
      return {
        base64,
        cssFamily: "Cardnews User Font",
        cssFormat: fontCssFormatForExtension(font.entry.extension),
        displayName: font.entry.displayName,
        mimeType: fontMimeTypeForExtension(font.entry.extension) ?? "font/woff2"
      };
    } catch {
      return undefined;
    }
  }

  if (cachedBundledFont !== undefined) {
    return cachedBundledFont ?? undefined;
  }

  const fontPath = path.join(process.cwd(), "fonts", "PretendardVariable.woff2");
  try {
    const base64 = (await fs.readFile(fontPath)).toString("base64");
    cachedBundledFont = {
      base64,
      cssFamily: "Cardnews User Font",
      cssFormat: "woff2-variations",
      displayName: "Pretendard Variable",
      mimeType: "font/woff2"
    };
    return cachedBundledFont;
  } catch {
    cachedBundledFont = null;
    return undefined;
  }
}

async function writeDeckZip(outputDir: string, targetPath: string): Promise<void> {
  const zip = new AdmZip();
  for (const entry of await fs.readdir(outputDir)) {
    if (entry.endsWith(".png")) {
      zip.addLocalFile(path.join(outputDir, entry));
    }
  }

  zip.writeZip(targetPath);
}

async function searchPixabayImages(
  query: string,
  page: number
): Promise<CardnewsResult<StockImageSearchResult>> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return invalidInput("검색어를 입력하세요.");
  }

  const settings = await loadAppSettings(storageRoot());
  const apiKey = settings.pixabayApiKey?.trim();
  const fallbackUrl = createPixabayFallbackUrl(trimmedQuery);
  if (!apiKey) {
    await shell.openExternal(fallbackUrl);
    return {
      mode: "browser-fallback",
      provider: "pixabay",
      query: trimmedQuery,
      images: [],
      fallbackUrl
    };
  }

  try {
    const response = await fetch(createPixabayApiUrl(apiKey, trimmedQuery, page));
    if (!response.ok) {
      return externalServiceFailed(`Pixabay 응답 오류: HTTP ${response.status}`);
    }

    const parsed: unknown = await response.json();
    return { mode: "api", provider: "pixabay", query: trimmedQuery, images: parsePixabayImages(parsed) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
    return externalServiceFailed(`Pixabay 검색 실패: ${message}`);
  }
}

async function downloadStockImageToLibrary(
  input: StockImageDownloadInput
): Promise<CardnewsResult<BackgroundLibraryItem>> {
  let filePath: string | undefined;
  try {
    const response = await fetchAllowedPixabayImage(input.imageUrl);
    if (!response.ok) {
      return externalServiceFailed(`이미지 다운로드 실패: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const extension = extensionForContentType(contentType) ?? extensionForPath(new URL(input.imageUrl).pathname);
    if (!extension) {
      return invalidInput("지원하지 않는 이미지 형식입니다.");
    }

    const bytes = await readResponseBytesWithLimit(response);
    const downloadDir = path.join(storageRoot(), "stock-downloads");
    await fs.mkdir(downloadDir, { recursive: true });
    filePath = createStockDownloadPath(downloadDir, extension);
    await fs.writeFile(filePath, bytes);

    const decodeResult = validateImageDecode(filePath);
    if (isCardnewsError(decodeResult)) {
      return decodeResult;
    }

    return addBackgroundToLibrary(storageRoot(), filePath, `Pixabay / ${input.author} / ${input.pageUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
    return externalServiceFailed(`이미지 다운로드 실패: ${message}`);
  } finally {
    if (filePath) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
    }
  }
}

function extensionForContentType(contentType: string): string | undefined {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/png")) {
    return "png";
  }
  if (normalized.includes("image/jpeg")) {
    return "jpg";
  }
  if (normalized.includes("image/webp")) {
    return "webp";
  }
  return undefined;
}

function extensionForPath(pathname: string): string | undefined {
  const extension = path.extname(pathname).slice(1).toLowerCase();
  return ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : undefined;
}

app.whenReady().then(() => {
  installMediaProtocolHandler(storageRoot);
  ipcMain.handle("cardnews:getEdition", () => ({ edition: "lite", productName: "Cardnews Studio Lite" }));
  ipcMain.handle("cardnews:requestLockedFeature", () =>
    notImplemented("이 기능은 Cardnews Studio Pro에서 사용할 수 있습니다.")
  );
  ipcMain.handle("cardnews:chooseStyleReferenceImages", async () => {
    const filePaths = await chooseImageFiles(true);
    if (!filePaths || filePaths.length === 0) {
      return invalidInput("스타일 참고 이미지 선택이 취소되었습니다.");
    }

    const copiedImages: StoredLocalImage[] = [];
    for (const filePath of filePaths.slice(0, 6)) {
      const decodeResult = validateImageDecode(filePath);
      if (isCardnewsError(decodeResult)) {
        return decodeResult;
      }

      const copied = await copyImageToDeckAssets(storageRoot(), filePath, "style-reference", copiedImages.length + 1);
      if (isCardnewsError(copied)) {
        return copied;
      }

      copiedImages.push(copied);
    }

    selectedStyleReferenceImages = copiedImages;
    return copiedImages.map((image) => image.ref);
  });
  ipcMain.handle("cardnews:loadDeck", async () => {
    const loaded = await loadDeck(storageRoot(), currentDeckId);
    return isCardnewsError(loaded) ? loaded : stripProDeck(loaded);
  });
  ipcMain.handle("cardnews:saveDeck", (_event, input: unknown) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return invalidInput("Deck 입력 형식이 올바르지 않습니다.");
    }

    return saveDeckDraft(storageRoot(), stripProDeckDraft(input as DeckDraft), approvedStyleProfile);
  });
  ipcMain.handle("cardnews:parseCard", (_event, rawText: unknown, index: unknown) => {
    if (typeof rawText !== "string") {
      return invalidInput("카드 원문은 문자열이어야 합니다.");
    }
    if (typeof index !== "number") {
      return invalidInput("카드 번호는 숫자여야 합니다.");
    }
    return parseCardText(rawText, index);
  });
  ipcMain.handle("cardnews:extractStyle", () =>
    !app.isPackaged && process.env["CARDNEWS_MOCK_STYLE_EXTRACTION"] === "1"
      ? {
          palette: ["#1d1d1b", "#f8f1e3", "#123c3a", "#a53d2d"],
          layoutMood: "newsprint editorial",
          fontMood: "bold Korean sans-serif"
        }
      : styleExtractionFailed("스타일 분석을 완료하지 못했습니다. 기본 스타일로 계속 만들 수 있습니다.")
  );
  ipcMain.handle("cardnews:approveStyle", (_event, profile: unknown) => {
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
      return invalidInput("스타일 프로필 형식이 올바르지 않습니다.");
    }

    approvedStyleProfile = { ...(profile as StyleProfile), approved: true };
    return approvedStyleProfile;
  });
  ipcMain.handle("cardnews:renderDeck", async (_event, deckId: unknown) => {
    if (typeof deckId !== "string") {
      return invalidInput("deck id는 문자열이어야 합니다.");
    }

    const deck = await loadDeck(storageRoot(), deckId);
    if (isCardnewsError(deck)) {
      return deck;
    }

    const jobId = `render-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
    const customStyles = await listCustomStyles(storageRoot());
    return renderDeckToOutput(stripProDeck(deck), jobId, getRenderOutputDirectory(storageRoot(), jobId), customStyles);
  });
  ipcMain.handle("cardnews:importDeckDocument", async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ extensions: ["md", "txt"], name: "카드뉴스 양식" }],
      properties: ["openFile"]
    });
    const filePath = result.canceled ? undefined : result.filePaths[0];
    if (!filePath) {
      return invalidInput("양식 파일 선택이 취소되었습니다.");
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 1024 * 1024) {
        return invalidInput("양식 파일은 1MB 이하만 불러올 수 있습니다.");
      }

      const text = await fs.readFile(filePath, "utf8");
      return { fileName: path.basename(filePath), text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`양식 파일을 읽지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:importCustomStyleFile", async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ extensions: ["json"], name: "스타일 JSON" }],
      properties: ["openFile"]
    });
    const filePath = result.canceled ? undefined : result.filePaths[0];
    if (!filePath) {
      return invalidInput("스타일 JSON 파일 선택이 취소되었습니다.");
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 256 * 1024) {
        return invalidInput("스타일 JSON 파일은 256KB 이하만 불러올 수 있습니다.");
      }

      const text = await fs.readFile(filePath, "utf8");
      return { fileName: path.basename(filePath), text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`스타일 JSON 파일을 읽지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:exportTemplateFile", async (_event, content: unknown) => {
    if (typeof content !== "string" || content.length === 0) {
      return invalidInput("양식 내용이 비어 있습니다.");
    }

    const result = await dialog.showSaveDialog({
      defaultPath: "카드뉴스-양식.md",
      filters: [{ extensions: ["md"], name: "Markdown" }]
    });
    if (result.canceled || !result.filePath) {
      return invalidInput("양식 저장이 취소되었습니다.");
    }

    await fs.writeFile(result.filePath, content, "utf8");
    return result.filePath;
  });
  ipcMain.handle("cardnews:listBackgroundLibrary", () => listBackgroundLibrary(storageRoot()));
  ipcMain.handle("cardnews:listFontLibrary", () => listFontLibrary(storageRoot()));
  ipcMain.handle("cardnews:importFontToLibrary", async () => {
    const filePath = await chooseFontFile();
    if (!filePath) {
      return invalidInput("폰트 파일 선택이 취소되었습니다.");
    }

    return importFontToLibrary(storageRoot(), filePath);
  });
  ipcMain.handle("cardnews:addBackgroundToLibrary", async () => {
    const filePaths = await chooseImageFiles(false);
    const filePath = filePaths?.[0];
    if (!filePath) {
      return invalidInput("배경 이미지 선택이 취소되었습니다.");
    }

    const decodeResult = validateImageDecode(filePath);
    if (isCardnewsError(decodeResult)) {
      return decodeResult;
    }

    return addBackgroundToLibrary(storageRoot(), filePath);
  });
  ipcMain.handle("cardnews:removeBackgroundFromLibrary", (_event, backgroundId: unknown) => {
    if (typeof backgroundId !== "string" || backgroundId.length === 0) {
      return invalidInput("배경 이미지 id가 올바르지 않습니다.");
    }

    return removeBackgroundFromLibrary(storageRoot(), backgroundId);
  });
  ipcMain.handle("cardnews:listImageLibrary", () =>
    listImageLibrary(storageRoot(), { includeSmokeFixtures: Boolean(smokeAction) })
  );
  ipcMain.handle("cardnews:addImageToLibrary", async () => {
    const filePaths = await chooseImageFiles(false);
    const filePath = filePaths?.[0];
    if (!filePath) {
      return invalidInput("이미지 선택이 취소되었습니다.");
    }

    const decodeResult = validateImageDecode(filePath);
    if (isCardnewsError(decodeResult)) {
      return decodeResult;
    }

    return addImageToLibrary(storageRoot(), filePath);
  });
  ipcMain.handle("cardnews:removeImageFromLibrary", (_event, imageId: unknown) => {
    if (typeof imageId !== "string" || imageId.length === 0) {
      return invalidInput("이미지 id가 올바르지 않습니다.");
    }

    return removeImageFromLibrary(storageRoot(), imageId);
  });
  ipcMain.handle("cardnews:media:import", (_event, kind: unknown) => importManagedMedia(kind));
  ipcMain.handle("cardnews:media:list", () => listMediaAssets(storageRoot()));
  ipcMain.handle("cardnews:media:preview", (_event, mediaId: unknown) => getManagedMediaPreview(mediaId));
  ipcMain.handle("cardnews:media:usage", (_event, mediaId: unknown) => listManagedMediaUsage(mediaId));
  ipcMain.handle("cardnews:media:delete", (_event, mediaId: unknown) => deleteManagedMedia(mediaId));
  ipcMain.handle("cardnews:video:export", (_event, input: unknown) => exportManagedVideo(input));
  ipcMain.handle("cardnews:video:cancel", (_event, jobId: unknown) => cancelManagedVideoExport(jobId));
  ipcMain.handle("cardnews:searchStockImages", (_event, query: unknown, page: unknown) => {
    if (typeof query !== "string") {
      return invalidInput("검색어는 문자열이어야 합니다.");
    }
    if (typeof page !== "number") {
      return invalidInput("페이지 번호는 숫자여야 합니다.");
    }
    return searchPixabayImages(query, page);
  });
  ipcMain.handle("cardnews:downloadStockImage", (_event, input: unknown) => {
    if (!isSafeStockImageDownloadInput(input)) {
      return invalidInput("이미지 다운로드 입력 형식이 올바르지 않습니다.");
    }

    return downloadStockImageToLibrary(input);
  });
  ipcMain.handle("cardnews:importTemplatePack", async () => {
    const filePath = await chooseTemplatePackFile();
    if (!filePath) {
      return invalidInput("템플릿팩 가져오기가 취소되었습니다.");
    }

    return importTemplatePackArchive(storageRoot(), filePath);
  });
  ipcMain.handle("cardnews:loadSettings", () => loadAppSettings(storageRoot()));
  ipcMain.handle("cardnews:saveSettings", async (_event, settings: unknown) => {
    if (!isAppSettings(settings)) {
      return invalidInput("설정 형식이 올바르지 않습니다.");
    }

    await saveAppSettings(storageRoot(), settings);
    return undefined;
  });
  ipcMain.handle("cardnews:listCustomStyles", () => listCustomStyles(storageRoot()));
  ipcMain.handle("cardnews:saveCustomStyle", (_event, style: unknown) => {
    if (!isStylePresetRecord(style)) {
      return invalidInput("커스텀 스타일 형식이 올바르지 않습니다.");
    }

    return saveCustomStyle(storageRoot(), style);
  });
  ipcMain.handle("cardnews:deleteCustomStyle", (_event, styleId: unknown) => {
    if (typeof styleId !== "string" || !styleId.startsWith("custom-")) {
      return invalidInput("삭제할 커스텀 스타일 id가 올바르지 않습니다.");
    }

    return deleteCustomStyle(storageRoot(), styleId);
  });
  ipcMain.handle("cardnews:listDeckPresets", async () => {
    const presets = await listDeckPresets(storageRoot());
    return presets.map(stripProDeckPreset);
  });
  ipcMain.handle("cardnews:saveDeckPreset", (_event, preset: unknown) => {
    if (!isDeckPreset(preset)) {
      return invalidInput("양식 프리셋 형식이 올바르지 않습니다.");
    }

    return saveDeckPresetToStore(storageRoot(), stripProDeckPreset(preset));
  });
  ipcMain.handle("cardnews:deleteDeckPreset", (_event, name: unknown) => {
    if (typeof name !== "string" || name.trim().length === 0) {
      return invalidInput("삭제할 양식 이름이 올바르지 않습니다.");
    }

    return deleteDeckPresetFromStore(storageRoot(), name);
  });
  ipcMain.handle("cardnews:saveWorkspace", async (_event, state: unknown) => {
    if (!isWorkspaceState(state)) {
      return invalidInput("작업 상태 형식이 올바르지 않습니다.");
    }

    await saveWorkspaceState(storageRoot(), stripProWorkspaceState(state));
    return undefined;
  });
  ipcMain.handle("cardnews:loadWorkspace", async () => {
    const workspace = await loadWorkspaceState(storageRoot());
    return workspace ? stripProWorkspaceState(workspace) : null;
  });
  ipcMain.handle("cardnews:exportCardPng", async (_event, jobId: unknown, fileName: unknown) => {
    if (!isRenderJobId(jobId)) {
      return invalidInput("렌더 작업 id가 올바르지 않습니다.");
    }
    if (typeof fileName !== "string" || !/^card-\d+\.png$/.test(fileName)) {
      return invalidInput("카드 파일 이름이 올바르지 않습니다.");
    }

    const sourcePath = path.join(getRenderOutputDirectory(storageRoot(), jobId), fileName);
    const result = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [{ extensions: ["png"], name: "PNG" }]
    });
    if (result.canceled || !result.filePath) {
      return invalidInput("PNG 저장이 취소되었습니다.");
    }

    try {
      await fs.copyFile(sourcePath, result.filePath);
      return result.filePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`PNG를 저장하지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:exportDeckZip", async (_event, jobId: unknown) => {
    if (!isRenderJobId(jobId)) {
      return invalidInput("렌더 작업 id가 올바르지 않습니다.");
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const outputDir = getRenderOutputDirectory(storageRoot(), jobId);
    const result = await dialog.showSaveDialog({
      defaultPath: `cardnews-${stamp}.zip`,
      filters: [{ extensions: ["zip"], name: "ZIP" }]
    });
    if (result.canceled || !result.filePath) {
      return invalidInput("ZIP 저장이 취소되었습니다.");
    }

    try {
      await writeDeckZip(outputDir, result.filePath);
      return result.filePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 압축 오류";
      return invalidInput(`ZIP을 만들지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:getFontData", async (_event, fontId: unknown) => {
    if (fontId !== undefined && fontId !== null && typeof fontId !== "string") {
      return invalidInput("폰트 id가 올바르지 않습니다.");
    }

    return (await loadFontData(fontId ?? null)) ?? invalidInput("폰트를 찾지 못했습니다.");
  });
  ipcMain.handle("cardnews:getBackgroundPreview", async (_event, backgroundId: unknown) => {
    if (typeof backgroundId !== "string" || backgroundId.length === 0) {
      return invalidInput("배경 id가 올바르지 않습니다.");
    }

    const found = await findLibraryBackground(storageRoot(), backgroundId);
    const assetPath = found?.absolutePath;
    if (!assetPath) {
      return invalidInput("라이브러리에서 배경 이미지를 찾지 못했습니다.");
    }

    try {
      const image = nativeImage.createFromPath(assetPath);
      if (image.isEmpty()) {
        return invalidInput("배경 이미지를 디코딩할 수 없습니다.");
      }

      const { width } = image.getSize();
      const resized = width > 1080 ? image.resize({ width: 1080 }) : image;
      return `data:image/jpeg;base64,${resized.toJPEG(82).toString("base64")}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`배경 이미지를 읽지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:getImagePreview", async (_event, imageId: unknown) => {
    if (typeof imageId !== "string" || imageId.length === 0) {
      return invalidInput("이미지 id가 올바르지 않습니다.");
    }

    const found = await findLibraryImage(storageRoot(), imageId);
    const assetPath = found?.absolutePath;
    if (!assetPath) {
      return invalidInput("라이브러리에서 이미지를 찾지 못했습니다.");
    }

    try {
      const image = nativeImage.createFromPath(assetPath);
      if (image.isEmpty()) {
        return invalidInput("이미지를 디코딩할 수 없습니다.");
      }

      const { width } = image.getSize();
      const resized = width > 512 ? image.resize({ width: 512 }) : image;
      return `data:image/jpeg;base64,${resized.toJPEG(82).toString("base64")}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`이미지를 읽지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:openOutputFolder", async (_event, jobId: unknown) => {
    if (!isRenderJobId(jobId)) {
      return invalidInput("렌더 작업 id가 올바르지 않습니다.");
    }

    const error = await shell.openPath(getRenderOutputDirectory(storageRoot(), jobId));
    return error.length > 0 ? invalidInput(error) : undefined;
  });
  ipcMain.handle("cardnews:openExternalLink", async (_event, url: unknown) => {
    if (typeof url !== "string" || !isAllowedExternalUrl(url)) {
      return invalidInput("허용되지 않은 외부 링크입니다.");
    }

    await shell.openExternal(url);
    return undefined;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
