// noqa: SIZE_OK - v4 release keeps Electron bootstrap and IPC registration together; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import AdmZip from "adm-zip";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aspectRatios } from "../src/domain/aspectRatios.js";
import { parseCardText } from "../src/domain/cardParser.js";
import { parseBulkCsv } from "../src/domain/csvBulk.js";
import {
  materializeTemplateBulkRow,
  preflightTemplateBulkCsv,
  validateBulkBindingMetadata
} from "../src/domain/templateBulkBindings.js";
import { isAllowedExternalUrl, isAllowedGptsTemplateBuilderUrl } from "../src/domain/externalLinks.js";
import {
  createPixabayApiUrl,
  createPixabayFallbackUrl,
  parsePixabayImages
} from "../src/domain/imageProviders.js";
import type {
  AppSettings,
  AiChatMessage,
  AiProviderId,
  BackgroundLibraryItem,
  BulkBindingMetadata,
  BulkRenderResult,
  BulkRenderRowResult,
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
import { removeBackground } from "../src/render-engine/backgroundRemoval.js";
import { renderDeckOffscreen } from "../src/render-engine/offscreenRenderer.js";
import { isSafeStylePresetRecord } from "../src/render-engine/styleSafety.js";
import { stylePresets } from "../src/render-engine/stylePresets.js";

// Windows 일부 배포/QA 환경에서 Chromium sandboxed GPU helper가 DLL 로드 실패
// (exit_code=-1073741515)로 offscreen paint를 시작하지 못한다. 앱은 로컬 파일만
// 로드하고 nodeIntegration=false/contextIsolation=true를 유지하므로 PNG 렌더 안정성을
// 위해 Chromium process sandbox를 끈다.
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();
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
  listCustomStyles,
  listBackgroundLibrary,
  listDeckPresets,
  listFontLibrary,
  listImageLibrary,
  loadAppSettings,
  loadDeck,
  loadWorkspaceState,
  purgeImageLibrarySmokeFixtures,
  removeImageFromLibrary,
  removeBackgroundFromLibrary,
  saveAppSettings,
  saveCustomStyle,
  saveDeckDraft,
  saveDeckPresetToStore,
  saveImageBufferToLibrary,
  saveWorkspaceState,
  smokeFixtureImageAttribution,
  internalSmokeImageAttribution,
  type StoredLocalImage
} from "../src/storage/deckStore.js";
import {
  exportProjectArchive,
  importProjectArchive
} from "../src/storage/projectArchive.js";
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
import {
  isAiProviderId,
  listAiProviderStatuses,
  runAiProviderChat
} from "./ai/cliAdapters.js";
import type { AiProviderInstallRecipe } from "./ai/cliProviderDefinitions.js";
import { installAiProviderRecipe } from "./ai/cliProviderInstaller.js";
import type { SmokeActionResult } from "./ai/smoke/aiSmokeTypes.js";
import {
  createStockDownloadPath,
  fetchAllowedPixabayImage,
  isSafeStockImageDownloadInput,
  readResponseBytesWithLimit
} from "./stockImageDownload.js";
import { importTemplatePackArchive } from "./templatePackImporter.js";
import {
  createMediaAssetUrl,
  installMediaProtocolHandler,
  registerMediaProtocolScheme
} from "./mediaProtocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
registerMediaProtocolScheme();
const devServerUrl = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
const smokeScreenshotPath = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_SCREENSHOT"];
const smokeTextPath = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_TEXT"];
const smokeAction = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_ACTION"];
if (smokeAction) {
  const smokeUserDataPath = path.join(app.getPath("temp"), "cardnews-studio-smoke", `${process.pid}-${smokeAction}`);
  mkdirSync(smokeUserDataPath, { recursive: true });
  app.setPath("userData", smokeUserDataPath);
}
let selectedStyleReferenceImages: readonly StoredLocalImage[] = [];
let approvedStyleProfile: StyleProfile | undefined;

