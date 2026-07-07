// noqa: SIZE_OK - v4 release keeps Electron bootstrap and IPC registration together; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import AdmZip from "adm-zip";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aspectRatios } from "../src/domain/aspectRatios.js";
import { parseCardText } from "../src/domain/cardParser.js";
import { parseBulkCsv } from "../src/domain/csvBulk.js";
import {
  createPixabayApiUrl,
  createPixabayFallbackUrl,
  parsePixabayImages
} from "../src/domain/imageProviders.js";
import type {
  AppSettings,
  BackgroundLibraryItem,
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
  StyleProfile
} from "../src/domain/types.js";
import { buildFontFaceCss } from "../src/render-engine/cardTemplate.js";
import { renderDeckOffscreen } from "../src/render-engine/offscreenRenderer.js";
import { stylePresets } from "../src/render-engine/stylePresets.js";
import {
  addBackgroundToLibrary,
  buildDeckFromDraft,
  copyImageToDeckAssets,
  currentDeckId,
  deleteCustomStyle,
  deleteDeckPresetFromStore,
  findLibraryBackground,
  findLibraryFont,
  fontCssFormatForExtension,
  fontMimeTypeForExtension,
  getCardnewsStorageRoot,
  getRenderOutputDirectory,
  importFontToLibrary,
  isDeckPreset,
  isWorkspaceState,
  listCustomStyles,
  listBackgroundLibrary,
  listDeckPresets,
  listFontLibrary,
  loadAppSettings,
  loadDeck,
  loadWorkspaceState,
  saveAppSettings,
  saveCustomStyle,
  saveDeckDraft,
  saveDeckPresetToStore,
  saveWorkspaceState,
  type StoredLocalImage
} from "../src/storage/deckStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
const smokeScreenshotPath = process.env["CARDNEWS_SMOKE_SCREENSHOT"];
const smokeTextPath = process.env["CARDNEWS_SMOKE_TEXT"];
const smokeAction = process.env["CARDNEWS_SMOKE_ACTION"];
let selectedStyleReferenceImages: readonly StoredLocalImage[] = [];
let approvedStyleProfile: StyleProfile | undefined;

class SmokeCaptureError extends Error {
  public constructor(public readonly detail: string) {
    super(`Smoke capture failed: ${detail}`);
    this.name = "SmokeCaptureError";
  }
}

type SmokeActionResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function captureSmokePng(mainWindow: BrowserWindow): Promise<Buffer> {
  let lastFailure = "unknown failure";

  for (const retryDelay of [500, 1000, 2000, 4000] as const) {
    if (retryDelay > 0) {
      await delay(retryDelay);
    }

    try {
      const screenshot = await mainWindow.webContents.capturePage();
      return screenshot.toPNG();
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "non-Error rejection";
    }
  }

  throw new SmokeCaptureError(lastFailure);
}

async function runSmokeCapture(mainWindow: BrowserWindow): Promise<void> {
  if (!smokeScreenshotPath && !smokeTextPath) {
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
    app.exit(1);
    return;
  }

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
    default:
      throw new SmokeCaptureError(`Unknown CARDNEWS_SMOKE_ACTION: ${smokeAction}`);
  }
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
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
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

  if ("overrides" in input && input.overrides !== undefined && !isCardOverrideMap(input.overrides)) {
    return false;
  }

  return input.cards.every(isDeckDraftCard);
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
  const hasBox =
    typeof record["id"] === "string" &&
    typeof record["x"] === "number" &&
    typeof record["y"] === "number" &&
    typeof record["width"] === "number" &&
    typeof record["height"] === "number" &&
    (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
    (record["opacity"] === undefined || typeof record["opacity"] === "number");
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
    case "line":
      return (
        typeof record["color"] === "string" &&
        (record["strokeWidth"] === undefined || typeof record["strokeWidth"] === "number")
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
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  const stringFields = [
    "id",
    "name",
    "pageBackground",
    "textBackdrop",
    "chromeBackdrop",
    "ink",
    "inkSub",
    "inkMuted",
    "accentDefault",
    "badgeBackground",
    "badgeInk",
    "fontTitle",
    "fontBody"
  ];

  return (
    stringFields.every((field) => typeof record[field] === "string") &&
    typeof record["usesPhoto"] === "boolean" &&
    typeof record["usesSurface"] === "boolean" &&
    typeof record["defaultDim"] === "number" &&
    (record["numberInk"] === undefined || typeof record["numberInk"] === "string")
  );
}

function isAppSettings(input: unknown): input is AppSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return record["pixabayApiKey"] === undefined || typeof record["pixabayApiKey"] === "string";
}

function isStockImageDownloadInput(input: unknown): input is StockImageDownloadInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const record = input as Record<string, unknown>;
  return (
    record["provider"] === "pixabay" &&
    typeof record["id"] === "string" &&
    typeof record["imageUrl"] === "string" &&
    typeof record["pageUrl"] === "string" &&
    typeof record["author"] === "string"
  );
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
  let url: URL;
  try {
    url = new URL(input.imageUrl);
  } catch {
    return invalidInput("이미지 URL 형식이 올바르지 않습니다.");
  }

  if (url.protocol !== "https:") {
    return invalidInput("https 이미지 URL만 다운로드할 수 있습니다.");
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return externalServiceFailed(`이미지 다운로드 실패: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const extension = extensionForContentType(contentType) ?? extensionForPath(url.pathname);
    if (!extension) {
      return invalidInput("지원하지 않는 이미지 형식입니다.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const downloadDir = path.join(storageRoot(), "stock-downloads");
    await fs.mkdir(downloadDir, { recursive: true });
    const filePath = path.join(downloadDir, `pixabay-${input.id}.${extension}`);
    await fs.writeFile(filePath, bytes);

    const decodeResult = validateImageDecode(filePath);
    if (isCardnewsError(decodeResult)) {
      return decodeResult;
    }

    return addBackgroundToLibrary(storageRoot(), filePath, `Pixabay / ${input.author} / ${input.pageUrl}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
    return externalServiceFailed(`이미지 다운로드 실패: ${message}`);
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
    customStyles,
    deck,
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

    for (const layer of override.layers ?? []) {
      if (layer.kind !== "image" || assetImagePathById[layer.backgroundId]) {
        continue;
      }

      const layerBackground = await findLibraryBackground(storageRoot(), layer.backgroundId);
      if (layerBackground) {
        assetImagePathById[layer.backgroundId] = layerBackground.absolutePath;
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

app.whenReady().then(() => {
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
    process.env["CARDNEWS_MOCK_STYLE_EXTRACTION"] === "1"
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
      if (stat.size > 2 * 1024 * 1024) {
        return invalidInput("CSV 파일은 2MB 이하만 불러올 수 있습니다.");
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
    if (!isStockImageDownloadInput(input)) {
      return invalidInput("이미지 다운로드 입력 형식이 올바르지 않습니다.");
    }

    return downloadStockImageToLibrary(input);
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
    if (typeof jobId !== "string" || !jobId.startsWith("render-")) {
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
    if (typeof jobId !== "string" || !jobId.startsWith("render-")) {
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
  ipcMain.handle("cardnews:openOutputFolder", async (_event, jobId: unknown) => {
    if (typeof jobId !== "string" || !jobId.startsWith("render-")) {
      return invalidInput("렌더 작업 id가 올바르지 않습니다.");
    }

    const error = await shell.openPath(getRenderOutputDirectory(storageRoot(), jobId));
    return error.length > 0 ? invalidInput(error) : undefined;
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
