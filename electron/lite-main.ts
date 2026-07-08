import AdmZip from "adm-zip";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCardText } from "../src/domain/cardParser.js";
import { stripProDeck, stripProDeckDraft, stripProDeckPreset, stripProWorkspaceState } from "../src/domain/editionFilter.js";
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
  listBackgroundLibrary,
  listCustomStyles,
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
const smokeAction = process.env["CARDNEWS_SMOKE_ACTION"];
const allowedExternalUrls = new Set(["https://www.threads.com/@kkongdon_story", "https://open.kakao.com/me/kkongdon"]);
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
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
  if (!result.ok) {
    console.error(result.message);
    app.exit(1);
    return;
  }

  app.exit(0);
}

async function runSmokeAction(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  switch (smokeAction) {
    case "edition-lite-regression":
      return await runEditionLiteRegressionSmoke(mainWindow);
    case "edition-lite-basic-flow":
      return await runEditionLiteBasicFlowSmoke(mainWindow);
    default:
      return { ok: false, message: `Unknown CARDNEWS_SMOKE_ACTION: ${smokeAction ?? ""}` };
  }
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
      const exportTab = await waitFor('[data-smoke-action="inspector-export"]');
      exportTab.click();
      await wait(80);
      const aiButton = await waitFor('[data-smoke-action="open-ai-panel"]');
      if (aiButton instanceof HTMLButtonElement) {
        aiButton.click();
        await wait(120);
      }

      const requiredLocks = [
        "card_design",
        "chrome_style",
        "overlay_edit",
        "badge_image",
        "next_hint_image",
        "project_file",
        "bulk_csv",
        "ai_panel"
      ];
      const renderedLocks = Array.from(document.querySelectorAll('[data-smoke-role="edition-lock"]'))
        .map((node) => node.getAttribute("data-smoke-feature"))
        .filter(Boolean);
      const missingLocks = requiredLocks.filter((featureCode) => !renderedLocks.includes(featureCode));
      const lockButton = document.querySelector('[data-smoke-action="locked-bulk_csv"]');
      if (lockButton instanceof HTMLButtonElement) {
        lockButton.click();
        await wait(80);
      }

      const proKeys = [
        "render" + "Bulk" + "Csv",
        "remove" + "Image" + "Background",
        "export" + "Project"
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
    (record["aiDefaultProviderId"] === undefined || isAiProviderIdSetting(record["aiDefaultProviderId"]))
  );
}

function isAiProviderIdSetting(input: unknown): boolean {
  return input === "claude" || input === "codex" || input === "gemini";
}

function isStylePresetRecord(input: unknown): input is StylePresetRecord {
  return isSafeStylePresetRecord(input);
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

async function renderDeckToOutput(
  deck: Deck,
  jobId: string,
  outputDir: string,
  customStyles: readonly StylePresetRecord[]
): Promise<CardnewsResult<RenderJobResult>> {
  const fontCss = await buildRenderFontCss(deck.fontId);
  if (isCardnewsError(fontCss)) {
    return fontCss;
  }

  const backgroundImagePath = deck.backgroundId
    ? (await findLibraryBackground(storageRoot(), deck.backgroundId))?.absolutePath
    : undefined;

  return renderDeckOffscreen({
    backgroundImagePath,
    customStyles,
    deck: stripProDeck(deck),
    jobId,
    outputDir,
    ...(fontCss ? { fontCss } : {})
  });
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

app.whenReady().then(() => {
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
    process.env["CARDNEWS_MOCK_STYLE_EXTRACTION"] === "1"
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
    if (typeof jobId !== "string" || !jobId.startsWith("render-")) {
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
    if (typeof jobId !== "string" || !jobId.startsWith("render-")) {
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
  ipcMain.handle("cardnews:openOutputFolder", async (_event, jobId: unknown) => {
    if (typeof jobId !== "string" || !jobId.startsWith("render-")) {
      return invalidInput("렌더 작업 id가 올바르지 않습니다.");
    }

    const error = await shell.openPath(getRenderOutputDirectory(storageRoot(), jobId));
    return error.length > 0 ? invalidInput(error) : undefined;
  });
  ipcMain.handle("cardnews:openExternalLink", async (_event, url: unknown) => {
    if (typeof url !== "string" || !allowedExternalUrls.has(url)) {
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