class SmokeCaptureError extends Error {
  public constructor(public readonly detail: string) {
    super(`Smoke capture failed: ${detail}`);
    this.name = "SmokeCaptureError";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function parseSmokeWindowDimension(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 720 && parsedValue <= 4096
    ? parsedValue
    : fallback;
}

async function captureSmokePng(mainWindow: BrowserWindow): Promise<Buffer> {
  let lastFailure = "unknown failure";

  if (!mainWindow.isVisible()) {
    mainWindow.showInactive();
    await delay(300);
  }

  for (const retryDelay of [500, 1000, 2000, 4000] as const) {
    if (retryDelay > 0) {
      await delay(retryDelay);
    }

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

  throw new SmokeCaptureError(lastFailure);
}

async function runSmokeCapture(mainWindow: BrowserWindow): Promise<void> {
  if (!smokeAction && !smokeScreenshotPath && !smokeTextPath) {
    return;
  }

  await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const bodyText = document.body.innerText;
        if (
          bodyText.includes("CARDNEWS STUDIO") ||
          bodyText.includes("정보형 카드뉴스 제작기") ||
          Date.now() - started > 5000
        ) {
          resolve(undefined);
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);

  const smokeActionResult = await runSmokeAction(mainWindow);

  if (smokeScreenshotPath) {
    await fs.mkdir(path.dirname(smokeScreenshotPath), { recursive: true });
    await fs.writeFile(smokeScreenshotPath, await captureSmokePng(mainWindow));
  }

  if (smokeTextPath) {
    const text = await mainWindow.webContents.executeJavaScript("document.body.innerText");
    await fs.mkdir(path.dirname(smokeTextPath), { recursive: true });
    await fs.writeFile(smokeTextPath, String(text), "utf8");
  }

  if (!smokeActionResult.ok) {
    console.error(smokeActionResult.message);
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
    case undefined:
      return { ok: true };
    case "parse-preview":
      await mainWindow.webContents.executeJavaScript(`
        const button = document.querySelector('[data-smoke-action="generate"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Parser smoke button was not found.");
        }
        button.click();
      `);
      await waitForSmokeText(mainWindow, ["파싱 완료", "렌더링 중", "렌더 완료", "파싱 오류", "파싱 실패"]);
      return await readParseSmokeResult(mainWindow);
    case "render-deck":
      await mainWindow.webContents.executeJavaScript(`
        const button = document.querySelector('[data-smoke-action="generate"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Render smoke button was not found.");
        }
        button.click();
      `);
      await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
      return await readRenderSmokeResult(mainWindow);
    case "render-export":
      await mainWindow.webContents.executeJavaScript(`
        const button = document.querySelector('[data-smoke-action="generate"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Render export smoke button was not found.");
        }
        button.click();
      `);
      await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
      {
        const renderResult = await readRenderSmokeResult(mainWindow);
        if (!renderResult.ok) {
          return renderResult;
        }
      }
      await clickSmokeButton(mainWindow, "export-current-png");
      await waitForSmokeText(mainWindow, ["PNG 저장:", "PNG 내보내기 실패"]);
      await clickSmokeButton(mainWindow, "export-zip");
      await waitForSmokeText(mainWindow, ["ZIP 저장:", "ZIP 내보내기 실패"]);
      return await readExportSmokeResult(mainWindow);
    case "render-with-background":
      await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            const backgroundSelect = Array.from(document.querySelectorAll("select"))
              .find((select) => Array.from(select.options).some((option) => option.value.startsWith("bg-")));
            const button = document.querySelector('[data-smoke-action="generate"]');
            if (backgroundSelect instanceof HTMLSelectElement && button instanceof HTMLButtonElement) {
              const backgroundOption = Array.from(backgroundSelect.options).find((option) => option.value.startsWith("bg-"));
              if (!backgroundOption) {
                reject(new Error("No library background option was found."));
                return;
              }
              backgroundSelect.value = backgroundOption.value;
              backgroundSelect.dispatchEvent(new Event("change", { bubbles: true }));
              setTimeout(() => {
                button.click();
                resolve(true);
              }, 500);
              return;
            }
            if (Date.now() - started > 8000) {
              reject(new Error("Background select was not ready."));
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        })
      `);
      await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
      return await readRenderSmokeResult(mainWindow);
    case "render-with-font":
      await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            const fontSelect = document.querySelector('[data-smoke-role="font-select"]');
            const button = document.querySelector('[data-smoke-action="generate"]');
            if (fontSelect instanceof HTMLSelectElement && button instanceof HTMLButtonElement) {
              const fontOption = Array.from(fontSelect.options).find((option) => option.value.startsWith("font-"));
              if (!fontOption) {
                if (Date.now() - started > 10000) {
                  reject(new Error("No library font option was found."));
                  return;
                }
                setTimeout(tick, 100);
                return;
              }
              fontSelect.value = fontOption.value;
              fontSelect.dispatchEvent(new Event("change", { bubbles: true }));
              const waitForFont = () => {
                if (document.fonts.check('16px "Cardnews User Font"')) {
                  setTimeout(() => {
                    button.click();
                    resolve(true);
                  }, 500);
                  return;
                }
                if (Date.now() - started > 10000) {
                  reject(new Error("User font was not ready."));
                  return;
                }
                setTimeout(waitForFont, 100);
              };
              waitForFont();
              return;
            }
            if (Date.now() - started > 8000) {
              reject(new Error("Font select was not ready."));
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        })
      `);
      await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
      return await readRenderSmokeResult(mainWindow);
    case "template-pack-import":
      return await runTemplatePackImportSmoke(mainWindow);
    case "render-bulk-sample": {
      const result = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          const escapeCsv = (value) => /[",\\r\\n]/.test(value)
            ? '"' + value.replaceAll('"', '""') + '"'
            : value;
          const row = (values) => values.map(escapeCsv).join(",");
          const card01 = [
            "유형: 표지",
            "배지: MONEY NOTE",
            "제목: CSV 벌크 표지",
            "소제목: 정상 행은 렌더되고 실패 행은 보고서에 남습니다"
          ].join("\\n");
          const card02 = [
            "유형: 본문",
            "제목: CSV 벌크 본문",
            "본문: 템플릿 셀 안의 여러 줄 원문을 그대로 카드로 렌더합니다.",
            "- 정상 행",
            "- 실패 행 분리"
          ].join("\\n");
          const csvText = [
            "output_name,header_label,footer_account,style_id,aspect_ratio,card_01,card_02,background,font_id",
            row(["bulk-smoke-ok", "MONEY NOTE", "@kkongdon_story", "newsprint", "4:5", card01, card02, "", ""]),
            row(["bulk-smoke-bad-style", "MONEY NOTE", "@kkongdon_story", "missing-style", "4:5", card01, card02, "", ""]),
            row(["bulk-smoke-bad-background", "MONEY NOTE", "@kkongdon_story", "newsprint", "4:5", card01, card02, "bg-missing", ""]),
            row(["bulk-smoke-bad-font", "MONEY NOTE", "@kkongdon_story", "newsprint", "4:5", card01, card02, "", "font-missing"])
          ].join("\\n");
          const result = await window.cardnews.renderBulkCsv(csvText);
          const evidence = document.createElement("pre");
          evidence.id = "bulk-smoke-result";
          evidence.textContent = "BULK_SMOKE_RESULT " + JSON.stringify(result);
          document.body.append(evidence);
          return result;
        })()
      `);
      if (!result || result.ok === false) {
        return { ok: false, message: result?.message ?? "Bulk smoke failed before rendering." };
      }
      if (result.renderedCount < 1 || result.failedCount < 3 || !result.zipPath) {
        return { ok: false, message: "Bulk smoke did not render valid rows while preserving invalid-row failure." };
      }
      return { ok: true };
    }
    case "project-roundtrip":
      return await runProjectRoundtripSmoke(mainWindow);
    case "body-number-roundtrip-regression":
      return await runBodyNumberRoundtripRegressionSmoke(mainWindow);
    case "edit-layer":
      return await runLayerEditSmoke(mainWindow);
    case "layer-controls-regression":
      return await runLayerControlsRegressionSmoke(mainWindow);
    case "line-endpoint-regression":
      return await runLineEndpointRegressionSmoke(mainWindow);
    case "footer-display-regression":
      return await runFooterDisplayRegressionSmoke(mainWindow);
    case "page-format-dropdown-regression":
      return await runPageFormatDropdownRegressionSmoke(mainWindow);
    case "content-input-latency-regression":
      return await runContentInputLatencyRegressionSmoke(mainWindow);
    case "content-title-whitespace-regression":
      return await runContentTitleWhitespaceRegressionSmoke(mainWindow);
    case "inspector-layout-regression":
      return await runInspectorLayoutRegressionSmoke(mainWindow);
    case "inspector-design-scroll-regression":
      return await runInspectorDesignScrollRegressionSmoke(mainWindow);
    case "chrome-style-regression":
      return await runChromeStyleRegressionSmoke(mainWindow);
    case "content-form-regression":
      return await runContentFormRegressionSmoke(mainWindow);
    case "image-picker-library-hygiene-regression":
      return await runImagePickerLibraryHygieneRegressionSmoke(mainWindow);
    case "m15-image-library-before":
      return await runM15ImageLibraryBeforeSmoke(mainWindow);
    case "m15-toolbar":
      return await runM15ToolbarSmoke(mainWindow);
    case "background-manager-regression": {
      const { runBackgroundManagerSmoke } = await import("./backgroundManagerSmoke.js");
      return await runBackgroundManagerSmoke(mainWindow, storageRoot());
    }
    case "badge-background-removal-regression":
      return await runBadgeBackgroundRemovalRegressionSmoke(mainWindow);
    case "next-hint-image-regression":
      return await runNextHintImageRegressionSmoke(mainWindow);
    case "ai-provider-detection-regression":
    case "ai-raw-chat-regression":
    case "ai-error-sanitization-regression":
    case "ai-preset-retry-regression":
    case "ai-timeout-progress-regression":
    case "ai-preset-mode-regression":
    case "ai-provider-command-regression":
    case "ai-workflow-regression":
    case "ai-workflow-visual-regression":
    case "ai-draft-regression":
      return await runAiSmokeAction(smokeAction, mainWindow);
    default:
      throw new SmokeCaptureError(`Unknown CARDNEWS_SMOKE_ACTION: ${smokeAction}`);
  }
}

async function runAiSmokeAction(action: string, mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  switch (action) {
    case "ai-provider-detection-regression": {
      const { runAiProviderDetectionRegressionSmoke } = await import("./ai/smoke/aiSmokeConversation.js");
      return await runAiProviderDetectionRegressionSmoke(mainWindow);
    }
    case "ai-raw-chat-regression": {
      const { runAiRawChatRegressionSmoke } = await import("./ai/smoke/aiSmokeConversation.js");
      return await runAiRawChatRegressionSmoke(mainWindow);
    }
    case "ai-error-sanitization-regression": {
      const { runAiErrorSanitizationRegressionSmoke } = await import("./ai/smoke/aiSmokeErrors.js");
      return await runAiErrorSanitizationRegressionSmoke(mainWindow);
    }
    case "ai-preset-retry-regression": {
      const { runAiPresetRetryRegressionSmoke } = await import("./ai/smoke/aiSmokeErrors.js");
      return await runAiPresetRetryRegressionSmoke(mainWindow);
    }
    case "ai-timeout-progress-regression": {
      const { runAiTimeoutProgressRegressionSmoke } = await import("./ai/smoke/aiSmokeProgressPresets.js");
      return await runAiTimeoutProgressRegressionSmoke(mainWindow);
    }
    case "ai-preset-mode-regression": {
      const { runAiPresetModeRegressionSmoke } = await import("./ai/smoke/aiSmokeProgressPresets.js");
      return await runAiPresetModeRegressionSmoke(mainWindow);
    }
    case "ai-provider-command-regression": {
      const { runAiProviderCommandRegressionSmoke } = await import("./ai/smoke/aiSmokeCommandWorkflow.js");
      return await runAiProviderCommandRegressionSmoke(mainWindow, storageRoot());
    }
    case "ai-workflow-regression": {
      const { runAiWorkflowRegressionSmoke } = await import("./ai/smoke/aiSmokeCommandWorkflow.js");
      return await runAiWorkflowRegressionSmoke(mainWindow);
    }
    case "ai-workflow-visual-regression": {
      const { runAiWorkflowVisualRegressionSmoke } = await import("./ai/smoke/aiSmokeVisual.js");
      return await runAiWorkflowVisualRegressionSmoke(mainWindow);
    }
    case "ai-draft-regression": {
      const { runAiDraftRegressionSmoke } = await import("./ai/smoke/aiSmokeDraft.js");
      return await runAiDraftRegressionSmoke(mainWindow, {
        clickSmokeButton,
        readRenderSmokeResult,
        waitForSmokeText
      });
    }
    default:
      return { ok: false, message: `Unknown AI smoke action: ${action}` };
  }
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

async function runProjectRoundtripSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  let originalWorkspace = await loadWorkspaceState(storageRoot());
  if (!originalWorkspace) {
    originalWorkspace = await seedProjectSmokeWorkspace();
  }

  const smokeDir = path.join(storageRoot(), "smoke-project");
  const projectPath = path.join(smokeDir, "roundtrip.cardnews");
  const importRoot = path.join(smokeDir, "import-root");
  await fs.rm(smokeDir, { recursive: true, force: true });
  await fs.mkdir(importRoot, { recursive: true });

  const exported = await exportProjectArchive(storageRoot(), projectPath, app.getVersion());
  if (isCardnewsError(exported)) {
    return { ok: false, message: exported.message };
  }

  const imported = await importProjectArchive(importRoot, projectPath);
  if (isCardnewsError(imported)) {
    return { ok: false, message: imported.message };
  }

  const importedWorkspace = imported.workspace;
  if (
    importedWorkspace.cards.length !== originalWorkspace.cards.length ||
    importedWorkspace.styleId !== originalWorkspace.styleId ||
    importedWorkspace.headerLabel !== originalWorkspace.headerLabel ||
    importedWorkspace.footerAccount !== originalWorkspace.footerAccount
  ) {
    return { ok: false, message: "Project smoke workspace fields did not roundtrip." };
  }

  if (originalWorkspace.backgroundId) {
    if (!importedWorkspace.backgroundId || !(await findLibraryBackground(importRoot, importedWorkspace.backgroundId))) {
      return { ok: false, message: "Project smoke background asset did not import." };
    }
  }

  if (originalWorkspace.fontId) {
    if (!importedWorkspace.fontId || !(await findLibraryFont(importRoot, importedWorkspace.fontId))) {
      return { ok: false, message: "Project smoke font asset did not import." };
    }
  }

  const evidence = {
    projectPath,
    importedWorkspace,
    backgroundCount: imported.backgroundCount,
    fontCount: imported.fontCount,
    presetCount: imported.presetCount,
    styleCount: imported.styleCount
  };
  await mainWindow.webContents.executeJavaScript(`
    (() => {
      const pre = document.createElement("pre");
      pre.id = "project-roundtrip-result";
      pre.textContent = "PROJECT_ROUNDTRIP_RESULT " + ${JSON.stringify(JSON.stringify(evidence))};
      document.body.append(pre);
    })()
  `);

  return { ok: true };
}

async function seedProjectSmokeWorkspace(): Promise<WorkspaceState> {
  const [backgrounds, fonts] = await Promise.all([listBackgroundLibrary(storageRoot()), listFontLibrary(storageRoot())]);
  const workspace: WorkspaceState = {
    headerLabel: "MONEY NOTE",
    footerAccount: "@kkongdon_story",
    styleId: "minimal",
    aspectRatio: "4:5",
    ...(backgrounds[0] ? { backgroundId: backgrounds[0].id } : {}),
    ...(fonts[0] ? { fontId: fonts[0].id } : {}),
    cards: [
      "유형: 표지\n배지: PROJECT\n제목: 프로젝트 저장 테스트\n소제목: cardnews 라운드트립",
      "유형: 본문\n제목: 불러오기 검증\n본문: 저장한 카드와 설정을 다시 불러옵니다."
    ],
    selectedIndex: 0
  };
  await saveWorkspaceState(storageRoot(), workspace);
  return workspace;
}

type BodyNumberSmokePhase = "customize" | "delete" | "verify-deleted";

async function runBodyNumberRoundtripRegressionSmoke(
  mainWindow: BrowserWindow
): Promise<SmokeActionResult> {
  const customize = await runBodyNumberSmokePhase(mainWindow, "customize");
  if (!isSuccessfulBodyNumberSmokePhase(customize, "customize")) {
    return {
      ok: false,
      message: `Body-number customize smoke failed: ${JSON.stringify(customize)}`
    };
  }

  await reloadSmokeWindow(mainWindow);
  const deletion = await runBodyNumberSmokePhase(mainWindow, "delete");
  if (!isSuccessfulBodyNumberSmokePhase(deletion, "delete")) {
    return {
      ok: false,
      message: `Body-number delete smoke failed: ${JSON.stringify(deletion)}`
    };
  }

  const persistedWorkspace = await loadWorkspaceState(storageRoot());
  const persistedOverride = persistedWorkspace?.overrides?.["2"];
  if (
    persistedOverride?.bodyNumberMode !== "hide" ||
    persistedOverride.bodyNumberText !== "A"
  ) {
    return {
      ok: false,
      message: `Body-number workspace persistence failed: ${JSON.stringify(persistedOverride)}`
    };
  }

  const projectSmokeRoot = path.join(storageRoot(), "body-number-project-roundtrip");
  const projectPath = path.join(projectSmokeRoot, "body-number.cardnews");
  const importRoot = path.join(projectSmokeRoot, "import-root");
  await fs.rm(projectSmokeRoot, { recursive: true, force: true });
  await fs.mkdir(importRoot, { recursive: true });
  const exported = await exportProjectArchive(storageRoot(), projectPath, app.getVersion());
  if (isCardnewsError(exported)) {
    return { ok: false, message: exported.message };
  }
  const imported = await importProjectArchive(importRoot, projectPath);
  if (isCardnewsError(imported)) {
    return { ok: false, message: imported.message };
  }
  const importedOverride = imported.workspace.overrides?.["2"];
  if (
    importedOverride?.bodyNumberMode !== "hide" ||
    importedOverride.bodyNumberText !== "A"
  ) {
    return {
      ok: false,
      message: `Body-number project archive persistence failed: ${JSON.stringify(importedOverride)}`
    };
  }

  await reloadSmokeWindow(mainWindow);
  const verification = await runBodyNumberSmokePhase(mainWindow, "verify-deleted");
  if (!isSuccessfulBodyNumberSmokePhase(verification, "verify-deleted")) {
    return {
      ok: false,
      message: `Body-number reopen smoke failed: ${JSON.stringify(verification)}`
    };
  }

  await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
  const renderResult = await readRenderSmokeResult(mainWindow);
  if (!renderResult.ok) {
    return renderResult;
  }

  const outputDir = await findLatestRenderOutputDirectory();
  if (!outputDir) {
    return { ok: false, message: "Body-number smoke render output directory was not found." };
  }
  const cardHtmlPath = path.join(outputDir, "card-02.html");
  const cardPngPath = path.join(outputDir, "card-02.png");
  const [cardHtml, cardPngStat] = await Promise.all([
    fs.readFile(cardHtmlPath, "utf8"),
    fs.stat(cardPngPath)
  ]);
  if (cardHtml.includes('data-slot="body-number"') || cardPngStat.size < 1024) {
    return {
      ok: false,
      message: `Body-number PNG render persistence failed: ${JSON.stringify({
        bodyNumberPresent: cardHtml.includes('data-slot="body-number"'),
        pngBytes: cardPngStat.size
      })}`
    };
  }

  const evidence = {
    customize,
    deletion,
    verification,
    projectPath,
    outputDir,
    cardHtmlPath,
    cardPngPath,
    pngBytes: cardPngStat.size
  };
  await mainWindow.webContents.executeJavaScript(`
    (() => {
      const pre = document.createElement("pre");
      pre.id = "body-number-roundtrip-result";
      pre.style.position = "fixed";
      pre.style.left = "-100000px";
      pre.textContent = "BODY_NUMBER_ROUNDTRIP_RESULT " + ${JSON.stringify(JSON.stringify(evidence))};
      document.body.append(pre);
    })()
  `);
  console.log(`BODY_NUMBER_ROUNDTRIP_RESULT ${JSON.stringify(evidence)}`);
  return { ok: true };
}

function isSuccessfulBodyNumberSmokePhase(
  value: unknown,
  phase: BodyNumberSmokePhase
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["ok"] === true &&
    (value as Record<string, unknown>)["phase"] === phase
  );
}

async function runBodyNumberSmokePhase(
  mainWindow: BrowserWindow,
  phase: BodyNumberSmokePhase
): Promise<unknown> {
  const phasePromise = mainWindow.webContents.executeJavaScript(`
    (async () => {
      const phase = ${JSON.stringify(phase)};
      window.__cardnewsBodyNumberSmokeInputStage = "idle";
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitUntil = async (predicate, description, timeout = 15000) => {
        const started = Date.now();
        let lastError = "";
        while (Date.now() - started < timeout) {
          try {
            const result = await predicate();
            if (result) return result;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
          await delay(80);
        }
        throw new Error(description + (lastError ? " / last error: " + lastError : ""));
      };
      const waitFor = (selector, timeout = 15000) =>
        waitUntil(
          () => document.querySelector(selector),
          "Body-number smoke target was not found: " + selector,
          timeout
        );
      const click = async (selector) => {
        const element = await waitFor(selector);
        if (!(element instanceof HTMLElement)) {
          throw new Error("Body-number smoke target is not clickable: " + selector);
        }
        element.click();
        return element;
      };
      const selectCard = async (zeroBasedIndex) => {
        const thumbnails = await waitUntil(
          () => {
            const items = Array.from(document.querySelectorAll(".slide-thumb"));
            return items.length > zeroBasedIndex ? items : null;
          },
          "Slide thumbnails were not ready."
        );
        thumbnails[zeroBasedIndex].click();
        await waitUntil(
          () =>
            Array.from(document.querySelectorAll(".slide-thumb")).findIndex((item) =>
              item.classList.contains("active")
            ) === zeroBasedIndex,
          "Selected slide did not become active."
        );
      };
      const ensureEditMode = async () => {
        if (!document.querySelector(".edit-overlay")) {
          await click('[data-smoke-action="toggle-edit-mode"]');
        }
        await waitFor(".edit-overlay");
      };
      const readIframeDocument = (kind) => {
        const selector =
          kind === "stage"
            ? '.stage .stage-canvas iframe[title="selected-card"]'
            : 'iframe[title="card-2"]';
        const iframe = document.querySelector(selector);
        return iframe instanceof HTMLIFrameElement ? iframe.contentDocument : null;
      };
      const readBodyNumber = (kind) => {
        const doc = readIframeDocument(kind);
        const element = doc?.querySelector('[data-slot="body-number"]');
        return element?.textContent ?? null;
      };
      const readSurfaceSnapshot = (kind) => {
        const doc = readIframeDocument(kind);
        const card = doc?.querySelector(".card");
        if (!card || typeof card.getBoundingClientRect !== "function") {
          throw new Error("Card surface was not readable: " + kind);
        }
        const cardRect = card.getBoundingClientRect();
        if (cardRect.width <= 0 || cardRect.height <= 0) {
          throw new Error("Card surface has invalid geometry: " + kind);
        }
        const entries = Array.from(doc.querySelectorAll("[data-semantic-item-id]")).map((element) => {
          const id = element.getAttribute("data-semantic-item-id");
          const rect = element.getBoundingClientRect();
          const style = doc.defaultView?.getComputedStyle(element);
          return [
            id,
            {
              text: element.textContent ?? "",
              left: (rect.left - cardRect.left) / cardRect.width,
              top: (rect.top - cardRect.top) / cardRect.height,
              width: rect.width / cardRect.width,
              height: rect.height / cardRect.height,
              fontSize: style?.fontSize ?? "",
              fontWeight: style?.fontWeight ?? "",
              lineHeight: style?.lineHeight ?? "",
              letterSpacing: style?.letterSpacing ?? "",
              textAlign: style?.textAlign ?? "",
              opacity: style?.opacity ?? "",
              visibility: style?.visibility ?? "",
              zIndex: style?.zIndex ?? ""
            }
          ];
        });
        return Object.fromEntries(entries.filter(([id]) => Boolean(id)));
      };
      const compareSurfaces = () => {
        const stage = readSurfaceSnapshot("stage");
        const thumbnail = readSurfaceSnapshot("thumbnail");
        const stageIds = Object.keys(stage).sort();
        const thumbnailIds = Object.keys(thumbnail).sort();
        const missing = stageIds
          .filter((id) => !thumbnailIds.includes(id))
          .concat(thumbnailIds.filter((id) => !stageIds.includes(id)));
        let maxGeometryDelta = 0;
        const styleMismatches = [];
        for (const id of stageIds.filter((candidate) => thumbnail[candidate])) {
          const left = stage[id];
          const right = thumbnail[id];
          for (const key of ["left", "top", "width", "height"]) {
            maxGeometryDelta = Math.max(maxGeometryDelta, Math.abs(left[key] - right[key]));
          }
          for (const key of [
            "text",
            "fontSize",
            "fontWeight",
            "lineHeight",
            "letterSpacing",
            "textAlign",
            "opacity",
            "visibility",
            "zIndex"
          ]) {
            if (left[key] !== right[key]) {
              styleMismatches.push({ id, key, stage: left[key], thumbnail: right[key] });
            }
          }
        }
        return {
          ok: missing.length === 0 && styleMismatches.length === 0 && maxGeometryDelta <= 0.002,
          missing,
          styleMismatches,
          maxGeometryDelta,
          itemCount: stageIds.length
        };
      };
      const waitForSurfaceMatch = () =>
        waitUntil(
          () => {
            const comparison = compareSurfaces();
            return comparison.ok ? comparison : null;
          },
          "Stage and thumbnail semantic surfaces did not converge."
        );
      const waitForBodyNumber = async (expected) => {
        try {
          return await waitUntil(
            () =>
              readBodyNumber("stage") === expected &&
              readBodyNumber("thumbnail") === expected,
            "Body number did not match in stage and thumbnail. expected=" + String(expected)
          );
        } catch (error) {
          const workspace = await window.cardnews.loadWorkspace();
          throw new Error(
            (error instanceof Error ? error.message : String(error)) +
              " diagnostics=" +
              JSON.stringify({
                textareaValue: document.querySelector(".semantic-inline-textarea")?.value ?? null,
                stage: readBodyNumber("stage"),
                thumbnail: readBodyNumber("thumbnail"),
                override: workspace?.overrides?.["2"] ?? null
              })
          );
        }
      };
      const waitForWorkspaceOverride = async (mode, text) =>
        waitUntil(
          async () => {
            const workspace = await window.cardnews.loadWorkspace();
            const override = workspace?.overrides?.["2"];
            return override?.bodyNumberMode === mode && override?.bodyNumberText === text
              ? { mode: override.bodyNumberMode, text: override.bodyNumberText }
              : null;
          },
          "Workspace override did not persist. mode=" + mode + " text=" + text
        );
      const waitForBodyNumberBox = () => {
        const selector = '[data-semantic-slot$=":body-number"]';
        return waitUntil(
          () => document.querySelector(selector),
          "Body-number smoke target was not found: " +
            selector +
            " diagnostics=" +
            JSON.stringify({
              overlayIds: Array.from(document.querySelectorAll("[data-semantic-slot]")).map((element) =>
                element.getAttribute("data-semantic-slot")
              ),
              stageIds: Array.from(
                readIframeDocument("stage")?.querySelectorAll("[data-semantic-item-id]") ?? []
              ).map((element) => element.getAttribute("data-semantic-item-id")),
              thumbnailIds: Array.from(
                readIframeDocument("thumbnail")?.querySelectorAll("[data-semantic-item-id]") ?? []
              ).map((element) => element.getAttribute("data-semantic-item-id")),
              stageBodyNumber: readBodyNumber("stage"),
              thumbnailBodyNumber: readBodyNumber("thumbnail"),
              editOverlay: (() => {
                const overlay = document.querySelector(".edit-overlay");
                return overlay
                  ? {
                      semanticSlotCount: overlay.getAttribute("data-semantic-slot-count"),
                      measuredSemanticCount: overlay.getAttribute("data-measured-semantic-count")
                    }
                  : null;
              })()
            })
        );
      };
      const selectBodyNumber = async () => {
        const box = await waitForBodyNumberBox();
        const rect = box.getBoundingClientRect();
        box.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 72,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            buttons: 1
          })
        );
        const overlay = await waitFor(".edit-overlay");
        overlay.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 72,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            buttons: 0
          })
        );
        overlay.focus();
        await waitFor('[data-toolbar-target="body-number"]');
        return overlay;
      };
      const deleteWithKey = async (key) => {
        const overlay = await selectBodyNumber();
        overlay.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
        await waitForBodyNumber(null);
      };
      const historyAction = async (label, expected) => {
        const button = await waitUntil(
          () => {
            const candidate = document.querySelector('[aria-label="' + label + '"]');
            return candidate instanceof HTMLButtonElement && !candidate.disabled ? candidate : null;
          },
          "History action was not enabled: " + label
        );
        button.click();
        await waitForBodyNumber(expected);
      };

      window.confirm = () => true;
      await waitUntil(
        () => document.querySelector('[data-smoke-workspace-ready="true"]'),
        "Workspace hydration did not complete."
      );

      if (phase === "customize") {
        await click('[data-smoke-action="reset-workspace"]');
        await selectCard(1);
        await ensureEditMode();
        await waitForBodyNumber("01");
        const initialSurface = await waitForSurfaceMatch();
        const openBodyNumberEditor = async () => {
          const box = await waitForBodyNumberBox();
          const rect = box.getBoundingClientRect();
          box.dispatchEvent(
            new MouseEvent("dblclick", {
              bubbles: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2
            })
          );
          const textarea = await waitFor(".semantic-inline-textarea");
          if (!(textarea instanceof HTMLTextAreaElement)) {
            throw new Error("Body-number inline editor is not a textarea.");
          }
          return textarea;
        };
        const requestTextInput = async (textarea, stage, expected) => {
          textarea.focus();
          textarea.select();
          window.__cardnewsBodyNumberSmokeInputStage = stage;
          await waitUntil(
            () => textarea.value === expected,
            "Body-number textarea did not receive text. expected=" + expected
          );
          textarea.blur();
          await waitForBodyNumber(expected);
        };
        await requestTextInput(await openBodyNumberEditor(), "korean", "첫 번째");
        const koreanSurface = await waitForSurfaceMatch();
        const persistedKorean = await waitForWorkspaceOverride("show", "첫 번째");

        await requestTextInput(await openBodyNumberEditor(), "ascii", "A");
        const customizedSurface = await waitForSurfaceMatch();
        const persisted = await waitForWorkspaceOverride("show", "A");
        return {
          ok: true,
          phase,
          initialText: "01",
          koreanText: "첫 번째",
          customText: "A",
          initialSurface,
          koreanSurface,
          customizedSurface,
          persistedKorean,
          persisted
        };
      }

      if (phase === "delete") {
        await selectCard(1);
        await ensureEditMode();
        await waitForBodyNumber("A");
        const restoredSurface = await waitForSurfaceMatch();

        await deleteWithKey("Delete");
        await historyAction("되돌리기", "A");
        await historyAction("다시 실행", null);
        await historyAction("되돌리기", "A");

        await deleteWithKey("Backspace");
        await historyAction("되돌리기", "A");

        await selectBodyNumber();
        await click('[data-smoke-action="delete-body-number"]');
        await waitForBodyNumber(null);
        await selectCard(2);
        await selectCard(1);
        await waitForBodyNumber(null);
        const deletedSurface = await waitForSurfaceMatch();
        const persisted = await waitForWorkspaceOverride("hide", "A");
        return {
          ok: true,
          phase,
          deleteKey: true,
          backspaceKey: true,
          toolbarDelete: true,
          undo: true,
          redo: true,
          pageSwitch: true,
          restoredSurface,
          deletedSurface,
          persisted
        };
      }

      await selectCard(1);
      await ensureEditMode();
      await waitForBodyNumber(null);
      const reopenedSurface = await waitForSurfaceMatch();
      const persisted = await waitForWorkspaceOverride("hide", "A");
      await click('[data-smoke-action="open-export-dialog"]');
      await click('[data-smoke-action="export-png-choice"]');
      return {
        ok: true,
        phase,
        reopenedDeleted: true,
        reopenedSurface,
        persisted,
        renderStarted: true
      };
    })()
  `);
  let phaseValue: unknown;
  let phaseError: unknown;
  const observedPhase = phasePromise.then(
    (value) => {
      phaseValue = value;
    },
    (error: unknown) => {
      phaseError = error;
    }
  );
  if (phase === "customize") {
    const waitForInputStage = async (expected: "korean" | "ascii"): Promise<void> => {
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        if (phaseError) {
          throw phaseError;
        }
        const current = await mainWindow.webContents.executeJavaScript(
          "window.__cardnewsBodyNumberSmokeInputStage ?? null"
        );
        if (current === expected) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      throw new Error(`Body-number smoke input stage was not ready: ${expected}`);
    };
    const debuggerClient = mainWindow.webContents.debugger;
    const attachedBySmoke = !debuggerClient.isAttached();
    if (attachedBySmoke) {
      debuggerClient.attach("1.3");
    }
    try {
      await waitForInputStage("korean");
      await debuggerClient.sendCommand("Input.insertText", { text: "첫 번째" });
      await waitForInputStage("ascii");
      await debuggerClient.sendCommand("Input.insertText", { text: "A" });
    } finally {
      if (attachedBySmoke && debuggerClient.isAttached()) {
        debuggerClient.detach();
      }
    }
  }
  await observedPhase;
  if (phaseError) {
    throw phaseError;
  }
  return phaseValue;
}

async function runLayerEditSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Layer edit smoke target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Layer edit smoke action is not a button: " + action);
        }
        button.click();
        await delay(120);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };

      window.confirm = () => true;
      await delay(1200);
      await clickAction("reset-workspace");
      await delay(350);
      if (!document.querySelector(".edit-overlay")) {
        await clickAction("toggle-edit-mode");
      }
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await waitUntil(
        () => document.querySelectorAll('[data-smoke-role="layer-box"]').length === 0,
        "Layer reset did not clear existing boxes."
      );
      await clickAction("add-text-layer");

      let box = await waitFor('[data-smoke-role="layer-box"]');
      const overlay = await waitFor(".edit-overlay");
      const before = box.getBoundingClientRect();
      const startX = before.left + Math.min(24, Math.max(8, before.width / 2));
      const startY = before.top + Math.min(24, Math.max(8, before.height / 2));
      box.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 42,
        clientX: startX,
        clientY: startY,
        buttons: 1
      }));
      overlay.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 42,
        clientX: startX + 20,
        clientY: startY + 145,
        buttons: 1,
        shiftKey: true
      }));
      overlay.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 42,
        clientX: startX + 20,
        clientY: startY + 145,
        buttons: 0
      }));
      await delay(350);

      box = await waitFor('[data-smoke-role="layer-box"]');
      const after = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        clientX: after.left + Math.min(24, Math.max(8, after.width / 2)),
        clientY: after.top + Math.min(24, Math.max(8, after.height / 2))
      }));
      const textarea = await waitFor(".layer-inline-textarea");
      if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error("Layer edit textarea was not available.");
      }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) {
        throw new Error("Layer edit textarea setter was not available.");
      }
      setter.call(textarea, "직접 편집 완료");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.blur();
      await delay(350);

      const generate = await waitFor('[data-smoke-action="generate"]');
      if (!(generate instanceof HTMLButtonElement)) {
        throw new Error("Layer edit render button was not available.");
      }
      generate.click();
      return {
        edited: document.body.innerText.includes("직접 편집 완료"),
        moved: Math.abs(after.left - before.left) > 6 || Math.abs(after.top - before.top) > 80
      };
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Layer edit smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  if (record["moved"] !== true || record["edited"] !== true) {
    return { ok: false, message: `Layer edit smoke failed: ${JSON.stringify(record)}` };
  }

  await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
  return await readRenderSmokeResult(mainWindow);
}

async function runFooterDisplayRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Footer smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Footer smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native input value setter was available.");
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const readFooter = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        return iframe.contentDocument.querySelector('[data-slot="footer"]')?.textContent?.trim() ?? "";
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      const input = await waitFor('[data-smoke-role="footer-input"], [data-smoke-role="mention-input"]');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Footer input was not an input.");
      }
      const labelText = input.closest("label")?.textContent ?? "";
      setNativeValue(input, "@kkongdon_story");
      await waitUntil(
        () => readFooter() === "@kkongdon_story",
        () => "Preview footer did not preserve @: " + readFooter()
      );
      const readThreadsUrl = () =>
        document.querySelector('[data-smoke-role="threads-link"]')?.getAttribute("data-smoke-url") ?? "";
      await waitUntil(
        () => readThreadsUrl() === "https://www.threads.com/@kkongdon_story",
        () => "Threads URL was not derived from footer display text: " + readThreadsUrl()
      );
      const evidence = { inputValue: input.value, labelText, previewFooter: readFooter(), threadsUrl: readThreadsUrl() };
      const pre = document.createElement("pre");
      pre.id = "footer-display-regression-result";
      pre.textContent = "FOOTER_DISPLAY_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Footer display smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  if (
    record["inputValue"] !== "@kkongdon_story" ||
    record["previewFooter"] !== "@kkongdon_story" ||
    record["threadsUrl"] !== "https://www.threads.com/@kkongdon_story" ||
    !String(record["labelText"] ?? "").includes("푸터")
  ) {
    return { ok: false, message: `Footer display smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

