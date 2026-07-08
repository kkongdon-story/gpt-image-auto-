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
  StyleProfile,
  WorkspaceState
} from "../src/domain/types.js";
import { buildFontFaceCss } from "../src/render-engine/cardTemplate.js";
import { removeBackground } from "../src/render-engine/backgroundRemoval.js";
import { renderDeckOffscreen } from "../src/render-engine/offscreenRenderer.js";
import { isSafeStylePresetRecord } from "../src/render-engine/styleSafety.js";
import { stylePresets } from "../src/render-engine/stylePresets.js";
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
  saveAppSettings,
  saveCustomStyle,
  saveDeckDraft,
  saveDeckPresetToStore,
  saveImageBufferToLibrary,
  saveWorkspaceState,
  type StoredLocalImage
} from "../src/storage/deckStore.js";
import {
  exportProjectArchive,
  importProjectArchive
} from "../src/storage/projectArchive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
const smokeScreenshotPath = process.env["CARDNEWS_SMOKE_SCREENSHOT"];
const smokeTextPath = process.env["CARDNEWS_SMOKE_TEXT"];
const smokeAction = process.env["CARDNEWS_SMOKE_ACTION"];
const allowedExternalUrls = new Set(["https://www.threads.com/@kkongdon_story", "https://open.kakao.com/me/kkongdon"]);
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
    case "edit-layer":
      return await runLayerEditSmoke(mainWindow);
    case "layer-controls-regression":
      return await runLayerControlsRegressionSmoke(mainWindow);
    case "line-endpoint-regression":
      return await runLineEndpointRegressionSmoke(mainWindow);
    case "chrome-style-regression":
      return await runChromeStyleRegressionSmoke(mainWindow);
    case "content-form-regression":
      return await runContentFormRegressionSmoke(mainWindow);
    case "badge-background-removal-regression":
      return await runBadgeBackgroundRemovalRegressionSmoke(mainWindow);
    case "next-hint-image-regression":
      return await runNextHintImageRegressionSmoke(mainWindow);
    default:
      throw new SmokeCaptureError(`Unknown CARDNEWS_SMOKE_ACTION: ${smokeAction}`);
  }
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
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (!setter) {
          throw new Error("No native input value setter was available.");
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
        !(templateInput instanceof HTMLInputElement) ||
        !(colorInput instanceof HTMLInputElement) ||
        !(offsetInput instanceof HTMLInputElement) ||
        !(footerVisibleInput instanceof HTMLInputElement)
      ) {
        throw new Error("Chrome smoke controls were not input elements.");
      }

      setNativeValue(templateInput, "{n2}");
      setNativeValue(colorInput, "#123456");
      setNativeValue(offsetInput, 10);
      if (footerVisibleInput.checked) {
        footerVisibleInput.click();
      }

      await waitUntil(
        () => {
          const state = readChromeState();
          return (
            state.pageText === "01" &&
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
    preview?.["pageText"] !== "01" ||
    !pageStyle.includes("color: #123456") ||
    !pageStyle.includes("translate(0px, 10px)") ||
    preview?.["footerExists"] !== false ||
    controls?.["template"] !== "{n2}" ||
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
    savedChrome.pageNumber.template !== "{n2}" ||
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
  const sourceImage = nativeImage.createFromBitmap(createSmokeBadgeBitmap(), { width: 12, height: 12 });
  if (sourceImage.isEmpty()) {
    return { ok: false, message: "Badge smoke source image could not be created." };
  }

  const source = await saveImageBufferToLibrary(storageRoot(), sourceImage.toPNG(), "badge-smoke-source.png");
  if (isCardnewsError(source)) {
    return { ok: false, message: source.message };
  }

  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const failIfError = (result, label) => {
        if (result && result.ok === false) {
          throw new Error(label + ": " + result.message);
        }
        return result;
      };
      const processed = failIfError(
        await window.cardnews.removeImageBackground(${JSON.stringify(source.id)}, 18),
        "removeImageBackground"
      );
      const deck = failIfError(
        await window.cardnews.saveDeck({
          headerLabel: "MONEY NOTE",
          footerAccount: "kkongdon_story",
          styleId: "minimal",
          aspectRatio: "4:5",
          cards: [
            {
              index: 1,
              rawText: [
                "유형: 표지",
                "배지: TEXT BADGE",
                "제목: 이미지 배지 테스트",
                "소제목: 누끼 결과가 렌더에 들어갑니다"
              ].join("\\n")
            }
          ],
          overrides: {
            "1": {
              badge: {
                imageId: processed.id,
                imageHeight: 88,
                shape: "none"
              }
            }
          }
        }),
        "saveDeck"
      );
      const rendered = failIfError(await window.cardnews.renderDeck(deck.id), "renderDeck");
      const pre = document.createElement("pre");
      pre.id = "badge-background-removal-regression-result";
      pre.textContent = "BADGE_BACKGROUND_REMOVAL_RESULT " + JSON.stringify({
        processed,
        rendered
      });
      document.body.append(pre);
      return { processed, rendered };
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Badge background removal smoke did not return a result." };
  }
  const record = result as Record<string, unknown>;
  const processed = record["processed"];
  const rendered = record["rendered"];
  if (typeof processed !== "object" || processed === null || typeof rendered !== "object" || rendered === null) {
    return { ok: false, message: "Badge background removal smoke result shape was invalid." };
  }
  const processedRecord = processed as Record<string, unknown>;
  const renderedRecord = rendered as Record<string, unknown>;
  const processedId = processedRecord["id"];
  const outputDir = renderedRecord["outputDir"];
  if (typeof processedId !== "string" || typeof outputDir !== "string") {
    return { ok: false, message: "Badge background removal smoke did not return ids and output path." };
  }

  const html = await fs.readFile(path.join(outputDir, "card-01.html"), "utf8");
  if (!html.includes('class="badge-image"') || !html.includes('data-slot="badge-image"')) {
    return { ok: false, message: "Rendered HTML did not contain the image badge metric slot." };
  }
  if (!html.includes(processedId)) {
    return { ok: false, message: "Rendered HTML did not use the processed background-removed image." };
  }

  const pngStat = await fs.stat(path.join(outputDir, "card-01.png"));
  if (!pngStat.isFile() || pngStat.size === 0) {
    return { ok: false, message: "Rendered badge smoke PNG was missing or empty." };
  }

  return { ok: true };
}

async function runNextHintImageRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const sourceImage = nativeImage.createFromBitmap(createSmokeBadgeBitmap(), { width: 12, height: 12 });
  if (sourceImage.isEmpty()) {
    return { ok: false, message: "Next hint smoke source image could not be created." };
  }

  const source = await saveImageBufferToLibrary(storageRoot(), sourceImage.toPNG(), "next-hint-smoke.png");
  if (isCardnewsError(source)) {
    return { ok: false, message: source.message };
  }

  const result = (await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const failIfError = (result, label) => {
        if (result && result.ok === false) {
          throw new Error(label + ": " + result.message);
        }
        return result;
      };
      const deck = failIfError(
        await window.cardnews.saveDeck({
          headerLabel: "MONEY NOTE",
          footerAccount: "kkongdon_story",
          styleId: "minimal",
          aspectRatio: "4:5",
          nextHint: {
            kind: "image",
            imageId: ${JSON.stringify(source.id)},
            height: 44
          },
          cards: [
            {
              index: 1,
              rawText: [
                "유형: 표지",
                "배지: NEXT",
                "제목: 넘김 기호 이미지",
                "소제목: 마지막 전 카드에만 보입니다"
              ].join("\\n")
            },
            {
              index: 2,
              rawText: [
                "유형: 마무리",
                "제목: 마지막 카드",
                "본문: 마지막 장에는 넘김 기호를 숨깁니다."
              ].join("\\n")
            }
          ]
        }),
        "saveDeck"
      );
      const rendered = failIfError(await window.cardnews.renderDeck(deck.id), "renderDeck");
      const pre = document.createElement("pre");
      pre.id = "next-hint-image-regression-result";
      pre.textContent = "NEXT_HINT_IMAGE_RESULT " + JSON.stringify({ rendered });
      document.body.append(pre);
      return { rendered };
    })()
  `)) as unknown;

  if (typeof result !== "object" || result === null) {
    return { ok: false, message: "Next hint image smoke did not return a result." };
  }
  const rendered = (result as Record<string, unknown>)["rendered"];
  if (typeof rendered !== "object" || rendered === null) {
    return { ok: false, message: "Next hint image smoke result shape was invalid." };
  }
  const outputDir = (rendered as Record<string, unknown>)["outputDir"];
  if (typeof outputDir !== "string") {
    return { ok: false, message: "Next hint image smoke did not return an output path." };
  }

  const firstHtml = await fs.readFile(path.join(outputDir, "card-01.html"), "utf8");
  const lastHtml = await fs.readFile(path.join(outputDir, "card-02.html"), "utf8");
  if (!firstHtml.includes('class="next-hint-image"') || !firstHtml.includes('data-slot="next-hint-image"')) {
    return { ok: false, message: "First card did not render next hint image slot." };
  }
  if (!firstHtml.includes(source.id) || !firstHtml.includes("height: 44px")) {
    return { ok: false, message: "First card did not use the configured next hint image and height." };
  }
  if (lastHtml.includes("next-hint") || lastHtml.includes("■")) {
    return { ok: false, message: "Last card still rendered a next hint marker." };
  }

  const pngStat = await fs.stat(path.join(outputDir, "card-01.png"));
  if (!pngStat.isFile() || pngStat.size === 0) {
    return { ok: false, message: "Rendered next hint PNG was missing or empty." };
  }

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
          textAlign: computedStyle?.textAlign ?? ""
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
      const mentionInput = Array.from(document.querySelectorAll(".topbar-field"))
        .find((field) => (field.textContent ?? "").includes("멘션"))
        ?.querySelector("input");
      if (!(mentionInput instanceof HTMLInputElement)) {
        throw new Error("Mention input was not found.");
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
        thumbnailCenterDelta,
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
  ipcMain.handle("cardnews:listImageLibrary", () => listImageLibrary(storageRoot()));
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
      const resized = width > 1080 ? image.resize({ width: 1080 }) : image;
      return `data:image/png;base64,${resized.toPNG().toString("base64")}`;
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
      const processed = removeBackground(Uint8Array.from(bitmap), width, height, Math.min(96, Math.max(1, tolerance)));
      const processedImage = nativeImage.createFromBitmap(Buffer.from(processed), { width, height });
      if (processedImage.isEmpty()) {
        return invalidInput("배경 제거 결과 이미지를 생성하지 못했습니다.");
      }

      const sourceName = found.entry.displayName.replace(/\.[^.]+$/, "");
      return saveImageBufferToLibrary(storageRoot(), processedImage.toPNG(), `${sourceName}-no-bg.png`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
      return invalidInput(`배경 제거에 실패했습니다: ${message}`);
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
