// noqa: SIZE_OK - v4 release keeps offscreen rendering lifecycle and blank-frame guards in one audited unit; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import { BrowserWindow } from "electron";
import type { NativeImage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Card,
  CardnewsError,
  CardnewsResult,
  Deck,
  QualityGateIssue,
  QualityGateReport,
  RenderJobResult,
  RenderSlotMetric,
  RenderedCard
} from "../domain/types.js";
import { findAspectRatio } from "../domain/aspectRatios.js";
import { buildCardHtml } from "./cardTemplate.js";
import { evaluateQualityGates } from "./gates/qualityGates.js";
import { evaluateVisualContentGate } from "./gates/visualContentGate.js";
import type { StylePreset } from "./stylePresets.js";

const FINAL_CAPTURE_ATTEMPTS = 5;

export type RenderDeckInput = {
  readonly assetImagePathById?: Readonly<Record<string, string>>;
  readonly backgroundImagePath: string | undefined;
  readonly backgroundImagePathByCardIndex?: Readonly<Record<string, string | null>>;
  readonly customStyles?: readonly StylePreset[];
  readonly deck: Deck;
  readonly jobId: string;
  readonly outputDir: string;
  /** `@font-face` CSS(data URI 소스) — 렌더 결정론을 위한 폰트 임베드 */
  readonly fontCss?: string;
};

type CardRenderOutput = {
  readonly metrics: readonly RenderSlotMetric[];
  readonly png: Buffer;
  readonly visualIssues: readonly QualityGateIssue[];
};

export async function renderDeckOffscreen(
  input: RenderDeckInput
): Promise<CardnewsResult<RenderJobResult>> {
  await fs.mkdir(input.outputDir, { recursive: true });

  const renderedCards: RenderedCard[] = [];
  const allMetrics: RenderSlotMetric[] = [];
  const allIssues: QualityGateIssue[] = [];

  const ratio = findAspectRatio(input.deck.aspectRatio);
  const dimensions = { width: ratio.width, height: ratio.height };

  for (const card of input.deck.cards) {
    const renderedCard = await renderCard(input, card);
    if (isCardnewsError(renderedCard)) {
      await writeRenderError(input.outputDir, card.index, renderedCard);
      return renderedCard;
    }

    const metricGateReport = evaluateQualityGates(renderedCard.metrics, dimensions);
    const cardGateReport = buildGateReport([
      ...metricGateReport.issues,
      ...renderedCard.visualIssues
    ]);
    const fileName = `card-${String(card.index).padStart(2, "0")}.png`;
    const filePath = path.join(input.outputDir, fileName);

    await fs.writeFile(filePath, renderedCard.png);
    allMetrics.push(...renderedCard.metrics);
    allIssues.push(...cardGateReport.issues);
    renderedCards.push({
      bytes: renderedCard.png.byteLength,
      fileName,
      gateStatus: cardGateReport.status,
      index: card.index,
      previewDataUrl: `data:image/png;base64,${renderedCard.png.toString("base64")}`,
      sha256: createSha256(renderedCard.png)
    });
  }

  const gateReport = buildGateReport(allIssues);
  await writeRenderReports(input.outputDir, allMetrics, gateReport);

  return {
    cardCount: renderedCards.length,
    cards: renderedCards,
    gateReport,
    jobId: input.jobId,
    outputDir: input.outputDir
  };
}