async function runPageFormatDropdownRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Page format smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Page format smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const setSelectValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native select value setter was available.");
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const readPage = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        return iframe.contentDocument.querySelector('[data-slot="page"]')?.textContent?.trim() ?? "";
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      const select = await waitFor('[data-smoke-role="chrome-page-template"]');
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error("Page format control was not a dropdown.");
      }
      const labels = Array.from(select.options).map((option) => option.textContent?.trim() ?? "");
      const presets = [
        { label: "1 / N", value: "{n} / {total}", expected: "1 / 10" },
        { label: "1/N", value: "{n}/{total}", expected: "1/10" },
        { label: "1-N", value: "{n}-{total}", expected: "1-10" },
        { label: "01 / N", value: "{n2} / {total}", expected: "01 / 10" },
        { label: "1장 / N장", value: "{n}장 / {total}장", expected: "1장 / 10장" }
      ];
      const results = [];
      for (const preset of presets) {
        setSelectValue(select, preset.value);
        await waitUntil(
          () => readPage() === preset.expected,
          () => "Page preview did not use selected preset " + preset.label + ": " + readPage()
        );
        results.push({
          label: preset.label,
          selectedValue: select.value,
          pageText: readPage(),
          expected: preset.expected
        });
      }
      const evidence = { labels, results };
      const pre = document.createElement("pre");
      pre.id = "page-format-dropdown-regression-result";
      pre.textContent = "PAGE_FORMAT_DROPDOWN_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Page format dropdown smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const labels = Array.isArray(record["labels"]) ? record["labels"] : [];
  const results = Array.isArray(record["results"]) ? record["results"] : [];
  const expectedLabels = ["1 / N", "1/N", "1-N", "01 / N", "1장 / N장"];
  const missing = expectedLabels.filter((label) => !labels.includes(label));
  const expectedResults = [
    { label: "1 / N", value: "{n} / {total}", expected: "1 / 10" },
    { label: "1/N", value: "{n}/{total}", expected: "1/10" },
    { label: "1-N", value: "{n}-{total}", expected: "1-10" },
    { label: "01 / N", value: "{n2} / {total}", expected: "01 / 10" },
    { label: "1장 / N장", value: "{n}장 / {total}장", expected: "1장 / 10장" }
  ];
  const missingResults = expectedResults.filter(
    (expected) =>
      !results.some((item) => {
        if (typeof item !== "object" || item === null) {
          return false;
        }
        const candidate = item as Record<string, unknown>;
        return (
          candidate["label"] === expected.label &&
          candidate["selectedValue"] === expected.value &&
          candidate["pageText"] === expected.expected
        );
      })
  );
  if (missing.length > 0 || missingResults.length > 0) {
    return { ok: false, message: `Page format dropdown smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

async function runContentInputLatencyRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const setupResult = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Content latency smoke target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Content latency smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      const titleInput = await waitFor('[data-smoke-role="content-title"]');
      if (!(titleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content title control was not a textarea.");
      }
      titleInput.focus();
      titleInput.setSelectionRange(0, titleInput.value.length);
      window.__contentLatencySmokeStarted = performance.now();
      return true;
    })()
  `)) as unknown;

  if (setupResult !== true) {
    return { ok: false, message: "Content input latency smoke could not focus the title field." };
  }

  const typedTitle = "Money Note spaced title";
  const typedSubtitle = "Subtitle spaced note";
  const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const debuggerClient = mainWindow.webContents.debugger;
  let attachedDebugger = false;
  const focusContentField = async (role: string): Promise<void> => {
    const selector = `[data-smoke-role="${role}"]`;
    const focused = (await mainWindow.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!(input instanceof HTMLTextAreaElement)) {
          return false;
        }
        input.focus();
        input.setSelectionRange(0, input.value.length);
        return document.activeElement === input;
      })()
    `)) as unknown;
    if (focused !== true) {
      throw new Error(`Content input smoke could not focus ${role}.`);
    }
  };
  const insertTextThroughChromium = async (text: string): Promise<void> => {
    await debuggerClient.sendCommand("Input.insertText", { text });
    await delay(80);
  };

  if (!debuggerClient.isAttached()) {
    debuggerClient.attach("1.3");
    attachedDebugger = true;
  }
  try {
    await insertTextThroughChromium(typedTitle);
    await focusContentField("content-subtitle");
    await insertTextThroughChromium(typedSubtitle);
  } finally {
    if (attachedDebugger && debuggerClient.isAttached()) {
      debuggerClient.detach();
    }
  }

  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Content latency smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };

      const titleInput = await waitFor('[data-smoke-role="content-title"]');
      if (!(titleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content title control was not a textarea.");
      }
      const subtitleInput = await waitFor('[data-smoke-role="content-subtitle"]');
      if (!(subtitleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content subtitle control was not a textarea.");
      }
      await waitUntil(
        () => titleInput.value === "Money Note spaced title" && subtitleInput.value === "Subtitle spaced note",
        () => "Content fields did not receive typed key events: " + JSON.stringify({
          title: titleInput.value,
          subtitle: subtitleInput.value
        })
      );
      const valueAfterInput = titleInput.value;
      const subtitleAfterInput = subtitleInput.value;
      await delay(300);
      const rawInput = await waitFor('[data-smoke-role="raw-card-input"]');
      const rawValue = rawInput instanceof HTMLTextAreaElement ? rawInput.value : "";
      const evidence = {
        elapsedMs: Math.round((performance.now() - (window.__contentLatencySmokeStarted || performance.now())) * 100) / 100,
        method: "Input.insertText",
        rawValue,
        subtitleAfterInput,
        typedSubtitle: "Subtitle spaced note",
        typedTitle: "Money Note spaced title",
        valueAfterInput
      };
      const pre = document.createElement("pre");
      pre.id = "content-input-latency-regression-result";
      pre.textContent = "CONTENT_INPUT_LATENCY_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Content input latency smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const valueAfterInput = String(record["valueAfterInput"] ?? "");
  const subtitleAfterInput = String(record["subtitleAfterInput"] ?? "");
  const rawValue = String(record["rawValue"] ?? "");
  if (
    valueAfterInput !== typedTitle ||
    subtitleAfterInput !== typedSubtitle ||
    !rawValue.includes(`제목: ${typedTitle}`) ||
    !rawValue.includes(`소제목: ${typedSubtitle}`) ||
    record["method"] !== "Input.insertText"
  ) {
    return { ok: false, message: `Content input latency smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

async function runContentTitleWhitespaceRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const setupResult = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Title whitespace smoke target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Title whitespace smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      const titleInput = await waitFor('[data-smoke-role="content-title"]');
      if (!(titleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content title control was not a textarea.");
      }
      const subtitleInput = await waitFor('[data-smoke-role="content-subtitle"]');
      if (!(subtitleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content subtitle control was not a textarea.");
      }
      const setNativeValue = (element, value) => {
        const prototype = Object.getPrototypeOf(element);
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native value setter was available.");
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setNativeValue(titleInput, "갑자기 화면이 여전히 안");
      setNativeValue(subtitleInput, "숫자보다 먼저 보는 관점");
      titleInput.focus();
      titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
      return true;
    })()
  `)) as unknown;

  if (setupResult !== true) {
    return { ok: false, message: "Title whitespace smoke could not focus the title field." };
  }

  const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const debuggerClient = mainWindow.webContents.debugger;
  let attachedDebugger = false;
  const insertTextThroughChromium = async (text: string): Promise<void> => {
    await debuggerClient.sendCommand("Input.insertText", { text });
    await delay(120);
  };

  if (!debuggerClient.isAttached()) {
    debuggerClient.attach("1.3");
    attachedDebugger = true;
  }
  try {
    await insertTextThroughChromium(" ");
    await insertTextThroughChromium("\n");
    await insertTextThroughChromium("먹음");
    await mainWindow.webContents.executeJavaScript(`
      (() => {
        const subtitleInput = document.querySelector('[data-smoke-role="content-subtitle"]');
        if (!(subtitleInput instanceof HTMLTextAreaElement)) {
          throw new Error("Subtitle input disappeared.");
        }
        subtitleInput.focus();
        subtitleInput.setSelectionRange(subtitleInput.value.length, subtitleInput.value.length);
      })()
    `);
    await insertTextThroughChromium(" ");
    await insertTextThroughChromium("\n두번째 줄");
  } finally {
    if (attachedDebugger && debuggerClient.isAttached()) {
      debuggerClient.detach();
    }
  }

  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Title whitespace smoke target was not found after typing: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const titleInput = await waitFor('[data-smoke-role="content-title"]');
      const subtitleInput = await waitFor('[data-smoke-role="content-subtitle"]');
      const rawInput = await waitFor('[data-smoke-role="raw-card-input"]');
      if (
        !(titleInput instanceof HTMLTextAreaElement) ||
        !(subtitleInput instanceof HTMLTextAreaElement) ||
        !(rawInput instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Content whitespace controls were not textareas.");
      }
      const expectedTitle = "갑자기 화면이 여전히 안 \\n먹음";
      const expectedSubtitle = "숫자보다 먼저 보는 관점 \\n두번째 줄";
      await waitUntil(
        () => titleInput.value === expectedTitle && subtitleInput.value === expectedSubtitle,
        () => "Active fields dropped whitespace/newline: " + JSON.stringify({
          title: titleInput.value,
          subtitle: subtitleInput.value
        })
      );
      await waitUntil(
        () => rawInput.value.includes("제목: 갑자기 화면이 여전히 안 |먹음") &&
          rawInput.value.includes("소제목: 숫자보다 먼저 보는 관점 |두번째 줄"),
        () => "Raw card did not preserve textarea newlines: " + rawInput.value
      );
      await delay(1200);
      const workspace = await window.cardnews.loadWorkspace();
      const workspaceCards = workspace && !("ok" in workspace) ? workspace.cards : [];
      const persistedIndex = workspaceCards.findIndex((card) =>
        card.includes("제목: 갑자기 화면이 여전히 안 |먹음") &&
          card.includes("소제목: 숫자보다 먼저 보는 관점 |두번째 줄")
      );
      const persistedRaw = persistedIndex >= 0 ? workspaceCards[persistedIndex] : "";
      const evidence = {
        expectedSubtitle,
        expectedTitle,
        persistedIndex,
        persistedRaw,
        rawValue: rawInput.value,
        subtitleValue: subtitleInput.value,
        titleValue: titleInput.value
      };
      const pre = document.createElement("pre");
      pre.id = "content-title-whitespace-regression-result";
      pre.textContent = "CONTENT_TITLE_WHITESPACE_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Title whitespace smoke did not return a result." };
  }

  const record = result as Record<string, unknown>;
  const persistedRaw = typeof record["persistedRaw"] === "string" ? record["persistedRaw"] : "";
  const rawValue = typeof record["rawValue"] === "string" ? record["rawValue"] : "";
  if (
    record["titleValue"] !== "갑자기 화면이 여전히 안 \n먹음" ||
    record["subtitleValue"] !== "숫자보다 먼저 보는 관점 \n두번째 줄" ||
    !(persistedRaw.includes("제목: 갑자기 화면이 여전히 안 |먹음") ||
      rawValue.includes("제목: 갑자기 화면이 여전히 안 |먹음"))
  ) {
    return { ok: false, message: `Title whitespace smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

async function runInspectorLayoutRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Inspector layout smoke target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Inspector layout smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      const inspector = await waitFor(".inspector");
      if (!(inspector instanceof HTMLElement)) {
        throw new Error("Inspector was not an HTMLElement.");
      }
      inspector.scrollTop = inspector.scrollHeight;
      await delay(120);
      const visiblePanels = Array.from(inspector.querySelectorAll(".panel:not([hidden])")).filter(
        (panel) => panel instanceof HTMLElement
      );
      const lastPanel = visiblePanels.at(-1);
      if (!(lastPanel instanceof HTMLElement)) {
        throw new Error("No visible inspector panel was found.");
      }
      const inspectorRect = inspector.getBoundingClientRect();
      const panelRect = lastPanel.getBoundingClientRect();
      const bottomGap = Math.round((inspectorRect.bottom - panelRect.bottom) * 100) / 100;
      const evidence = {
        bottomGap,
        canScroll: inspector.scrollHeight > inspector.clientHeight,
        clientHeight: inspector.clientHeight,
        scrollHeight: inspector.scrollHeight
      };
      const pre = document.createElement("pre");
      pre.id = "inspector-layout-regression-result";
      pre.textContent = "INSPECTOR_LAYOUT_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Inspector layout smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  if (typeof record["bottomGap"] !== "number" || record["bottomGap"] < 8) {
    return { ok: false, message: `Inspector layout smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

async function runInspectorDesignScrollRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Inspector design scroll target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Inspector design scroll action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      const inspector = await waitFor(".inspector");
      const panel = await waitFor(".panel.grow:not([hidden])");
      const controls = await waitFor(".card-design-controls");
      const layerControls = await waitFor(".layer-controls");
      const addCardButton = await waitFor('[data-smoke-action="design-panel-add-card"]');
      const removeCardButton = await waitFor('[data-smoke-action="design-panel-remove-card"]');
      if (
        !(inspector instanceof HTMLElement) ||
        !(panel instanceof HTMLElement) ||
        !(controls instanceof HTMLElement) ||
        !(layerControls instanceof HTMLElement) ||
        !(addCardButton instanceof HTMLButtonElement) ||
        !(removeCardButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Inspector design scroll controls were not available.");
      }
      inspector.scrollTop = inspector.scrollHeight;
      await delay(250);
      const inspectorRect = inspector.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      const layerRect = layerControls.getBoundingClientRect();
      const addRect = addCardButton.getBoundingClientRect();
      const removeRect = removeCardButton.getBoundingClientRect();
      const whitePanelClipsChildren = controlsRect.bottom > panelRect.bottom + 1 || controlsRect.top < panelRect.top - 1;
      const bottomControlsReachable =
        addRect.bottom <= inspectorRect.bottom + 1 &&
        removeRect.bottom <= inspectorRect.bottom + 1 &&
        addRect.top >= inspectorRect.top - 1 &&
        removeRect.top >= inspectorRect.top - 1;
      const evidence = {
        bottomControlsReachable,
        inspector: {
          clientHeight: inspector.clientHeight,
          scrollHeight: inspector.scrollHeight,
          scrollTop: inspector.scrollTop
        },
        panelBottom: Math.round(panelRect.bottom * 100) / 100,
        controlsBottom: Math.round(controlsRect.bottom * 100) / 100,
        layerTop: Math.round(layerRect.top * 100) / 100,
        addButtonTop: Math.round(addRect.top * 100) / 100,
        removeButtonBottom: Math.round(removeRect.bottom * 100) / 100,
        whitePanelClipsChildren
      };
      const pre = document.createElement("pre");
      pre.id = "inspector-design-scroll-regression-result";
      pre.textContent = "INSPECTOR_DESIGN_SCROLL_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Inspector design scroll smoke did not return a result." };
  }

  const record = result as Record<string, unknown>;
  if (record["whitePanelClipsChildren"] !== false || record["bottomControlsReachable"] !== true) {
    return { ok: false, message: `Inspector design scroll smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

async function runImagePickerLibraryHygieneRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  await purgeImageLibrarySmokeFixtures(storageRoot());
  const sourceImage = nativeImage.createFromBitmap(createSmokeBadgeBitmap(), { width: 12, height: 12 });
  if (sourceImage.isEmpty()) {
    return { ok: false, message: "Image picker hygiene smoke source image could not be created." };
  }
  const internal = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "badge-smoke-source.png",
    internalSmokeImageAttribution
  );
  if (isCardnewsError(internal)) {
    return { ok: false, message: internal.message };
  }
  const visible = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "qa-picker-visible.png",
    smokeFixtureImageAttribution
  );
  if (isCardnewsError(visible)) {
    return { ok: false, message: visible.message };
  }

  await reloadSmokeWindow(mainWindow);
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Image picker hygiene target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(100);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Image picker hygiene action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native value setter for " + element.tagName);
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      await waitUntil(
        () => document.querySelector('[data-smoke-workspace-ready="true"]') !== null,
        "Badge picker smoke workspace hydration did not finish."
      );
      window.confirm = () => true;
      await clickAction("reset-workspace");
      await waitUntil(
        () => {
          const background = document.querySelector('[data-smoke-role="global-background-select"]');
          const style = document.querySelector(".topbar-style-select");
          return background instanceof HTMLSelectElement &&
            background.value === "" &&
            style instanceof HTMLSelectElement &&
            style.value === "newsprint";
        },
        () => "Badge picker smoke reset did not settle into the default workspace: " + document.body.innerText
      );
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await clickAction("open-badge-image-picker");
      const grid = await waitFor('[data-smoke-role="image-picker-grid"]');
      const searchInput = await waitFor('[data-smoke-role="image-picker-search"]');
      if (!(searchInput instanceof HTMLInputElement)) {
        throw new Error("Image picker search input was not available.");
      }
      await waitUntil(
        () => (grid.textContent ?? "").includes("qa-picker-visible"),
        () => "Image picker hygiene grid did not show visible QA image: " + (grid.textContent ?? "")
      );
      const textBeforeSearch = grid.textContent ?? "";
      setNativeValue(searchInput, "qa-picker-visible");
      await waitUntil(
        () => (grid.textContent ?? "").includes("qa-picker-visible") && !(grid.textContent ?? "").includes("badge-smoke-source"),
        () => "Image picker search did not filter to visible QA image: " + (grid.textContent ?? "")
      );
      const sourceButton = Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).find((button) =>
        (button.textContent ?? "").includes("qa-picker-visible")
      );
      if (!(sourceButton instanceof HTMLButtonElement)) {
        throw new Error("Image picker visible QA source button was not found.");
      }
      sourceButton.click();
      await waitFor('[data-smoke-role="image-picker-selected-preview"]');
      const deleteButton = await waitFor('[data-smoke-action="image-picker-delete"]');
      if (!(deleteButton instanceof HTMLButtonElement)) {
        throw new Error("Image picker delete action was not a button.");
      }
      const deleteButtonEnabled = !deleteButton.disabled;
      if (!deleteButtonEnabled) {
        throw new Error("Image picker delete button stayed disabled for an unused image.");
      }
      deleteButton.click();
      await waitUntil(
        () => !(grid.textContent ?? "").includes("qa-picker-visible"),
        () => "Image picker visible QA image was not removed: " + (grid.textContent ?? "")
      );
      const textAfterDelete = grid.textContent ?? "";
      const evidence = {
        deleteButtonEnabled,
        deletedVisible: !textAfterDelete.includes("qa-picker-visible"),
        hiddenInternal: !textBeforeSearch.includes("badge-smoke-source"),
        searchFiltered: searchInput.value === "qa-picker-visible" && !textAfterDelete.includes("badge-smoke-source"),
        shownVisibleBefore: textBeforeSearch.includes("qa-picker-visible"),
        textAfterDelete,
        textBeforeSearch
      };
      const pre = document.createElement("pre");
      pre.id = "image-picker-library-hygiene-regression-result";
      pre.textContent = "IMAGE_PICKER_LIBRARY_HYGIENE_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Image picker hygiene smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  if (
    record["hiddenInternal"] !== true ||
    record["shownVisibleBefore"] !== true ||
    record["searchFiltered"] !== true ||
    record["deleteButtonEnabled"] !== true ||
    record["deletedVisible"] !== true
  ) {
    return { ok: false, message: `Image picker hygiene smoke failed: ${JSON.stringify(record)}` };
  }
  await purgeImageLibrarySmokeFixtures(storageRoot());
  return { ok: true };
}

async function runM15ImageLibraryBeforeSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  await purgeImageLibrarySmokeFixtures(storageRoot());
  const sourceImage = nativeImage.createFromBitmap(createSmokeBadgeBitmap(), { width: 12, height: 12 });
  if (sourceImage.isEmpty()) {
    return { ok: false, message: "M15 image library before smoke source image could not be created." };
  }

  const first = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "qa-duplicate.png",
    smokeFixtureImageAttribution
  );
  if (isCardnewsError(first)) {
    return { ok: false, message: first.message };
  }
  const second = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "qa-duplicate.png",
    smokeFixtureImageAttribution
  );
  if (isCardnewsError(second)) {
    return { ok: false, message: second.message };
  }

  await reloadSmokeWindow(mainWindow);
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("M15 image library before target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(100);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("M15 image library before action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const setNativeValue = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native input value setter was available.");
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      window.confirm = () => true;
      await waitUntil(
        () => document.querySelector('[data-smoke-workspace-ready="true"]') !== null,
        "M15 image library before workspace hydration did not finish."
      );
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await clickAction("open-badge-image-picker");
      const searchInput = await waitFor('[data-smoke-role="image-picker-search"]');
      if (!(searchInput instanceof HTMLInputElement)) {
        throw new Error("M15 image library before search input was not available.");
      }
      setNativeValue(searchInput, "qa-duplicate");
      const grid = await waitFor('[data-smoke-role="image-picker-grid"]');
      await waitUntil(
        () => Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).filter((button) =>
          (button.textContent ?? "").includes("qa-duplicate")
        ).length >= 2,
        () => "M15 image library before duplicates were not visible: " + (grid.textContent ?? "")
      );
      const duplicateButtons = Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).filter(
        (button) => (button.textContent ?? "").includes("qa-duplicate")
      );
      const firstButton = duplicateButtons[0];
      if (!(firstButton instanceof HTMLButtonElement)) {
        throw new Error("M15 image library before duplicate button was not available.");
      }
      firstButton.click();
      await waitFor('[data-smoke-role="image-picker-selected-preview"]');
      const idHintCount = grid.querySelectorAll(".image-picker-id").length;
      const evidence = {
        duplicateCount: duplicateButtons.length,
        idHintCount,
        searchValue: searchInput.value,
        selectedPreview: true,
        text: grid.textContent ?? ""
      };
      const pre = document.createElement("pre");
      pre.id = "m15-image-library-before-result";
      pre.textContent = "M15_IMAGE_LIBRARY_BEFORE_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "M15 image library before smoke did not return a result." };
  }

  const record = result as Record<string, unknown>;
  if (record["duplicateCount"] !== 2 || record["selectedPreview"] !== true) {
    return { ok: false, message: `M15 image library before smoke failed: ${JSON.stringify(record)}` };
  }

  return { ok: true };
}

async function runM15ToolbarSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("M15 toolbar smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("M15 toolbar smoke action is not a button: " + action);
        }
        button.click();
        await delay(160);
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
          throw new Error("Preview iframe was not readable.");
        }
        const textLayer = iframe.contentDocument.querySelector(".layer-text");
        return textLayer?.getAttribute("style") ?? "";
      };

      window.confirm = () => true;
      await delay(900);
      await clickAction("reset-workspace");
      const editToggle = await waitFor('[data-smoke-action="toggle-edit-mode"]');
      if (editToggle instanceof HTMLButtonElement && !editToggle.classList.contains("active")) {
        editToggle.click();
        await delay(160);
      }
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await clickAction("add-text-layer");
      await waitFor('[data-smoke-role="layer-box"]');
      const toolbar = await waitFor('[data-smoke-role="floating-editor-toolbar"] [data-toolbar-target="text-layer"]');
      if (!(toolbar instanceof HTMLElement)) {
        throw new Error("M15 toolbar target was not an HTMLElement.");
      }
      const colorInput = toolbar.querySelector('input[type="color"]');
      const sizeInput = toolbar.querySelector('input[type="number"]');
      if (!(colorInput instanceof HTMLInputElement) || !(sizeInput instanceof HTMLInputElement)) {
        throw new Error("M15 toolbar inputs were not available.");
      }
      setNativeValue(colorInput, "#336699");
      setNativeValue(sizeInput, 72);
      await waitUntil(
        () => readLayerStyle().includes("#336699") && readLayerStyle().includes("font-size: 72px"),
        () => "M15 toolbar did not update preview layer: " + readLayerStyle()
      );
      const evidence = {
        layerStyle: readLayerStyle(),
        toolbarText: toolbar.textContent ?? "",
        toolbarVisible: true
      };
      const pre = document.createElement("pre");
      pre.id = "m15-toolbar-smoke-result";
      pre.textContent = "M15_TOOLBAR_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "M15 toolbar smoke did not return a result." };
  }

  const record = result as Record<string, unknown>;
  const layerStyle = typeof record["layerStyle"] === "string" ? record["layerStyle"] : "";
  if (record["toolbarVisible"] !== true || !layerStyle.includes("#336699") || !layerStyle.includes("font-size: 72px")) {
    return { ok: false, message: `M15 toolbar smoke failed: ${JSON.stringify(record)}` };
  }

  return { ok: true };
}

async function runChromeStyleRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Chrome smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Chrome smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLSelectElement
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native value setter was available.");
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const readChromeState = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        const page = iframe.contentDocument.querySelector('[data-slot="page"]');
        const footer = iframe.contentDocument.querySelector('[data-slot="footer"]');
        return {
          footerExists: footer !== null,
          footerText: footer?.textContent?.trim() ?? "",
          pageStyle: page?.getAttribute("style") ?? "",
          pageText: page?.textContent?.trim() ?? ""
        };
      };

      window.confirm = () => true;
      await delay(1200);
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      await clickAction("card-design-tab");

      const templateInput = await waitFor('[data-smoke-role="chrome-page-template"]');
      const colorInput = await waitFor('[data-smoke-role="chrome-page-color"]');
      const offsetInput = await waitFor('[data-smoke-role="chrome-page-offset-y"]');
      const footerVisibleInput = await waitFor('[data-smoke-role="chrome-footer-visible"]');
      if (
        !(templateInput instanceof HTMLSelectElement) ||
        !(colorInput instanceof HTMLInputElement) ||
        !(offsetInput instanceof HTMLInputElement) ||
        !(footerVisibleInput instanceof HTMLInputElement)
      ) {
        throw new Error("Chrome smoke controls were not input elements.");
      }

      setNativeValue(templateInput, "{n2} / {total}");
      setNativeValue(colorInput, "#123456");
      setNativeValue(offsetInput, 10);
      if (footerVisibleInput.checked) {
        footerVisibleInput.click();
      }

      await waitUntil(
        () => {
          const state = readChromeState();
          return (
            state.pageText === "01 / 10" &&
            state.pageStyle.includes("color: #123456") &&
            state.pageStyle.includes("translate(0px, 10px)") &&
            state.footerExists === false
          );
        },
        () => "Chrome preview did not update: " + JSON.stringify(readChromeState())
      );

      const evidence = {
        controls: {
          footerVisible: footerVisibleInput.checked,
          offset: offsetInput.value,
          template: templateInput.value
        },
        preview: readChromeState()
      };
      const pre = document.createElement("pre");
      pre.id = "chrome-style-regression-result";
      pre.textContent = "CHROME_STYLE_REGRESSION_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);

      const generate = await waitFor('[data-smoke-action="generate"]');
      if (!(generate instanceof HTMLButtonElement)) {
        throw new Error("Chrome smoke render button was not available.");
      }
      generate.click();
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Chrome style smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const preview = record["preview"] as Record<string, unknown> | undefined;
  const controls = record["controls"] as Record<string, unknown> | undefined;
  const pageStyle = typeof preview?.["pageStyle"] === "string" ? preview["pageStyle"] : "";
  const failed =
    preview?.["pageText"] !== "01 / 10" ||
    !pageStyle.includes("color: #123456") ||
    !pageStyle.includes("translate(0px, 10px)") ||
    preview?.["footerExists"] !== false ||
    controls?.["template"] !== "{n2} / {total}" ||
    controls?.["offset"] !== "10" ||
    controls?.["footerVisible"] !== false;

  if (failed) {
    return { ok: false, message: `Chrome style smoke failed: ${JSON.stringify(record)}` };
  }

  await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
  const savedDeck = await loadDeck(storageRoot(), currentDeckId);
  if (isCardnewsError(savedDeck)) {
    return savedDeck;
  }
  const savedChrome = savedDeck.chrome;
  if (!savedChrome) {
    return { ok: false, message: "Saved deck chrome was missing." };
  }
  if (
    savedChrome.pageNumber.template !== "{n2} / {total}" ||
    savedChrome.pageNumber.color !== "#123456" ||
    savedChrome.pageNumber.offsetY !== 10 ||
    savedChrome.footer.visible !== false
  ) {
    return { ok: false, message: `Saved deck chrome was not updated: ${JSON.stringify(savedChrome)}` };
  }
  return await readRenderSmokeResult(mainWindow);
}

async function runContentFormRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Content form smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Content form smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native value setter was available.");
        }
        setter.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const readPreview = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        const title = iframe.contentDocument.querySelector('[data-slot="title"]');
        const styleText = iframe.contentDocument.querySelector("style")?.textContent ?? "";
        const raw = document.querySelector('[data-smoke-role="raw-card-input"]');
        return {
          rawValue: raw instanceof HTMLTextAreaElement ? raw.value : "",
          styleText,
          titleHtml: title?.innerHTML ?? "",
          titleText: title?.textContent ?? ""
        };
      };

      window.confirm = () => true;
      await delay(1200);
      await clickAction("reset-workspace");
      await clickAction("inspector-content");

      const titleInput = await waitFor('[data-smoke-role="content-title"]');
      if (!(titleInput instanceof HTMLTextAreaElement)) {
        throw new Error("Content title field was not a textarea.");
      }
      setNativeValue(titleInput, "첫 줄\\n둘째 줄");

      const rawDetails = document.querySelector(".raw-editor");
      if (rawDetails instanceof HTMLDetailsElement) {
        rawDetails.open = true;
      }

      await waitUntil(
        () => {
          const preview = readPreview();
          return (
            preview.rawValue.includes("제목: 첫 줄|둘째 줄") &&
            (preview.titleHtml.includes("첫 줄<br>둘째 줄") ||
              preview.titleHtml.includes("첫 줄<br/>둘째 줄")) &&
            preview.titleText.includes("첫 줄") &&
            preview.titleText.includes("둘째 줄")
          );
        },
        () => "Content form preview did not update: " + JSON.stringify(readPreview())
      );
      const contentPreview = readPreview();

      await clickAction("card-design-tab");
      const letterSpacing = await waitFor('[data-smoke-role="typography-letter-spacing"]');
      const lineHeight = await waitFor('[data-smoke-role="typography-line-height"]');
      if (!(letterSpacing instanceof HTMLInputElement) || !(lineHeight instanceof HTMLInputElement)) {
        throw new Error("Typography smoke controls were not range inputs.");
      }
      setNativeValue(letterSpacing, 6);
      setNativeValue(lineHeight, 130);

      await waitUntil(
        () => {
          const preview = readPreview();
          return (
            preview.styleText.includes("letter-spacing: 0.060em") &&
            preview.styleText.includes("line-height: 1.508")
          );
        },
        () => "Typography preview did not update: " + JSON.stringify(readPreview())
      );

      const evidence = {
        contentPreview,
        typographyPreview: readPreview(),
        controls: {
          letterSpacing: letterSpacing.value,
          lineHeight: lineHeight.value
        }
      };
      const pre = document.createElement("pre");
      pre.id = "content-form-regression-result";
      pre.textContent = "CONTENT_FORM_REGRESSION_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);

      const generate = await waitFor('[data-smoke-action="generate"]');
      if (!(generate instanceof HTMLButtonElement)) {
        throw new Error("Content form smoke render button was not available.");
      }
      generate.click();
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Content form smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const controls = record["controls"] as Record<string, unknown> | undefined;
  const contentPreview = record["contentPreview"] as Record<string, unknown> | undefined;
  const typographyPreview = record["typographyPreview"] as Record<string, unknown> | undefined;
  const styleText =
    typeof typographyPreview?.["styleText"] === "string" ? typographyPreview["styleText"] : "";
  const titleHtml =
    typeof typographyPreview?.["titleHtml"] === "string" ? typographyPreview["titleHtml"] : "";
  const rawValue =
    typeof contentPreview?.["rawValue"] === "string" ? contentPreview["rawValue"] : "";
  const failed =
    controls?.["letterSpacing"] !== "6" ||
    controls?.["lineHeight"] !== "130" ||
    !rawValue.includes("제목: 첫 줄|둘째 줄") ||
    !(titleHtml.includes("첫 줄<br>둘째 줄") || titleHtml.includes("첫 줄<br/>둘째 줄")) ||
    !styleText.includes("letter-spacing: 0.060em") ||
    !styleText.includes("line-height: 1.508");

  if (failed) {
    return { ok: false, message: `Content form smoke failed: ${JSON.stringify(record)}` };
  }

  await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
  return await readRenderSmokeResult(mainWindow);
}

async function runBadgeBackgroundRemovalRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  await purgeImageLibrarySmokeFixtures(storageRoot());
  const sourceImage = nativeImage.createFromBitmap(createSmokeBadgeBitmap(), { width: 12, height: 12 });
  if (sourceImage.isEmpty()) {
    return { ok: false, message: "Badge smoke source image could not be created." };
  }

  const internal = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "badge-smoke-source.png",
    internalSmokeImageAttribution
  );
  if (isCardnewsError(internal)) {
    return { ok: false, message: internal.message };
  }
  const source = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "qa-badge-source.png",
    smokeFixtureImageAttribution
  );
  if (isCardnewsError(source)) {
    return { ok: false, message: source.message };
  }

  await reloadSmokeWindow(mainWindow);
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Badge picker smoke target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Badge picker action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const waitUntil = async (predicate, description, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(100);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };

      await waitUntil(
        () => document.querySelector('[data-smoke-workspace-ready="true"]') !== null,
        "Next hint picker smoke workspace hydration did not finish."
      );
      window.confirm = () => true;
      await clickAction("reset-workspace");
      await waitUntil(
        () => {
          const background = document.querySelector('[data-smoke-role="global-background-select"]');
          const style = document.querySelector(".topbar-style-select");
          return background instanceof HTMLSelectElement &&
            background.value === "" &&
            style instanceof HTMLSelectElement &&
            style.value === "newsprint";
        },
        () => "Next hint picker smoke reset did not settle into the default workspace: " + document.body.innerText
      );
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await clickAction("open-badge-image-picker");
      const modal = await waitFor('[data-smoke-role="image-picker-modal"]');
      const grid = await waitFor('[data-smoke-role="image-picker-grid"]');
      await waitUntil(
        () => Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).some((button) =>
          (button.textContent ?? "").includes("qa-badge-source")
        ),
        () => "Badge picker grid did not show the visible source image: " + (grid.textContent ?? "")
      );
      if ((grid.textContent ?? "").includes("badge-smoke-source")) {
        throw new Error("Badge picker leaked an internal smoke source image.");
      }
      const sourceButton = Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).find((button) =>
        (button.textContent ?? "").includes("qa-badge-source")
      );
      if (!(sourceButton instanceof HTMLButtonElement)) {
        throw new Error("Badge source thumbnail button was not found.");
      }
      sourceButton.click();
      await waitFor('[data-smoke-role="image-picker-selected-preview"]');
      await clickAction("image-picker-remove-background");
      await waitUntil(
        () => (modal.textContent ?? "").includes("no-bg"),
        () => "Badge picker did not add a background-removed image: " + (modal.textContent ?? ""),
        12000
      );
      const noBgButton = Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).find((button) =>
        (button.textContent ?? "").includes("no-bg")
      );
      if (!(noBgButton instanceof HTMLButtonElement)) {
        throw new Error("Background-removed thumbnail button was not found.");
      }
      const noBgImageId = noBgButton.getAttribute("data-smoke-image-id");
      if (!noBgImageId) {
        throw new Error("Background-removed thumbnail did not expose an image id.");
      }
      noBgButton.click();
      await clickAction("image-picker-apply");
      await waitFor('[data-smoke-role="badge-image-preview"]');
      await clickAction("generate");
      await waitUntil(
        () => document.body.innerText.includes("렌더 완료:"),
        () => "Badge picker smoke render did not complete: " + document.body.innerText,
        30000
      );
      const evidence = {
        modalOpened: modal instanceof HTMLElement,
        gridCount: grid.querySelectorAll('[data-smoke-action="image-picker-select"]').length,
        noBgImageId,
        previewShown: Boolean(document.querySelector('[data-smoke-role="badge-image-preview"]'))
      };
      const pre = document.createElement("pre");
      pre.id = "badge-background-removal-regression-result";
      pre.textContent = "BADGE_BACKGROUND_REMOVAL_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Badge background removal smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const noBgImageId = typeof record["noBgImageId"] === "string" ? record["noBgImageId"] : "";
  if (record["modalOpened"] !== true || record["previewShown"] !== true || noBgImageId.length === 0) {
    return { ok: false, message: `Badge image picker UI did not complete: ${JSON.stringify(record)}` };
  }

  const outputDir = await findLatestRenderOutputDirectory();
  if (!outputDir) {
    return { ok: false, message: "Badge background removal smoke did not produce a render output directory." };
  }

  const html = await fs.readFile(path.join(outputDir, "card-01.html"), "utf8");
  if (!html.includes('class="badge-image"') || !html.includes('data-slot="badge-image"')) {
    return { ok: false, message: "Rendered HTML did not contain the image badge metric slot." };
  }
  if (!html.includes(noBgImageId)) {
    return { ok: false, message: "Rendered HTML did not use the processed background-removed image." };
  }

  const pngStat = await fs.stat(path.join(outputDir, "card-01.png"));
  if (!pngStat.isFile() || pngStat.size === 0) {
    return { ok: false, message: "Rendered badge smoke PNG was missing or empty." };
  }

  await purgeImageLibrarySmokeFixtures(storageRoot());
  return { ok: true };
}

async function runNextHintImageRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  await purgeImageLibrarySmokeFixtures(storageRoot());
  const sourceImage = nativeImage.createFromBitmap(createSmokeBadgeBitmap(), { width: 12, height: 12 });
  if (sourceImage.isEmpty()) {
    return { ok: false, message: "Next hint smoke source image could not be created." };
  }

  const internal = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "next-hint-smoke.png",
    internalSmokeImageAttribution
  );
  if (isCardnewsError(internal)) {
    return { ok: false, message: internal.message };
  }
  const source = await saveImageBufferToLibrary(
    storageRoot(),
    sourceImage.toPNG(),
    "qa-next-hint-source.png",
    smokeFixtureImageAttribution
  );
  if (isCardnewsError(source)) {
    return { ok: false, message: source.message };
  }

  await reloadSmokeWindow(mainWindow);
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Next hint picker smoke target was not found: " + selector);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Next hint picker action is not a button: " + action);
        }
        button.click();
        await delay(180);
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
      const waitUntil = async (predicate, description, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(100);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };

      window.confirm = () => true;
      await clickAction("reset-workspace");
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      const nextHintKind = await waitFor('[data-smoke-role="next-hint-kind"]');
      if (!(nextHintKind instanceof HTMLSelectElement)) {
        throw new Error("Next hint kind select was not found.");
      }
      setNativeValue(nextHintKind, "image");
      await clickAction("open-next-hint-image-picker");
      const grid = await waitFor('[data-smoke-role="image-picker-grid"]');
      await waitUntil(
        () => Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).some((button) =>
          (button.textContent ?? "").includes("qa-next-hint-source")
        ),
        () => "Next hint picker grid did not show the visible source image: " + (grid.textContent ?? "")
      );
      if ((grid.textContent ?? "").includes("next-hint-smoke")) {
        throw new Error("Next hint picker leaked an internal smoke source image.");
      }
      const sourceButton = Array.from(grid.querySelectorAll('[data-smoke-action="image-picker-select"]')).find((button) =>
        (button.textContent ?? "").includes("qa-next-hint-source")
      );
      if (!(sourceButton instanceof HTMLButtonElement)) {
        throw new Error("Next hint source thumbnail button was not found.");
      }
      const selectedImageId = sourceButton.getAttribute("data-smoke-image-id");
      if (!selectedImageId) {
        throw new Error("Next hint thumbnail did not expose an image id.");
      }
      sourceButton.click();
      await waitFor('[data-smoke-role="image-picker-selected-preview"]');
      await clickAction("image-picker-apply");
      await waitFor('[data-smoke-role="next-hint-image-preview"]');
      const heightInput = await waitFor('[data-smoke-role="next-hint-height"]');
      if (!(heightInput instanceof HTMLInputElement)) {
        throw new Error("Next hint height slider was not found.");
      }
      setNativeValue(heightInput, "44");
      await clickAction("generate");
      await waitUntil(
        () => document.body.innerText.includes("렌더 완료:"),
        () => "Next hint image smoke render did not complete: " + document.body.innerText,
        30000
      );
      const evidence = {
        gridCount: grid.querySelectorAll('[data-smoke-action="image-picker-select"]').length,
        selectedImageId,
        previewShown: Boolean(document.querySelector('[data-smoke-role="next-hint-image-preview"]')
        )
      };
      const pre = document.createElement("pre");
      pre.id = "next-hint-image-regression-result";
      pre.textContent = "NEXT_HINT_IMAGE_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Next hint image smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const selectedImageId = typeof record["selectedImageId"] === "string" ? record["selectedImageId"] : "";
  if (record["previewShown"] !== true || selectedImageId.length === 0) {
    return { ok: false, message: `Next hint image picker UI did not complete: ${JSON.stringify(record)}` };
  }
  const outputDir = await findLatestRenderOutputDirectory();
  if (!outputDir) {
    return { ok: false, message: "Next hint image smoke did not produce a render output directory." };
  }

  const firstHtml = await fs.readFile(path.join(outputDir, "card-01.html"), "utf8");
  const lastHtml = await fs.readFile(path.join(outputDir, "card-10.html"), "utf8");
  if (!firstHtml.includes('class="next-hint-image"') || !firstHtml.includes('data-slot="next-hint-image"')) {
    return { ok: false, message: "First card did not render next hint image slot." };
  }
  if (!firstHtml.includes(selectedImageId) || !firstHtml.includes("height: 44px")) {
    return { ok: false, message: "First card did not use the configured next hint image and height." };
  }
  if (lastHtml.includes("next-hint") || lastHtml.includes("■")) {
    return { ok: false, message: "Last card still rendered a next hint marker." };
  }

  const pngStat = await fs.stat(path.join(outputDir, "card-01.png"));
  if (!pngStat.isFile() || pngStat.size === 0) {
    return { ok: false, message: "Rendered next hint PNG was missing or empty." };
  }

  await purgeImageLibrarySmokeFixtures(storageRoot());
  return { ok: true };
}

function createSmokeBadgeBitmap(): Buffer {
  const width = 12;
  const height = 12;
  const bitmap = Buffer.alloc(width * height * 4, 255);
  for (let y = 3; y <= 8; y += 1) {
    for (let x = 3; x <= 8; x += 1) {
      const offset = (y * width + x) * 4;
      bitmap[offset] = 0;
      bitmap[offset + 1] = 0;
      bitmap[offset + 2] = 0;
      bitmap[offset + 3] = 255;
    }
  }
  const holeOffset = (6 * width + 6) * 4;
  bitmap[holeOffset] = 255;
  bitmap[holeOffset + 1] = 255;
  bitmap[holeOffset + 2] = 255;
  bitmap[holeOffset + 3] = 255;
  return bitmap;
}