async function renderCard(
  input: RenderDeckInput,
  card: Card
): Promise<CardnewsResult<CardRenderOutput>> {
  const ratio = findAspectRatio(input.deck.aspectRatio);
  const window = new BrowserWindow({
    height: ratio.height,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true
    },
    width: ratio.width
  });

  try {
    window.webContents.setFrameRate(30);
    const cardBackgroundImagePath = resolveCardBackgroundImagePath(input, card);
    const backgroundCssUrl = cardBackgroundImagePath
      ? pathToFileURL(cardBackgroundImagePath).toString()
      : undefined;
    const html = buildCardHtml({
      assetCssUrls: buildAssetCssUrls(input.assetImagePathById),
      backgroundCssUrl,
      card,
      customStyles: input.customStyles ?? [],
      deck: input.deck,
      ...(input.fontCss ? { fontCss: input.fontCss } : {}),
      ...(input.deck.overrides?.[String(card.index)]
        ? { override: input.deck.overrides[String(card.index)] }
        : {})
    });

    // 폰트 임베드로 HTML이 수 MB가 되면 data: URL 길이 제한에 걸리므로
    // 산출물 폴더에 파일로 쓰고 file://로 로드한다(디버깅용 계약 파일 겸용).
    const htmlPath = path.join(input.outputDir, `card-${String(card.index).padStart(2, "0")}.html`);
    await fs.writeFile(htmlPath, html, "utf8");
    await window.loadURL(pathToFileURL(htmlPath).toString());
    await waitForFonts(window, Boolean(input.deck.fontId));
    await waitForImageAssets(window);
    await window.webContents.executeJavaScript(
      "document.body.dataset.cardnewsReady = String(Date.now()); true"
    );
    await waitForAnimationFrames(window, 3);

    const image = await captureFinalImage(window);
    if (isBlankImage(image)) {
      return renderFailed(`카드 ${card.index} 렌더링 결과가 비어 있습니다.`);
    }

    const imageSize = image.getSize();
    if (imageSize.width !== ratio.width || imageSize.height !== ratio.height) {
      return renderFailed(
        `카드 ${card.index} PNG 크기가 올바르지 않습니다: ${imageSize.width}x${imageSize.height}`
      );
    }

    const png = image.toPNG();
    if (png.byteLength === 0) {
      return renderFailed(`카드 ${card.index} PNG가 비어 있습니다.`);
    }

    const visualGate = evaluateVisualContentGate({
      bitmap: image.toBitmap(),
      cardIndex: card.index,
      height: imageSize.height,
      width: imageSize.width
    });

    const metrics = await collectSlotMetrics(window);
    if (isCardnewsError(metrics)) {
      return metrics;
    }

    if (metrics.length === 0) {
      return renderFailed(`카드 ${card.index} 슬롯 메트릭이 비어 있습니다.`);
    }

    return { metrics, png, visualIssues: visualGate.issues };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 렌더링 오류";

    return renderFailed(`카드 ${card.index} 렌더링에 실패했습니다: ${message}`);
  } finally {
    window.destroy();
  }
}

function resolveCardBackgroundImagePath(input: RenderDeckInput, card: Card): string | undefined {
  const key = String(card.index);
  if (
    input.backgroundImagePathByCardIndex &&
    Object.prototype.hasOwnProperty.call(input.backgroundImagePathByCardIndex, key)
  ) {
    return input.backgroundImagePathByCardIndex[key] ?? undefined;
  }

  return input.backgroundImagePath;
}

function buildAssetCssUrls(
  assetImagePathById: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> {
  if (!assetImagePathById) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(assetImagePathById).map(([id, assetPath]) => [id, pathToFileURL(assetPath).toString()])
  );
}

async function waitForFonts(window: BrowserWindow, requireUserFont: boolean): Promise<void> {
  const result = (await window.webContents.executeJavaScript(`
    (async () => {
      const ready = await Promise.race([
        document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000))
      ]);
      const userFontLoaded = document.fonts
        ? document.fonts.check('16px "Cardnews User Font"')
        : true;
      return { ready, userFontLoaded };
    })()
  `)) as { readonly ready?: unknown; readonly userFontLoaded?: unknown };

  if (result.ready !== true) {
    throw new Error("폰트 로딩 시간이 초과되었습니다.");
  }

  if (requireUserFont && result.userFontLoaded !== true) {
    throw new Error("사용자 폰트를 로드하지 못했습니다: Cardnews User Font");
  }
}

async function waitForImageAssets(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    Promise.race([
      Promise.all([
        ...Array.from(document.images).map((image) => {
          if (image.complete && image.naturalWidth > 0) {
            return true;
          }
          return new Promise((resolve) => {
            const done = () => resolve(true);
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
          });
        }),
        ...Array.from(document.querySelectorAll(".photo, .layer-image"))
          .map((element) => window.getComputedStyle(element).backgroundImage)
          .flatMap((backgroundImage) => {
            const matches = [...backgroundImage.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)];
            return matches.map((match) => match[1]).filter(Boolean);
          })
          .map((url) => new Promise((resolve) => {
            const image = new Image();
            const done = () => resolve(true);
            image.onload = done;
            image.onerror = done;
            image.src = url;
          }))
      ]),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000))
    ])
  `);
}

async function waitForAnimationFrames(window: BrowserWindow, frameCount: number): Promise<void> {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let remaining = ${Math.max(1, frameCount)};
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) {
          resolve(true);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })
  `);
}