async function runLayerControlsRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("Layer controls smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(80);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("Layer controls smoke action is not a button: " + action);
        }
        button.click();
        await delay(150);
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
      const readIframeLayerStyle = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        const iframeDocument = iframe.contentDocument;
        const textLayer = iframe.contentDocument.querySelector(".layer-text");
        if (!textLayer || !("style" in textLayer)) {
          return null;
        }
        const article = iframeDocument.querySelector("article.card");
        if (!article || !("style" in article)) {
          throw new Error("Preview article was not rendered.");
        }
        const badge = iframeDocument.querySelector(".badge");
        const title = iframeDocument.querySelector("h1");
        const footer = iframeDocument.querySelector('[data-slot="footer"]');
        const badgeTitleGap =
          badge && title
            ? Math.round((title.getBoundingClientRect().top - badge.getBoundingClientRect().bottom) * 100) / 100
            : null;
        const lineLayer = iframeDocument.querySelector(".layer-line");
        const computedStyle = iframe.contentWindow?.getComputedStyle(textLayer);
        const lineStyle = lineLayer && iframe.contentWindow ? iframe.contentWindow.getComputedStyle(lineLayer) : null;
        const titleStyle = title && iframe.contentWindow ? iframe.contentWindow.getComputedStyle(title) : null;
        return {
          badgeScale: article.style.getPropertyValue("--gap-badge-scale").trim(),
          badgeTitleGap,
          fontSize: computedStyle?.fontSize ?? "",
          fontWeight: computedStyle?.fontWeight ?? "",
          footerText: footer?.textContent?.trim() ?? "",
          hasBadge: Boolean(badge),
          iframeTitle: title?.textContent ?? "",
          lineStyleAttribute: lineLayer?.getAttribute("style") ?? "",
          lineLayerCount: iframeDocument.querySelectorAll(".layer-line").length,
          lineTransform: lineStyle?.transform ?? "",
          srcDocHasLine: iframe.srcdoc.includes("layer-line"),
          styleAttribute: textLayer.getAttribute("style") ?? "",
          textAlign: computedStyle?.textAlign ?? "",
          titleColor: titleStyle?.color ?? ""
        };
      };
      const readIframeFooterText = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        return iframe.contentDocument.querySelector('[data-slot="footer"]')?.textContent?.trim() ?? "";
      };
      const layerDiagnostics = (lastTextStyle = null) => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        const iframeDocument = iframe instanceof HTMLIFrameElement ? iframe.contentDocument : null;
        return {
          iframeHasLayerInSrcDoc: iframe instanceof HTMLIFrameElement ? iframe.srcdoc.includes("layer-text") : false,
          iframeTextLayerCount: iframeDocument ? iframeDocument.querySelectorAll(".layer-text").length : -1,
          lastTextStyle,
          overlayLayerCount: document.querySelectorAll('[data-smoke-role="layer-box"]').length,
          selectedPanelText: document.querySelector('[data-smoke-role="text-layer-panel"]')?.textContent ?? ""
        };
      };

      window.confirm = () => true;
      await delay(1200);
      await clickAction("reset-workspace");
      await delay(350);
      const threadsLink = await waitFor('[data-smoke-role="threads-link"]');
      const kakaoLink = await waitFor('[data-smoke-role="kakao-inquiry-link"]');
      const threadsLinkText = threadsLink.textContent?.trim() ?? "";
      const kakaoLinkText = kakaoLink.textContent?.trim() ?? "";
      const mentionInput = document.querySelector('[data-smoke-role="footer-input"], [data-smoke-role="mention-input"]');
      if (!(mentionInput instanceof HTMLInputElement)) {
        throw new Error("Footer input was not found.");
      }
      const defaultMentionValue = mentionInput.value;
      setNativeValue(mentionInput, "@");
      await waitUntil(
        () => readIframeFooterText() === "kkongdon_story",
        () => "Preview footer did not normalize @ mention: " + readIframeFooterText()
      );
      const normalizedPreviewFooter = readIframeFooterText();
      const styleSelect = await waitFor(".topbar-style-select");
      if (!(styleSelect instanceof HTMLSelectElement)) {
        throw new Error("Style select was not found.");
      }
      const expectedStyleNames = [
        "웜 스튜디오 (사진)",
        "볼드 옐로우 캐러셀 (사진)",
        "오렌지 체크 카드",
        "블루 체크 리스트",
        "솔로프리너 블랙 (사진)"
      ];
      const styleOptionTexts = Array.from(styleSelect.options).map((option) => option.textContent?.trim() ?? "");
      const missingStyleNames = expectedStyleNames.filter(
        (name) => !styleOptionTexts.some((text) => text.includes(name))
      );
      const selectedThumb = await waitFor(".slide-thumb.active");
      const selectedThumbCanvas = selectedThumb.querySelector(".thumb-canvas");
      if (!(selectedThumb instanceof HTMLElement) || !(selectedThumbCanvas instanceof HTMLElement)) {
        throw new Error("Selected thumbnail was not available.");
      }
      const thumbRect = selectedThumb.getBoundingClientRect();
      const thumbCanvasRect = selectedThumbCanvas.getBoundingClientRect();
      const thumbnailCenterDelta =
        Math.round(
          (((thumbCanvasRect.left + thumbCanvasRect.right) / 2 - (thumbRect.left + thumbRect.right) / 2) * 100)
        ) / 100;
      await clickAction("reset-workspace");
      await delay(350);
      if (!document.querySelector(".edit-overlay")) {
        await clickAction("toggle-edit-mode");
      }
      await clickAction("inspector-content");
      await clickAction("card-design-tab");
      await clickAction("add-text-layer");

      let box = await waitFor('[data-smoke-role="layer-box"]');
      const overlay = await waitFor(".edit-overlay");
      const toolbarTarget = await waitFor('[data-smoke-role="floating-editor-toolbar"] [data-toolbar-target="text-layer"]');
      if (!(toolbarTarget instanceof HTMLElement)) {
        throw new Error("Floating editor toolbar did not target the selected text layer.");
      }
      const toolbarColorInput = toolbarTarget.querySelector('input[type="color"]');
      if (!(toolbarColorInput instanceof HTMLInputElement)) {
        throw new Error("Floating editor toolbar color input was not available.");
      }
      const typographyColorControl = await waitFor('[data-smoke-role="typography-color-control"]');
      const typographyColorInput = typographyColorControl.querySelector('input[type="color"]');
      if (!(typographyColorInput instanceof HTMLInputElement)) {
        throw new Error("Typography color control input was not available.");
      }
      setNativeValue(typographyColorInput, "#123456");
      await waitUntil(
        () => readIframeLayerStyle()?.titleColor === "rgb(18, 52, 86)",
        () => "Typography color did not reach preview title: " + JSON.stringify(readIframeLayerStyle())
      );
      const titleColorAfterTypography = readIframeLayerStyle()?.titleColor ?? "";
      setNativeValue(toolbarColorInput, "#336699");
      await waitUntil(
        () => readIframeLayerStyle()?.styleAttribute.includes("#336699") === true,
        () => "Floating toolbar text color did not reach preview layer: " + JSON.stringify(readIframeLayerStyle())
      );
      const toolbarTextStyle = readIframeLayerStyle();
      const overlayText = overlay.innerText;
      const noOverlayTextDuplicate = !overlayText.includes("텍스트 입력");

      const before = box.getBoundingClientRect();
      const startX = before.left + Math.min(24, Math.max(8, before.width / 2));
      const startY = before.top + Math.min(24, Math.max(8, before.height / 2));
      box.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 71,
        clientX: startX,
        clientY: startY,
        buttons: 1
      }));
      const dragDeltaY = 150;
      overlay.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 71,
        clientX: startX + 10,
        clientY: startY + dragDeltaY,
        buttons: 1,
        shiftKey: true
      }));
      overlay.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 71,
        clientX: startX + 10,
        clientY: startY + dragDeltaY,
        buttons: 0
      }));
      await delay(250);

      const fontSizeInput = await waitFor('[data-smoke-role="text-layer-font-size"]');
      const fontWeightInput = await waitFor('[data-smoke-role="text-layer-font-weight"]');
      const alignSelect = await waitFor('[data-smoke-role="text-layer-align"]');
      if (
        !(fontSizeInput instanceof HTMLInputElement) ||
        !(fontWeightInput instanceof HTMLInputElement) ||
        !(alignSelect instanceof HTMLSelectElement)
      ) {
        throw new Error("Text layer controls were not typed inputs/selects.");
      }
      setNativeValue(fontSizeInput, 80);
      setNativeValue(fontWeightInput, 80000);
      setNativeValue(alignSelect, "right");
      await waitUntil(
        () => fontSizeInput.value === "80" && fontWeightInput.value === "950" && alignSelect.value === "right",
        "Text layer controls did not clamp/update."
      );
      let lastTextStyle = null;
      await waitUntil(
        () => {
          lastTextStyle = readIframeLayerStyle();
          return lastTextStyle?.fontSize === "80px" && lastTextStyle.fontWeight === "950" && lastTextStyle.textAlign === "right";
        },
        () => "Text layer preview style did not update: " + JSON.stringify(layerDiagnostics(lastTextStyle))
      );
      const textStyle = readIframeLayerStyle();
      if (!textStyle) {
        throw new Error("Text layer was not rendered inside preview iframe.");
      }

      await clickAction("inspector-content");
      box = await waitFor('[data-smoke-role="layer-box"]');
      const activeBefore = document.querySelector('[data-smoke-action="inspector-content"]')?.classList.contains("active") === true;
      const clickPoint = box.getBoundingClientRect();
      box.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 72,
        clientX: clickPoint.left + 10,
        clientY: clickPoint.top + 10,
        buttons: 1
      }));
      overlay.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 72,
        clientX: clickPoint.left + 10,
        clientY: clickPoint.top + 10,
        buttons: 0
      }));
      await delay(150);
      const contentTabStillActive =
        activeBefore &&
        document.querySelector('[data-smoke-action="inspector-content"]')?.classList.contains("active") === true;

      await clickAction("card-design-tab");
      await clickAction("add-shape-layer");
      const shapeControls = await waitFor('[data-smoke-role="shape-layer-controls"]');
      const shapeLabelText = shapeControls.textContent ?? "";
      await clickAction("add-line-layer");
      const lineControls = await waitFor('[data-smoke-role="line-layer-controls"]');
      const lineLabelText = lineControls.textContent ?? "";
      const noShapeControlsForLine = document.querySelector('[data-smoke-role="shape-layer-controls"]') === null;
      const lineRotationInput = await waitFor('[data-smoke-role="line-rotation"]');
      if (!(lineRotationInput instanceof HTMLInputElement)) {
        throw new Error("Line rotation control was not an input.");
      }
      setNativeValue(lineRotationInput, 90);
      await waitUntil(() => lineRotationInput.value === "90", "Line rotation input did not update.");
      await waitUntil(
        () => readIframeLayerStyle()?.lineStyleAttribute.includes("rotate(90deg)") === true,
        () => "Line preview style did not rotate: " + JSON.stringify(readIframeLayerStyle())
      );
      const selectedLineOverlay = document.querySelector(".edit-line-hit.selected");
      if (!(selectedLineOverlay instanceof HTMLElement)) {
        throw new Error("Selected line overlay was not found.");
      }
      const lineOverlayTransform = window.getComputedStyle(selectedLineOverlay).transform;
      const lineEndpointCount = document.querySelectorAll(".line-endpoint-handle").length;
      const rotatedLineStyle = readIframeLayerStyle();

      const badgeSlider = await waitFor('[data-smoke-role="badge-gap-slider"]');
      if (!(badgeSlider instanceof HTMLInputElement)) {
        throw new Error("Badge gap slider was not an input.");
      }
      setNativeValue(badgeSlider, 50);
      await waitUntil(() => badgeSlider.value === "50", "Badge gap slider did not reach minimum test value.");
      await waitUntil(() => readIframeLayerStyle()?.badgeScale === "0.500", "Badge gap minimum preview style did not update.");
      const badgeGapBefore = readIframeLayerStyle()?.badgeTitleGap;
      setNativeValue(badgeSlider, 180);
      await waitUntil(() => badgeSlider.value === "180", "Badge gap slider did not update.");
      await waitUntil(() => readIframeLayerStyle()?.badgeScale === "1.800", "Badge gap preview style did not update.");
      const badgeStyle = readIframeLayerStyle();
      if (!badgeStyle) {
        throw new Error("Text layer disappeared from preview iframe.");
      }
      const badgeGapAfter = badgeStyle.badgeTitleGap;

      const evidence = {
        badgeScale: badgeStyle.badgeScale,
        badgeTitleGapAfter: badgeGapAfter,
        badgeTitleGapBefore: badgeGapBefore,
        badgeTitleGapDelta:
          typeof badgeGapBefore === "number" && typeof badgeGapAfter === "number"
            ? Math.round((badgeGapAfter - badgeGapBefore) * 100) / 100
            : null,
        contentTabStillActive,
        defaultMentionValue,
        fontWeightInputValue: fontWeightInput.value,
        kakaoLinkText,
        lineLabelText,
        lineEndpointCount,
        lineOverlayTransform,
        lineRotationInputValue: lineRotationInput.value,
        lineStyleAttribute: rotatedLineStyle?.lineStyleAttribute ?? "",
        missingStyleNames,
        noOverlayTextDuplicate,
        noShapeControlsForLine,
        shapeLabelText,
        styleOptionTexts,
        titleColorAfterTypography,
        thumbnailCenterDelta,
        toolbarTextColorApplied: toolbarTextStyle?.styleAttribute.includes("#336699") === true,
        toolbarTextTargetVisible: Boolean(toolbarTarget),
        threadsLinkText,
        normalizedPreviewFooter,
        textStyle
      };
      const pre = document.createElement("pre");
      pre.id = "layer-controls-regression-result";
      pre.textContent = "LAYER_CONTROLS_REGRESSION_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);

      const generate = await waitFor('[data-smoke-action="generate"]');
      if (!(generate instanceof HTMLButtonElement)) {
        throw new Error("Layer controls render button was not available.");
      }
      generate.click();
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Layer controls smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const textStyle = record["textStyle"] as Record<string, unknown> | undefined;
  const lineLabelText = typeof record["lineLabelText"] === "string" ? record["lineLabelText"] : "";
  const shapeLabelText = typeof record["shapeLabelText"] === "string" ? record["shapeLabelText"] : "";
  const badgeTitleGapBefore = typeof record["badgeTitleGapBefore"] === "number" ? record["badgeTitleGapBefore"] : null;
  const badgeTitleGapAfter = typeof record["badgeTitleGapAfter"] === "number" ? record["badgeTitleGapAfter"] : null;
  const lineStyleAttribute = typeof record["lineStyleAttribute"] === "string" ? record["lineStyleAttribute"] : "";
  const missingStyleNames = Array.isArray(record["missingStyleNames"])
    ? record["missingStyleNames"]
    : ["style smoke result missing"];
  const thumbnailCenterDelta =
    typeof record["thumbnailCenterDelta"] === "number" ? record["thumbnailCenterDelta"] : Number.POSITIVE_INFINITY;
  const lineOverlayTransform =
    typeof record["lineOverlayTransform"] === "string" ? record["lineOverlayTransform"] : "";
  const lineEndpointCount =
    typeof record["lineEndpointCount"] === "number" ? record["lineEndpointCount"] : 0;
  const failed =
    record["noOverlayTextDuplicate"] !== true ||
    record["contentTabStillActive"] !== true ||
    record["defaultMentionValue"] !== "kkongdon_story" ||
    record["normalizedPreviewFooter"] !== "kkongdon_story" ||
    missingStyleNames.length > 0 ||
    Math.abs(thumbnailCenterDelta) > 2 ||
    record["fontWeightInputValue"] !== "950" ||
    textStyle?.["fontSize"] !== "80px" ||
    textStyle?.["fontWeight"] !== "950" ||
    textStyle?.["textAlign"] !== "right" ||
    record["titleColorAfterTypography"] !== "rgb(18, 52, 86)" ||
    record["toolbarTextTargetVisible"] !== true ||
    record["toolbarTextColorApplied"] !== true ||
    record["noShapeControlsForLine"] !== true ||
    !shapeLabelText.includes("도형 색상") ||
    !lineLabelText.includes("선 색상") ||
    !lineLabelText.includes("선 두께") ||
    !lineLabelText.includes("각도") ||
    lineEndpointCount !== 2 ||
    record["lineRotationInputValue"] !== "90" ||
    !lineStyleAttribute.includes("rotate(90deg)") ||
    record["badgeScale"] !== "1.800";
  const badgeGapFailed =
    badgeTitleGapBefore === null || badgeTitleGapAfter === null || badgeTitleGapAfter <= badgeTitleGapBefore + 30;
  const linkFailed = record["threadsLinkText"] !== "@" || record["kakaoLinkText"] !== "AX문의/강의 문의";

  if (failed || badgeGapFailed || linkFailed) {
    return { ok: false, message: `Layer controls smoke failed: ${JSON.stringify(record)}` };
  }

  await waitForSmokeText(mainWindow, ["렌더 완료:", "렌더 실패", "게이트 실패"]);
  const savedDeck = await loadDeck(storageRoot(), currentDeckId);
  if (isCardnewsError(savedDeck)) {
    return savedDeck;
  }
  if (savedDeck.footerAccount !== "kkongdon_story") {
    return { ok: false, message: `Saved deck footer was not normalized: ${savedDeck.footerAccount}` };
  }
  return await readRenderSmokeResult(mainWindow);
}