async function captureFinalImage(window: BrowserWindow): Promise<NativeImage> {
  for (let attempt = 0; attempt < FINAL_CAPTURE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await delay(160 * attempt);
    }

    window.webContents.invalidate();
    await waitForAnimationFrames(window, 2);
    const image = await window.webContents.capturePage();
    if (!image.isEmpty() && !isBlankImage(image)) {
      return image;
    }
  }

  throw new Error("Captured offscreen frame stayed blank after render readiness.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function collectSlotMetrics(
  window: BrowserWindow
): Promise<CardnewsResult<readonly RenderSlotMetric[]>> {
  const rawMetrics = await window.webContents.executeJavaScript(
    "window.__CARDNEWS_COLLECT_METRICS__ ? window.__CARDNEWS_COLLECT_METRICS__() : []"
  );

  if (!Array.isArray(rawMetrics)) {
    return renderFailed("슬롯 메트릭 응답이 배열이 아닙니다.");
  }

  const metrics: RenderSlotMetric[] = [];
  for (const rawMetric of rawMetrics) {
    const metric = parseMetric(rawMetric);
    if (!metric) {
      return renderFailed("슬롯 메트릭 형식이 올바르지 않습니다.");
    }

    metrics.push(metric);
  }

  return metrics;
}

function parseMetric(rawMetric: unknown): RenderSlotMetric | undefined {
  if (typeof rawMetric !== "object" || rawMetric === null) {
    return undefined;
  }

  if (
    !("backgroundColor" in rawMetric) ||
    !("cardIndex" in rawMetric) ||
    !("color" in rawMetric) ||
    !("fontSize" in rawMetric) ||
    !("height" in rawMetric) ||
    !("left" in rawMetric) ||
    !("slot" in rawMetric) ||
    !("text" in rawMetric) ||
    !("top" in rawMetric) ||
    !("width" in rawMetric)
  ) {
    return undefined;
  }

  if (
    typeof rawMetric.backgroundColor !== "string" ||
    typeof rawMetric.cardIndex !== "number" ||
    typeof rawMetric.color !== "string" ||
    typeof rawMetric.fontSize !== "number" ||
    typeof rawMetric.height !== "number" ||
    typeof rawMetric.left !== "number" ||
    typeof rawMetric.slot !== "string" ||
    typeof rawMetric.text !== "string" ||
    typeof rawMetric.top !== "number" ||
    typeof rawMetric.width !== "number"
  ) {
    return undefined;
  }

  return {
    backgroundColor: rawMetric.backgroundColor,
    cardIndex: rawMetric.cardIndex,
    color: rawMetric.color,
    fontSize: rawMetric.fontSize,
    height: rawMetric.height,
    left: rawMetric.left,
    slot: rawMetric.slot,
    text: rawMetric.text,
    top: rawMetric.top,
    width: rawMetric.width
  };
}

function isBlankImage(image: NativeImage): boolean {
  const bitmap = image.toBitmap();
  if (bitmap.byteLength < 4) {
    return true;
  }

  const firstBlue = readByte(bitmap, 0);
  const firstGreen = readByte(bitmap, 1);
  const firstRed = readByte(bitmap, 2);
  const firstAlpha = readByte(bitmap, 3);
  const step = Math.max(4, Math.floor(bitmap.byteLength / 1600));

  for (let index = 4; index < bitmap.byteLength; index += step) {
    if (
      readByte(bitmap, index) !== firstBlue ||
      readByte(bitmap, index + 1) !== firstGreen ||
      readByte(bitmap, index + 2) !== firstRed ||
      readByte(bitmap, index + 3) !== firstAlpha
    ) {
      return false;
    }
  }

  return true;
}

function readByte(buffer: Buffer, index: number): number {
  return buffer[index] ?? 0;
}

function buildGateReport(issues: readonly QualityGateIssue[]): QualityGateReport {
  if (issues.some((issue) => issue.severity === "fail")) {
    return { status: "fail", issues };
  }

  return { status: issues.length > 0 ? "warn" : "pass", issues };
}

async function writeRenderReports(
  outputDir: string,
  metrics: readonly RenderSlotMetric[],
  gateReport: QualityGateReport
): Promise<void> {
  await fs.writeFile(path.join(outputDir, "slots.json"), JSON.stringify(metrics, null, 2), "utf8");
  await fs.writeFile(
    path.join(outputDir, "gate-report.json"),
    JSON.stringify(gateReport, null, 2),
    "utf8"
  );
}

async function writeRenderError(
  outputDir: string,
  cardIndex: number,
  error: CardnewsError
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "render-error.json"),
    JSON.stringify({ cardIndex, code: error.code, message: error.message }, null, 2),
    "utf8"
  );
}

function createSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function renderFailed(message: string): CardnewsError {
  return { ok: false, code: "render_failed", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