async function runLineEndpointRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = (selector, timeout = 8000) =>
        new Promise((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            const element = document.querySelector(selector);
            if (element) {
              resolve(element);
              return;
            }
            if (Date.now() - started > timeout) {
              reject(new Error("Timed out waiting for " + selector));
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        });
      const waitUntil = (predicate, message, timeout = 8000) =>
        new Promise((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            if (predicate()) {
              resolve(true);
              return;
            }
            if (Date.now() - started > timeout) {
              reject(new Error(typeof message === "function" ? message() : message));
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        });
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(action + " was not a button.");
        }
        button.click();
        await delay(150);
      };
      const readLineStyle = () => {
        const iframe = document.querySelector(".stage .stage-canvas iframe");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentDocument) {
          throw new Error("Preview iframe was not readable.");
        }
        return iframe.contentDocument.querySelector(".layer-line")?.getAttribute("style") ?? "";
      };

      window.confirm = () => true;
      await delay(1200);
      await clickAction("reset-workspace");
      const editToggle = await waitFor('[data-smoke-action="toggle-edit-mode"]');
      if (editToggle instanceof HTMLButtonElement && !editToggle.classList.contains("active")) {
        editToggle.click();
        await delay(150);
      }
      await clickAction("card-design-tab");
      await clickAction("add-line-layer");

      const body = await waitFor(".edit-line-hit.selected");
      const endpointStart = await waitFor('[data-smoke-role="line-endpoint-start"]');
      const endpointEnd = await waitFor('[data-smoke-role="line-endpoint-end"]');
      const overlay = await waitFor(".edit-overlay");
      if (
        !(body instanceof HTMLElement) ||
        !(endpointStart instanceof HTMLElement) ||
        !(endpointEnd instanceof HTMLElement) ||
        !(overlay instanceof HTMLElement)
      ) {
        throw new Error("Line endpoint controls were not HTMLElement instances.");
      }

      const noLegacyBBox = document.querySelector(".edit-layer-line") === null;
      const endpointCountBefore = document.querySelectorAll(".line-endpoint-handle").length;
      const beforeStyle = readLineStyle();
      const beforeEndRect = endpointEnd.getBoundingClientRect();
      endpointEnd.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 91,
        clientX: beforeEndRect.left + beforeEndRect.width / 2,
        clientY: beforeEndRect.top + beforeEndRect.height / 2,
        buttons: 1
      }));
      overlay.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 91,
        clientX: beforeEndRect.left + beforeEndRect.width / 2 + 96,
        clientY: beforeEndRect.top + beforeEndRect.height / 2 - 80,
        buttons: 1
      }));
      overlay.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 91,
        clientX: beforeEndRect.left + beforeEndRect.width / 2 + 96,
        clientY: beforeEndRect.top + beforeEndRect.height / 2 - 80,
        buttons: 0
      }));
      await waitUntil(
        () => readLineStyle() !== beforeStyle,
        () => "Line iframe style did not update after endpoint drag: " + readLineStyle()
      );
      const afterEndRect = endpointEnd.getBoundingClientRect();
      const afterStyle = readLineStyle();
      const endpointMoved =
        Math.abs(afterEndRect.left - beforeEndRect.left) > 8 ||
        Math.abs(afterEndRect.top - beforeEndRect.top) > 8;
      const endpointCountAfter = document.querySelectorAll(".line-endpoint-handle").length;
      const evidence = {
        afterStyle,
        beforeStyle,
        endpointCountAfter,
        endpointCountBefore,
        endpointMoved,
        noLegacyBBox,
        styleChanged: afterStyle !== beforeStyle
      };
      const pre = document.createElement("pre");
      pre.id = "line-endpoint-regression-result";
      pre.textContent = "LINE_ENDPOINT_REGRESSION_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Line endpoint smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  if (
    record["noLegacyBBox"] !== true ||
    record["endpointMoved"] !== true ||
    record["styleChanged"] !== true ||
    record["endpointCountBefore"] !== 2 ||
    record["endpointCountAfter"] !== 2
  ) {
    return { ok: false, message: `Line endpoint smoke failed: ${JSON.stringify(record)}` };
  }

  return { ok: true };
}

async function clickSmokeButton(mainWindow: BrowserWindow, action: string): Promise<void> {
  const serializedAction = JSON.stringify(action);
  await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const selector = '[data-smoke-action="' + ${serializedAction} + '"]';
        const button = document.querySelector(selector);
        if (button instanceof HTMLButtonElement) {
          button.click();
          resolve(true);
          return;
        }
        if (Date.now() - started > 8000) {
          const actions = Array.from(document.querySelectorAll("[data-smoke-action]"))
            .map((element) => element.getAttribute("data-smoke-action"))
            .join(", ");
          reject(new Error("Smoke button was not found: " + ${serializedAction} + " / available: " + actions));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
}

async function reloadSmokeWindow(mainWindow: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      mainWindow.webContents.removeListener("did-finish-load", handleLoad);
      reject(new Error("Timed out waiting for smoke reload."));
    }, 10000);
    const handleLoad = (): void => {
      clearTimeout(timeout);
      resolve();
    };
    mainWindow.webContents.once("did-finish-load", handleLoad);
    mainWindow.webContents.reload();
  });
}

async function waitForSmokeText(
  mainWindow: BrowserWindow,
  expectedTexts: readonly string[]
): Promise<void> {
  const serializedTexts = JSON.stringify(expectedTexts);
  await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const expectedTexts = ${serializedTexts};
      const started = Date.now();
      const tick = () => {
        const bodyText = document.body.innerText;
        if (expectedTexts.some((expectedText) => bodyText.includes(expectedText))) {
          resolve(undefined);
          return;
        }
        if (Date.now() - started > 30000) {
          reject(new Error("Timed out waiting for smoke text."));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
}

async function readParseSmokeResult(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const bodyText = String(await mainWindow.webContents.executeJavaScript("document.body.innerText"));
  if (
    bodyText.includes("파싱 완료") ||
    bodyText.includes("렌더링 중") ||
    bodyText.includes("렌더 완료:")
  ) {
    return { ok: true };
  }

  return { ok: false, message: "Parser smoke did not reach a successful parsed state." };
}

async function readRenderSmokeResult(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const bodyText = String(await mainWindow.webContents.executeJavaScript("document.body.innerText"));
  if (bodyText.includes("렌더 완료:")) {
    return { ok: true };
  }

  return { ok: false, message: "Render smoke did not reach a successful rendered state." };
}

async function findLatestRenderOutputDirectory(): Promise<string | undefined> {
  const rendersRoot = path.join(storageRoot(), "renders");
  try {
    const entries = await fs.readdir(rendersRoot, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("render-"))
        .map(async (entry) => {
          const outputDir = path.join(rendersRoot, entry.name);
          const stat = await fs.stat(outputDir);
          return { outputDir, mtimeMs: stat.mtimeMs };
        })
    );
    return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.outputDir;
  } catch {
    return undefined;
  }
}

async function readExportSmokeResult(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const bodyText = String(await mainWindow.webContents.executeJavaScript("document.body.innerText"));
  if (bodyText.includes("ZIP 저장:") && !bodyText.includes("내보내기 실패")) {
    return { ok: true };
  }

  return { ok: false, message: "Export smoke did not reach successful PNG and ZIP states." };
}

function scheduleSmokeCapture(mainWindow: BrowserWindow): void {
  runSmokeCapture(mainWindow).catch((error: unknown) => {
    if (error instanceof SmokeCaptureError) {
      console.error(error.message);
      app.exit(1);
      return;
    }

    if (error instanceof Error) {
      console.error(`Unexpected smoke capture failure: ${error.message}`);
      app.exit(1);
      return;
    }

    console.error("Unexpected smoke capture failure: non-Error rejection");
    app.exit(1);
  });
}

function createWindow(): void {
  const hasSmokeWindowSize =
    !app.isPackaged &&
    (process.env["CARDNEWS_SMOKE_VIEWPORT_WIDTH"] !== undefined ||
      process.env["CARDNEWS_SMOKE_VIEWPORT_HEIGHT"] !== undefined);
  const smokeWindowWidth = hasSmokeWindowSize
    ? parseSmokeWindowDimension("CARDNEWS_SMOKE_VIEWPORT_WIDTH", 1280)
    : 1280;
  const smokeWindowHeight = hasSmokeWindowSize
    ? parseSmokeWindowDimension("CARDNEWS_SMOKE_VIEWPORT_HEIGHT", 880)
    : 880;
  const mainWindow = new BrowserWindow({
    width: smokeWindowWidth,
    height: smokeWindowHeight,
    useContentSize: hasSmokeWindowSize,
    show: !hasSmokeWindowSize,
    paintWhenInitiallyHidden: true,
    minWidth: 1080,
    minHeight: 720,
    title: "Cardnews Studio",
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
    if (!smokeScreenshotPath && !smokeTextPath) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
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

function notImplemented(message: string): { ok: false; code: "not_implemented"; message: string } {
  return { ok: false, code: "not_implemented", message };
}

function invalidInput(message: string): { ok: false; code: "invalid_input"; message: string } {
  return { ok: false, code: "invalid_input", message };
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

async function writeDeckZip(outputDir: string, targetPath: string): Promise<void> {
  const zip = new AdmZip();
  for (const entry of await fs.readdir(outputDir)) {
    if (entry.endsWith(".png")) {
      zip.addLocalFile(path.join(outputDir, entry));
    }
  }

  zip.writeZip(targetPath);
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

let cachedBundledFont: FontData | null | undefined;

async function loadFontData(fontId?: string | null): Promise<FontData | undefined> {
  if (fontId) {
    const font = await findLibraryFont(storageRoot(), fontId);
    if (!font) {
      return undefined;
    }

    const base64 = (await fs.readFile(font.absolutePath)).toString("base64");
    return {
      base64,
      cssFamily: "Cardnews User Font",
      cssFormat: fontCssFormatForExtension(font.entry.extension),
      displayName: font.entry.displayName,
      mimeType: fontMimeTypeForExtension(font.entry.extension) ?? "application/octet-stream"
    };
  }

  if (cachedBundledFont !== undefined) {
    return cachedBundledFont ?? undefined;
  }

  try {
    const fontPath = path.join(app.getAppPath(), "fonts", "PretendardVariable.woff2");
    cachedBundledFont = {
      base64: (await fs.readFile(fontPath)).toString("base64"),
      cssFamily: "Pretendard",
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


function createRenderJobId(): string {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `render-${stamp}`;
}

function isDeckDraft(input: unknown): input is DeckDraft {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  if (!("headerLabel" in input) || typeof input.headerLabel !== "string") {
    return false;
  }

  if (!("footerAccount" in input) || typeof input.footerAccount !== "string") {
    return false;
  }

  if (!("cards" in input) || !Array.isArray(input.cards)) {
    return false;
  }

  if ("styleId" in input && input.styleId !== undefined && typeof input.styleId !== "string") {
    return false;
  }

  if (
    "accentColor" in input &&
    input.accentColor !== undefined &&
    typeof input.accentColor !== "string"
  ) {
    return false;
  }

  if (
    "backgroundDim" in input &&
    input.backgroundDim !== undefined &&
    typeof input.backgroundDim !== "number"
  ) {
    return false;
  }

  if (
    "aspectRatio" in input &&
    input.aspectRatio !== undefined &&
    typeof input.aspectRatio !== "string"
  ) {
    return false;
  }

  if (
    "backgroundId" in input &&
    input.backgroundId !== undefined &&
    typeof input.backgroundId !== "string"
  ) {
    return false;
  }

  if ("fontId" in input && input.fontId !== undefined && typeof input.fontId !== "string") {
    return false;
  }

  if ("chrome" in input && input.chrome !== undefined && !isChromeConfigCandidate(input.chrome)) {
    return false;
  }

  if ("overrides" in input && input.overrides !== undefined && !isCardOverrideMap(input.overrides)) {
    return false;
  }

  return input.cards.every(isDeckDraftCard);
}

function isChromeConfigCandidate(input: unknown): boolean {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isDeckDraftCard(input: unknown): input is DeckDraft["cards"][number] {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  return (
    "index" in input &&
    typeof input.index === "number" &&
    "rawText" in input &&
    typeof input.rawText === "string"
  );
}

function isCardOverrideMap(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  return Object.entries(input).every(([key, value]) => /^\d+$/.test(key) && isCardOverride(value));
}

function isCardOverride(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    (record["backgroundId"] === undefined ||
      record["backgroundId"] === null ||
      typeof record["backgroundId"] === "string") &&
    (record["dim"] === undefined || typeof record["dim"] === "number") &&
    (record["adjust"] === undefined || isAdjustOverride(record["adjust"])) &&
    (record["layout"] === undefined || isLayoutOverride(record["layout"])) &&
    (record["typography"] === undefined || isTypographyOverride(record["typography"])) &&
    (record["layers"] === undefined ||
      (Array.isArray(record["layers"]) && record["layers"].every(isCardLayer)))
  );
}

function isAdjustOverride(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    typeof record["brightness"] === "number" &&
    typeof record["contrast"] === "number" &&
    typeof record["saturation"] === "number"
  );
}

function isLayoutOverride(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    (record["align"] === "left" || record["align"] === "center") &&
    typeof record["offsetY"] === "number" &&
    typeof record["gapBadge"] === "number" &&
    typeof record["gapSubtitle"] === "number"
  );
}

function isTypographyOverride(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    (record["sizeScale"] === undefined || typeof record["sizeScale"] === "number") &&
    (record["weight"] === undefined || typeof record["weight"] === "number") &&
    (record["italic"] === undefined || typeof record["italic"] === "boolean")
  );
}

function isCardLayer(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  const hasCommon =
    typeof record["id"] === "string" &&
    (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
    (record["opacity"] === undefined || typeof record["opacity"] === "number");
  if (!hasCommon) {
    return false;
  }

  if (record["kind"] === "line") {
    return isEndpointLineLayer(record) || isLegacyLineLayer(record);
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

function isEndpointLineLayer(record: Record<string, unknown>): boolean {
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

function isLegacyLineLayer(record: Record<string, unknown>): boolean {
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

function isStyleProfile(input: unknown): input is StyleProfile {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  return (
    "id" in input &&
    typeof input.id === "string" &&
    "name" in input &&
    typeof input.name === "string" &&
    "palette" in input &&
    Array.isArray(input.palette) &&
    "layoutMood" in input &&
    typeof input.layoutMood === "string" &&
    "fontMood" in input &&
    typeof input.fontMood === "string" &&
    "approved" in input &&
    typeof input.approved === "boolean"
  );
}

function isStylePresetRecord(input: unknown): input is StylePresetRecord {
  return isSafeStylePresetRecord(input);
}

function isAppSettings(input: unknown): input is AppSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    (record["pixabayApiKey"] === undefined || typeof record["pixabayApiKey"] === "string") &&
    (record["aiDefaultProviderId"] === undefined || isAiProviderId(record["aiDefaultProviderId"])) &&
    (record["gptsTemplateBuilderUrl"] === undefined ||
      (typeof record["gptsTemplateBuilderUrl"] === "string" &&
        isAllowedGptsTemplateBuilderUrl(record["gptsTemplateBuilderUrl"])))
  );
}

function isAiChatMessages(input: unknown): input is readonly AiChatMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 16) {
    return false;
  }

  return input.every((message) => {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      return false;
    }
    const record = message as Record<string, unknown>;
    return (
      isAiChatRole(record["role"]) &&
      typeof record["content"] === "string" &&
      record["content"].trim().length > 0 &&
      record["content"].length <= 20_000
    );
  });
}

function isAiChatRole(input: unknown): input is AiChatMessage["role"] {
  return input === "system" || input === "user" || input === "assistant";
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

async function chooseCsvFile(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    filters: [{ extensions: ["csv"], name: "CSV" }],
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
  if (image.isEmpty()) {
    return invalidInput("이미지를 디코딩할 수 없습니다.");
  }

  return undefined;
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

  const endpoint = createPixabayApiUrl(apiKey, trimmedQuery, page);

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return externalServiceFailed(`Pixabay 응답 오류: HTTP ${response.status}`);
    }

    const parsed: unknown = await response.json();
    const images = parsePixabayImages(parsed);
    return { mode: "api", provider: "pixabay", query: trimmedQuery, images };
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
    deck,
    edition: "pro",
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

async function renderBulkCsvText(csvText: string): Promise<CardnewsResult<BulkRenderResult>> {
  if (csvText.trim().length === 0) {
    return invalidInput("CSV 내용이 비어 있습니다.");
  }

  const customStyles = await listCustomStyles(storageRoot());
  const styleIds = [...stylePresets.map((style) => style.id), ...customStyles.map((style) => style.id)];
  const parsed = parseBulkCsv(csvText, styleIds, aspectRatios.map((ratio) => ratio.id));
  if (isCardnewsError(parsed)) {
    return parsed;
  }

  const jobId = `bulk-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
  const outputDir = getRenderOutputDirectory(storageRoot(), jobId);
  await fs.mkdir(outputDir, { recursive: true });

  const rowResults: BulkRenderRowResult[] = parsed.issues.map((issue) => ({
    rowNumber: issue.rowNumber,
    outputName: `row-${issue.rowNumber}`,
    status: "failed",
    cardCount: 0,
    message: issue.message
  }));

  for (const row of parsed.rows) {
    const referenceError = await validateBulkReferences(row.deckDraft);
    if (isCardnewsError(referenceError)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        message: referenceError.message
      });
      continue;
    }

    const deck = buildDeckFromDraft(`${jobId}-${row.rowNumber}`, row.deckDraft, approvedStyleProfile);
    if (isCardnewsError(deck)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        message: deck.message
      });
      continue;
    }

    const rowOutputDir = path.join(outputDir, safeOutputName(row.outputName, row.rowNumber));
    const rendered = await renderDeckToOutput(deck, `${jobId}-${row.rowNumber}`, rowOutputDir, customStyles);
    if (isCardnewsError(rendered)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        outputDir: rowOutputDir,
        message: rendered.message
      });
      continue;
    }

    rowResults.push({
      rowNumber: row.rowNumber,
      outputName: row.outputName,
      status: "rendered",
      cardCount: rendered.cardCount,
      outputDir: rendered.outputDir
    });
  }

  rowResults.sort((first, second) => first.rowNumber - second.rowNumber);
  const renderedCount = rowResults.filter((row) => row.status === "rendered").length;
  const failedCount = rowResults.length - renderedCount;
  const zipPath = path.join(outputDir, "bulk-output.zip");
  const result: BulkRenderResult = {
    failedCount,
    jobId,
    outputDir,
    renderedCount,
    rows: rowResults,
    totalRows: rowResults.length,
    zipPath
  };

  await writeBulkReports(outputDir, result);
  const zip = new AdmZip();
  zip.addLocalFolder(outputDir);
  zip.writeZip(zipPath);

  return result;
}

async function renderTemplateBulkCsvText(
  csvText: string,
  workspace: WorkspaceState,
  metadata: BulkBindingMetadata
): Promise<CardnewsResult<BulkRenderResult>> {
  const preflight = preflightTemplateBulkCsv(csvText, metadata);
  if (isCardnewsError(preflight)) return preflight;

  const customStyles = await listCustomStyles(storageRoot());
  const jobId = `bulk-v2-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
  const outputDir = getRenderOutputDirectory(storageRoot(), jobId);
  await fs.mkdir(outputDir, { recursive: true });
  const rowResults: BulkRenderRowResult[] = [];

  for (const row of preflight.rows) {
    const materialized = materializeTemplateBulkRow(workspace, metadata, row);
    if (isCardnewsError(materialized)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        message: materialized.message
      });
      continue;
    }

    const draft = deckDraftFromWorkspace(materialized);
    const referenceError = await validateBulkReferences(draft);
    if (isCardnewsError(referenceError)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        message: referenceError.message
      });
      continue;
    }

    const deck = buildDeckFromDraft(`${jobId}-${row.rowNumber}`, draft, approvedStyleProfile);
    if (isCardnewsError(deck)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        message: deck.message
      });
      continue;
    }

    const rowOutputDir = path.join(outputDir, safeOutputName(row.outputName, row.rowNumber));
    const rendered = await renderDeckToOutput(deck, `${jobId}-${row.rowNumber}`, rowOutputDir, customStyles);
    if (isCardnewsError(rendered)) {
      rowResults.push({
        rowNumber: row.rowNumber,
        outputName: row.outputName,
        status: "failed",
        cardCount: 0,
        outputDir: rowOutputDir,
        message: rendered.message
      });
      continue;
    }

    rowResults.push({
      rowNumber: row.rowNumber,
      outputName: row.outputName,
      status: "rendered",
      cardCount: rendered.cardCount,
      outputDir: rendered.outputDir
    });
  }

  rowResults.sort((first, second) => first.rowNumber - second.rowNumber);
  const zipPath = path.join(outputDir, "bulk-output.zip");
  const result: BulkRenderResult = {
    failedCount: rowResults.filter((row) => row.status === "failed").length,
    jobId,
    outputDir,
    renderedCount: rowResults.filter((row) => row.status === "rendered").length,
    rows: rowResults,
    totalRows: rowResults.length,
    zipPath
  };
  await writeBulkReports(outputDir, result);
  const zip = new AdmZip();
  zip.addLocalFolder(outputDir);
  zip.writeZip(zipPath);
  return result;
}

async function validateBulkReferences(input: DeckDraft): Promise<CardnewsResult<void>> {
  if (input.backgroundId && !(await findLibraryBackground(storageRoot(), input.backgroundId))) {
    return invalidInput(`배경 id를 찾을 수 없습니다: ${input.backgroundId}`);
  }

  if (input.fontId && !(await findLibraryFont(storageRoot(), input.fontId))) {
    return invalidInput(`폰트 id를 찾을 수 없습니다: ${input.fontId}`);
  }

  return undefined;
}

async function writeBulkReports(outputDir: string, result: BulkRenderResult): Promise<void> {
  await fs.writeFile(path.join(outputDir, "bulk-report.json"), JSON.stringify(result, null, 2), "utf8");
  const header = "rowNumber,outputName,status,cardCount,outputDir,message";
  const rows = result.rows.map((row) =>
    [
      String(row.rowNumber),
      row.outputName,
      row.status,
      String(row.cardCount),
      row.outputDir ?? "",
      row.message ?? ""
    ]
      .map(escapeCsvValue)
      .join(",")
  );
  // BOM: Excel에서 한글 리포트가 깨지지 않도록.
  await fs.writeFile(
    path.join(outputDir, "bulk-report.csv"),
    `\uFEFF${[header, ...rows].join("\n")}`,
    "utf8"
  );
}

function safeOutputName(value: string, rowNumber: number): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-");
  return normalized.length > 0 ? normalized.slice(0, 80) : `row-${rowNumber}`;
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll("\"", "\"\"")}"`;
}

async function confirmAiProviderInstall(recipe: AiProviderInstallRecipe): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "question",
    title: "AI CLI 설치 확인",
    message: `${recipe.provider === "codex" ? "Codex CLI" : "Claude Code"}를 설치하시겠습니까?`,
    detail: [
      `설치 명령: ${recipe.command.join(" ")}`,
      `확인 명령: ${recipe.verifyCommand.join(" ")}`,
      recipe.doctorCommand ? `진단 명령: ${recipe.doctorCommand.join(" ")}` : undefined,
      `필수 조건: ${recipe.prerequisites.join(" ")}`,
      `공식 안내: ${recipe.officialUrl}`,
      "",
      "관리자 권한은 자동으로 요청하지 않습니다. 설치 과정은 별도의 터미널에 표시됩니다."
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n"),
    buttons: ["취소", "설치"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  return result.response === 1;
}

app.whenReady().then(() => {
  installMediaProtocolHandler(storageRoot);
  ipcMain.handle("cardnews:getEdition", () => ({ edition: "pro", productName: "Cardnews Studio Pro" }));
  ipcMain.handle("cardnews:requestLockedFeature", () => undefined);
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

      const copied = await copyImageToDeckAssets(
        storageRoot(),
        filePath,
        "style-reference",
        copiedImages.length + 1
      );
      if (isCardnewsError(copied)) {
        return copied;
      }

      copiedImages.push(copied);
    }

    selectedStyleReferenceImages = copiedImages;
    return copiedImages.map((image) => image.ref);
  });
  ipcMain.handle("cardnews:loadDeck", () => loadDeck(storageRoot(), currentDeckId));
  ipcMain.handle("cardnews:saveDeck", (_event, input: unknown) => {
    if (!isDeckDraft(input)) {
      return invalidInput("Deck 입력 형식이 올바르지 않습니다.");
    }

    return saveDeckDraft(storageRoot(), input, approvedStyleProfile);
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
      : styleExtractionFailed("스타일 분석을 완료하지 못했습니다. 기본 newsprint 스타일로 계속 만들 수 있습니다.")
  );
  ipcMain.handle("cardnews:approveStyle", (_event, profile: unknown) => {
    if (!isStyleProfile(profile)) {
      return invalidInput("스타일 프로필 형식이 올바르지 않습니다.");
    }

    approvedStyleProfile = { ...profile, approved: true };
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

    const jobId = createRenderJobId();
    const customStyles = await listCustomStyles(storageRoot());

    return renderDeckToOutput(
      deck,
      jobId,
      getRenderOutputDirectory(storageRoot(), jobId),
      customStyles,
    );
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
  ipcMain.handle("cardnews:importBulkCsvFile", async () => {
    const filePath = await chooseCsvFile();
    if (!filePath) {
      return invalidInput("CSV 파일 선택이 취소되었습니다.");
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 10 * 1024 * 1024) {
        return invalidInput("CSV 파일은 10MB 이하만 불러올 수 있습니다.");
      }

      const text = await fs.readFile(filePath, "utf8");
      return { fileName: path.basename(filePath), text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`CSV 파일을 읽지 못했습니다: ${message}`);
    }
  });
  ipcMain.handle("cardnews:exportBulkCsvTemplate", async (_event, content: unknown) => {
    if (typeof content !== "string" || content.length === 0) {
      return invalidInput("CSV 템플릿 내용이 비어 있습니다.");
    }

    const result = await dialog.showSaveDialog({
      defaultPath: "cardnews-bulk-template.csv",
      filters: [{ extensions: ["csv"], name: "CSV" }]
    });
    if (result.canceled || !result.filePath) {
      return invalidInput("CSV 템플릿 저장이 취소되었습니다.");
    }

    // Excel이 UTF-8 CSV를 CP949로 열어 한글이 깨지는 것을 막는 BOM.
    await fs.writeFile(result.filePath, `\uFEFF${content}`, "utf8");
    return result.filePath;
  });
  ipcMain.handle("cardnews:renderBulkCsv", (_event, csvText: unknown) => {
    if (typeof csvText !== "string") {
      return invalidInput("CSV 내용은 문자열이어야 합니다.");
    }

    return renderBulkCsvText(csvText);
  });
  ipcMain.handle(
    "cardnews:renderTemplateBulkCsv",
    (_event, csvText: unknown, workspace: unknown, metadata: unknown) => {
      if (typeof csvText !== "string") return invalidInput("CSV 내용은 문자열이어야 합니다.");
      if (!isWorkspaceState(workspace)) return invalidInput("벌크 템플릿 워크스페이스가 올바르지 않습니다.");
      if (
        !metadata ||
        typeof metadata !== "object" ||
        !("bindings" in metadata) ||
        !Array.isArray(metadata.bindings) ||
        !("templateId" in metadata) ||
        typeof metadata.templateId !== "string" ||
        !("templateRevision" in metadata) ||
        typeof metadata.templateRevision !== "number" ||
        !("schemaVersion" in metadata) ||
        metadata.schemaVersion !== 1
      ) {
        return invalidInput("벌크 바인딩 메타데이터가 올바르지 않습니다.");
      }
      const validation = validateBulkBindingMetadata(metadata as BulkBindingMetadata);
      if (isCardnewsError(validation)) return validation;
      return renderTemplateBulkCsvText(csvText, workspace, validation);
    }
  );
  ipcMain.handle("cardnews:listBackgroundLibrary", () => listBackgroundLibrary(storageRoot()));
  ipcMain.handle("cardnews:listImageLibrary", () =>
    listImageLibrary(storageRoot(), { includeSmokeFixtures: Boolean(smokeAction) })
  );
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
  ipcMain.handle("cardnews:ai:listProviders", (_event, forceRefresh: unknown) =>
    listAiProviderStatuses({ forceRefresh: forceRefresh === true })
  );
  ipcMain.handle("cardnews:ai:install", (_event, providerId: unknown, recipeId: unknown) => {
    if (
      !isAiProviderId(providerId) ||
      typeof recipeId !== "string" ||
      recipeId.length === 0 ||
      recipeId.length > 80
    ) {
      return {
        ok: false,
        outcome: "failed",
        message: "AI CLI 설치 요청 형식이 올바르지 않습니다."
      };
    }
    return installAiProviderRecipe(providerId, recipeId, {
      confirm: confirmAiProviderInstall
    });
  });
  ipcMain.handle("cardnews:ai:chat", async (_event, providerId: unknown, messages: unknown) => {
    if (!isAiProviderId(providerId)) {
      return invalidInput("AI provider는 claude, codex, gemini 중 하나여야 합니다.");
    }
    if (!isAiChatMessages(messages)) {
      return invalidInput("AI 대화 메시지 형식이 올바르지 않습니다.");
    }

    return runAiProviderChat(providerId, messages, {
      cwd: storageRoot(),
      allowMock: !app.isPackaged
    });
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
  ipcMain.handle("cardnews:listDeckPresets", () => listDeckPresets(storageRoot()));
  ipcMain.handle("cardnews:saveDeckPreset", (_event, preset: unknown) => {
    if (!isDeckPreset(preset)) {
      return invalidInput("양식 프리셋 형식이 올바르지 않습니다.");
    }

    return saveDeckPresetToStore(storageRoot(), preset);
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

    await saveWorkspaceState(storageRoot(), state);
    return undefined;
  });
  ipcMain.handle("cardnews:loadWorkspace", () => loadWorkspaceState(storageRoot()));
  ipcMain.handle("cardnews:exportCardPng", async (_event, jobId: unknown, fileName: unknown) => {
    if (!isRenderJobId(jobId)) {
      return invalidInput("렌더 작업 id가 올바르지 않습니다.");
    }

    if (typeof fileName !== "string" || !/^card-\d+\.png$/.test(fileName)) {
      return invalidInput("카드 파일 이름이 올바르지 않습니다.");
    }

    const sourcePath = path.join(getRenderOutputDirectory(storageRoot(), jobId), fileName);
    if (smokeAction === "render-export") {
      const targetDir = path.join(getRenderOutputDirectory(storageRoot(), jobId), "smoke-exports");
      const targetPath = path.join(targetDir, fileName);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      return targetPath;
    }

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

    const outputDir = getRenderOutputDirectory(storageRoot(), jobId);
    const stamp = new Date().toISOString().slice(0, 10);
    if (smokeAction === "render-export") {
      const targetDir = path.join(outputDir, "smoke-exports");
      const targetPath = path.join(targetDir, `cardnews-${stamp}.zip`);
      await fs.mkdir(targetDir, { recursive: true });
      await writeDeckZip(outputDir, targetPath);
      return targetPath;
    }

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
  ipcMain.handle("cardnews:exportProject", async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      defaultPath: `cardnews-project-${stamp}.cardnews`,
      filters: [{ extensions: ["cardnews"], name: "Cardnews Project" }]
    });
    if (result.canceled || !result.filePath) {
      return invalidInput("프로젝트 저장이 취소되었습니다.");
    }

    const targetPath = result.filePath.toLowerCase().endsWith(".cardnews")
      ? result.filePath
      : `${result.filePath}.cardnews`;
    return exportProjectArchive(storageRoot(), targetPath, app.getVersion());
  });
  ipcMain.handle("cardnews:importProject", async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ extensions: ["cardnews"], name: "Cardnews Project" }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return invalidInput("프로젝트 열기가 취소되었습니다.");
    }

    return importProjectArchive(storageRoot(), result.filePaths[0] ?? "");
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

      // 라이브 미리보기 iframe에 매번 실릴 payload라서 1080px 폭 JPEG로 줄인다.
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
  ipcMain.handle("cardnews:removeImageBackground", async (_event, imageId: unknown, tolerance: unknown) => {
    if (typeof imageId !== "string" || imageId.length === 0) {
      return invalidInput("이미지 id가 올바르지 않습니다.");
    }
    if (typeof tolerance !== "number") {
      return invalidInput("배경 제거 허용치는 숫자여야 합니다.");
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

      const { width, height } = image.getSize();
      const bitmap = image.toBitmap();
      const clampedTolerance = Math.min(96, Math.max(1, tolerance));
      const processed = removeBackground(Uint8Array.from(bitmap), width, height, clampedTolerance);
      const processedImage = nativeImage.createFromBitmap(Buffer.from(processed), { width, height });
      if (processedImage.isEmpty()) {
        return invalidInput("배경 제거 결과 이미지를 생성하지 못했습니다.");
      }

      const sourceName = found.entry.displayName.replace(/\.[^.]+$/, "");
      return saveImageBufferToLibrary(
        storageRoot(),
        processedImage.toPNG(),
        `${sourceName}-no-bg-t${clampedTolerance}.png`,
        found.entry.attribution === smokeFixtureImageAttribution ? smokeFixtureImageAttribution : undefined
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`배경 제거에 실패했습니다: ${message}`);
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
