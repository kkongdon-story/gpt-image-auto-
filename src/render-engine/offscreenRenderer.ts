// noqa: SIZE_OK - v4 release keeps offscreen rendering lifecycle and blank-frame guards in one audited unit; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import { BrowserWindow } from "electron";
import type { NativeImage, WebContents } from "electron";
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
import {
  decideCaptureNormalization,
  planCardSurfaceCompensation,
  validateCardGeometry,
  type CardSurfaceCompensation,
  type CardGeometryProbe,
  type ValidatedCardGeometry
} from "./captureGeometry.js";
import { PaintFrameCollector, type PaintFrameSource } from "./paintFrameCollector.js";
import {
  createRenderCaptureReport,
  createRenderDiagnostic,
  createRenderUserMessage,
  type RenderCaptureReport,
  type RenderDiagnostic,
  type RenderDiagnosticCode,
  type RenderNormalizationDiagnostic
} from "./renderDiagnostics.js";
import { validateFinalImage } from "./finalImageValidation.js";
import { createRenderWindowOptions } from "./renderWindowConfig.js";
import type { StylePreset } from "./stylePresets.js";

const FINAL_CAPTURE_ATTEMPTS = 5;

export type RenderDeckInput = {
  readonly appVersion?: string;
  readonly assetImagePathById?: Readonly<Record<string, string>>;
  readonly backgroundImagePath: string | undefined;
  readonly backgroundImagePathByCardIndex?: Readonly<Record<string, string | null>>;
  readonly customStyles?: readonly StylePreset[];
  readonly deck: Deck;
  readonly edition?: "lite" | "pro";
  readonly jobId: string;
  readonly outputDir: string;
  /** `@font-face` CSS(data URI 소스) — 렌더 결정론을 위한 폰트 임베드 */
  readonly fontCss?: string;
};

type CardRenderOutput = {
  readonly captureReport: RenderCaptureReport;
  readonly metrics: readonly RenderSlotMetric[];
  readonly png: Buffer;
  readonly visualIssues: readonly QualityGateIssue[];
};

type RenderFailure = CardnewsError & {
  readonly diagnostic: RenderDiagnostic;
};

type CapturedFrame = {
  readonly image: NativeImage;
  readonly normalization: RenderNormalizationDiagnostic;
  readonly source: { readonly width: number; readonly height: number };
};

class CaptureFrameFailure extends Error {
  readonly capturedBitmap: { readonly width: number; readonly height: number } | undefined;
  readonly code: RenderDiagnosticCode;
  readonly normalization: RenderNormalizationDiagnostic;

  constructor(input: {
    readonly capturedBitmap?: { readonly width: number; readonly height: number };
    readonly code: RenderDiagnosticCode;
    readonly normalization: RenderNormalizationDiagnostic;
  }) {
    super(input.normalization.reason ?? input.code);
    this.name = "CaptureFrameFailure";
    this.capturedBitmap = input.capturedBitmap;
    this.code = input.code;
    this.normalization = input.normalization;
  }
}

class RenderFontReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderFontReadinessError";
  }
}

class RenderImageReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderImageReadinessError";
  }
}

export async function renderDeckOffscreen(
  input: RenderDeckInput
): Promise<CardnewsResult<RenderJobResult>> {
  await fs.mkdir(input.outputDir, { recursive: true });

  const renderedCards: RenderedCard[] = [];
  const allMetrics: RenderSlotMetric[] = [];
  const allIssues: QualityGateIssue[] = [];
  const captureReports: RenderCaptureReport[] = [];

  const ratio = findAspectRatio(input.deck.aspectRatio);
  const dimensions = { width: ratio.width, height: ratio.height };

  for (const card of input.deck.cards) {
    const renderedCard = await renderCard(input, card);
    if (isCardnewsError(renderedCard)) {
      await writeRenderError(input.outputDir, card.index, renderedCard);
      return toPublicError(renderedCard);
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
    captureReports.push(renderedCard.captureReport);
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
  await writeRenderReports(input.outputDir, allMetrics, gateReport, captureReports);

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
  const dimensions = { width: ratio.width, height: ratio.height };
  let window: BrowserWindow | undefined;
  let frameCollector: PaintFrameCollector<NativeImage> | undefined;
  let geometryProbe: CardGeometryProbe | undefined;

  try {
    window = new BrowserWindow(createRenderWindowOptions(dimensions));
    window.setContentSize(dimensions.width, dimensions.height);
    window.webContents.setZoomFactor(1);
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
    frameCollector = await createPaintCollectorAndLoad(window.webContents, () =>
      window!.loadURL(pathToFileURL(htmlPath).toString())
    );
    await waitForFonts(window, Boolean(input.deck.fontId));
    await waitForImageAssets(window.webContents);
    await window.webContents.executeJavaScript(
      "document.body.dataset.cardnewsReady = String(Date.now()); true"
    );
    await waitForAnimationFrames(window, 3);

    geometryProbe = await collectCardGeometryProbe(window);
    let geometryResult = validateCardGeometry(geometryProbe, ratio);
    if (!geometryResult.ok) {
      const compensation = planCardSurfaceCompensation(geometryProbe, ratio);
      if (compensation.ok && needsSurfaceCompensation(compensation.value)) {
        await applyCardSurfaceCompensation(window, compensation.value);
        await waitForAnimationFrames(window, 2);
        geometryProbe = await collectCardGeometryProbe(window);
        geometryResult = validateCardGeometry(geometryProbe, ratio);
      }
    }
    if (!geometryResult.ok) {
      return renderFailure(
        input,
        card.index,
        ratio,
        geometryResult.code,
        createRenderUserMessage({
          cardIndex: card.index,
          code: geometryResult.code,
          expected: dimensions
        }),
        {
          geometry: geometryProbe,
          normalization: {
            decision: "not_attempted",
            reason: geometryResult.reason,
            scale: null
          }
        }
      );
    }

    let capturedFrame: CapturedFrame;
    try {
      capturedFrame = await captureFinalImage(frameCollector, geometryResult.value, dimensions);
    } catch (error) {
      if (error instanceof CaptureFrameFailure) {
        const actual = error.capturedBitmap;
        return renderFailure(
          input,
          card.index,
          ratio,
          error.code,
          createRenderUserMessage({
            ...(actual ? { actual } : {}),
            cardIndex: card.index,
            code: error.code,
            expected: dimensions
          }),
          {
            ...(actual ? { capturedBitmap: actual } : {}),
            geometry: geometryProbe,
            normalization: error.normalization
          }
        );
      }
      throw error;
    }

    const image = capturedFrame.image;
    const imageSize = image.getSize();
    const finalValidation = validateFinalImage({
      blank: isBlankImage(image),
      empty: image.isEmpty(),
      size: imageSize,
      target: dimensions
    });
    if (!finalValidation.ok) {
      return renderFailure(
        input,
        card.index,
        ratio,
        finalValidation.code,
        createRenderUserMessage({
          actual: imageSize,
          cardIndex: card.index,
          code: finalValidation.code,
          expected: dimensions
        }),
        {
          capturedBitmap: capturedFrame.source,
          finalBitmap: imageSize,
          geometry: geometryProbe,
          normalization: capturedFrame.normalization
        }
      );
    }

    const png = image.toPNG();
    if (png.byteLength === 0) {
      return renderFailure(
        input,
        card.index,
        ratio,
        "RENDER_CAPTURE_BLANK",
        createRenderUserMessage({
          cardIndex: card.index,
          code: "RENDER_CAPTURE_BLANK",
          expected: dimensions
        }),
        {
          capturedBitmap: capturedFrame.source,
          finalBitmap: imageSize,
          geometry: geometryProbe,
          normalization: capturedFrame.normalization
        }
      );
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

    const captureReport = createRenderCaptureReport({
      appVersion: input.appVersion ?? process.env["npm_package_version"],
      aspectRatioId: ratio.id,
      capturedBitmap: capturedFrame.source,
      cardIndex: card.index,
      edition: input.edition,
      expected: dimensions,
      finalBitmap: imageSize,
      geometry: geometryProbe,
      normalization: capturedFrame.normalization
    });

    return { captureReport, metrics, png, visualIssues: visualGate.issues };
  } catch (error) {
    return renderFailure(
      input,
      card.index,
      ratio,
      "RENDER_INTERNAL_ERROR",
      createRenderUserMessage({
        cardIndex: card.index,
        code: "RENDER_INTERNAL_ERROR",
        expected: dimensions
      }),
      {
        ...(geometryProbe ? { geometry: geometryProbe } : {}),
        internalError: error,
        normalization: {
          decision: "not_attempted",
          reason: "Rendering failed before a validated final image was available.",
          scale: null
        }
      }
    );
  } finally {
    frameCollector?.dispose();
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }
}

function needsSurfaceCompensation(compensation: CardSurfaceCompensation): boolean {
  return compensation.scaleX !== 1 || compensation.scaleY !== 1;
}

async function applyCardSurfaceCompensation(
  window: BrowserWindow,
  compensation: CardSurfaceCompensation
): Promise<void> {
  const applied = (await window.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector(".card");
      if (!(card instanceof HTMLElement)) {
        return false;
      }
      card.style.transformOrigin = "0 0";
      card.style.transform = "scale(${compensation.scaleX}, ${compensation.scaleY})";
      return true;
    })()
  `)) as unknown;
  if (applied !== true) {
    throw new Error("카드 DPI 표면 보정을 적용하지 못했습니다.");
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
    throw new RenderFontReadinessError("폰트 로딩 시간이 초과되었습니다.");
  }

  if (requireUserFont && result.userFontLoaded !== true) {
    throw new RenderFontReadinessError("사용자 폰트를 로드하지 못했습니다: Cardnews User Font");
  }
}

export async function waitForImageAssets(executor: {
  executeJavaScript(script: string): Promise<unknown>;
}): Promise<void> {
  const result = await executor.executeJavaScript(`
    (async () => {
      const statuses = await Promise.race([
        Promise.all([
        ...Array.from(document.images).map((image) => {
          if (image.complete) {
            return image.naturalWidth > 0;
          }
          return new Promise((resolve) => {
            image.addEventListener("load", () => resolve(true), { once: true });
            image.addEventListener("error", () => resolve(false), { once: true });
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
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = url;
          }))
        ]).then((values) => ({
          failedCount: values.filter((value) => value !== true).length,
          ready: values.every((value) => value === true),
          timedOut: false
        })),
        new Promise((resolve) => setTimeout(
          () => resolve({ failedCount: 0, ready: false, timedOut: true }),
          5000
        ))
      ]);
      return statuses;
    })()
  `);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new RenderImageReadinessError("이미지 자산 준비 상태를 확인하지 못했습니다.");
  }

  const readiness = result as Record<string, unknown>;
  if (readiness["ready"] === true) {
    return;
  }
  if (readiness["timedOut"] === true) {
    throw new RenderImageReadinessError("이미지 로딩 시간이 초과되었습니다.");
  }

  const failedCount =
    typeof readiness["failedCount"] === "number" && Number.isFinite(readiness["failedCount"])
      ? readiness["failedCount"]
      : 1;
  throw new RenderImageReadinessError(`이미지 자산을 로드하지 못했습니다: ${failedCount}개`);
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

async function captureFinalImage(
  frameCollector: PaintFrameCollector<NativeImage>,
  geometry: ValidatedCardGeometry,
  target: { readonly width: number; readonly height: number }
): Promise<CapturedFrame> {
  let lastFailure: CaptureFrameFailure | undefined;
  for (let attempt = 0; attempt < FINAL_CAPTURE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await delay(160 * attempt);
    }

    try {
      const frame = await frameCollector.captureInvalidatedFrame(2_500);
      const image = frame.image;
      if (image.isEmpty() || isBlankImage(image)) {
        lastFailure = new CaptureFrameFailure({
          capturedBitmap: image.getSize(),
          code: "RENDER_CAPTURE_BLANK",
          normalization: {
            decision: "rejected",
            reason: "Captured offscreen frame was blank.",
            scale: null
          }
        });
        continue;
      }

      const source = image.getSize();
      const decision = decideCaptureNormalization({
        geometry,
        hasUnexpectedBorder: hasUnexpectedTransparentBorder(image),
        source,
        target
      });
      if (!decision.ok) {
        lastFailure = new CaptureFrameFailure({
          capturedBitmap: source,
          code: "RENDER_CAPTURE_ASPECT_MISMATCH",
          normalization: {
            decision: "rejected",
            reason: decision.reason,
            scale: null
          }
        });
        continue;
      }

      return {
        image:
          decision.value.decision === "exact"
            ? image
            : image.resize({ width: target.width, height: target.height, quality: "best" }),
        normalization: {
          decision: decision.value.decision,
          reason: null,
          scale: decision.value.scale
        },
        source
      };
    } catch (error) {
      lastFailure =
        error instanceof CaptureFrameFailure
          ? error
          : new CaptureFrameFailure({
              code: "RENDER_CAPTURE_BLANK",
              normalization: {
                decision: "rejected",
                reason:
                  error instanceof Error &&
                  error.message === "Timed out waiting for a post-readiness paint frame."
                    ? error.message
                    : "Offscreen paint capture failed before a usable frame.",
                scale: null
              }
            });
    }
  }

  throw (
    lastFailure ??
    new CaptureFrameFailure({
      code: "RENDER_CAPTURE_BLANK",
      normalization: {
        decision: "rejected",
        reason: "Captured offscreen frame stayed blank after render readiness.",
        scale: null
      }
    })
  );
}

export async function createPaintCollectorAndLoad(
  webContents: WebContents,
  load: () => Promise<void>
): Promise<PaintFrameCollector<NativeImage>> {
  const collector = new PaintFrameCollector(createPaintFrameSource(webContents));
  try {
    await load();
    return collector;
  } catch (error) {
    collector.dispose();
    throw error;
  }
}

export function createPaintFrameSource(webContents: WebContents): PaintFrameSource<NativeImage> {
  return {
    invalidate: () => {
      webContents.invalidate();
    },
    subscribe: (listener) => {
      const handlePaint = (
        _event: Electron.Event,
        _dirtyRect: Electron.Rectangle,
        image: NativeImage
      ): void => {
        listener(image);
      };
      webContents.on("paint", handlePaint);
      return () => {
        webContents.removeListener("paint", handlePaint);
      };
    }
  };
}

async function collectCardGeometryProbe(window: BrowserWindow): Promise<CardGeometryProbe> {
  const rawProbe: unknown = await window.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector(".card");
      const rect = card ? card.getBoundingClientRect() : undefined;
      const computed = card ? window.getComputedStyle(card) : undefined;
      return {
        cardExists: Boolean(card),
        rect: rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : { x: 0, y: 0, width: 0, height: 0 },
        computedWidth: computed ? Number.parseFloat(computed.width) : 0,
        computedHeight: computed ? Number.parseFloat(computed.height) : 0,
        contentWidth: window.innerWidth,
        contentHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        devicePixelRatio: window.devicePixelRatio,
        fontsReady: !document.fonts || document.fonts.status === "loaded",
        imagesReady: Array.from(document.images).every(
          (image) => image.complete && (image.naturalWidth > 0 || !image.currentSrc)
        )
      };
    })()
  `);

  return parseCardGeometryProbe(rawProbe, window.webContents.getZoomFactor());
}

function parseCardGeometryProbe(rawProbe: unknown, zoomFactor: number): CardGeometryProbe {
  const record = isRecord(rawProbe) ? rawProbe : {};
  const rect = isRecord(record["rect"]) ? record["rect"] : {};
  return {
    cardExists: record["cardExists"] === true,
    rect: {
      x: numberOrNaN(rect["x"]),
      y: numberOrNaN(rect["y"]),
      width: numberOrNaN(rect["width"]),
      height: numberOrNaN(rect["height"])
    },
    computedWidth: numberOrNaN(record["computedWidth"]),
    computedHeight: numberOrNaN(record["computedHeight"]),
    contentWidth: numberOrNaN(record["contentWidth"]),
    contentHeight: numberOrNaN(record["contentHeight"]),
    documentWidth: numberOrNaN(record["documentWidth"]),
    documentHeight: numberOrNaN(record["documentHeight"]),
    devicePixelRatio: numberOrNaN(record["devicePixelRatio"]),
    zoomFactor,
    fontsReady: record["fontsReady"] === true,
    imagesReady: record["imagesReady"] === true
  };
}

function hasUnexpectedTransparentBorder(image: NativeImage): boolean {
  const size = image.getSize();
  const bitmap = image.toBitmap();
  if (size.width <= 0 || size.height <= 0 || bitmap.byteLength < size.width * size.height * 4) {
    return true;
  }

  const sampleCount = 24;
  for (let index = 0; index < sampleCount; index += 1) {
    const x = Math.round((index / (sampleCount - 1)) * (size.width - 1));
    const y = Math.round((index / (sampleCount - 1)) * (size.height - 1));
    if (
      readAlpha(bitmap, size.width, x, 0) < 250 ||
      readAlpha(bitmap, size.width, x, size.height - 1) < 250 ||
      readAlpha(bitmap, size.width, 0, y) < 250 ||
      readAlpha(bitmap, size.width, size.width - 1, y) < 250
    ) {
      return true;
    }
  }

  return false;
}

function readAlpha(bitmap: Buffer, width: number, x: number, y: number): number {
  return bitmap[(y * width + x) * 4 + 3] ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
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
  return isBlankBitmap(image.toBitmap());
}

export function isBlankBitmap(bitmap: Buffer): boolean {
  if (bitmap.byteLength < 4) {
    return true;
  }

  const pixelCount = Math.floor(bitmap.byteLength / 4);
  const sampleCount = Math.min(1_600, pixelCount);
  let firstBlue = 0;
  let firstGreen = 0;
  let firstRed = 0;
  let firstAlpha = 0;
  let foundVisiblePixel = false;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const pixelIndex =
      sampleCount === 1
        ? 0
        : Math.round((sampleIndex * (pixelCount - 1)) / (sampleCount - 1));
    const index = pixelIndex * 4;
    const alpha = readByte(bitmap, index + 3);
    if (alpha === 0) {
      continue;
    }

    if (!foundVisiblePixel) {
      firstBlue = readByte(bitmap, index);
      firstGreen = readByte(bitmap, index + 1);
      firstRed = readByte(bitmap, index + 2);
      firstAlpha = alpha;
      foundVisiblePixel = true;
      continue;
    }

    if (
      readByte(bitmap, index) !== firstBlue ||
      readByte(bitmap, index + 1) !== firstGreen ||
      readByte(bitmap, index + 2) !== firstRed ||
      alpha !== firstAlpha
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
  gateReport: QualityGateReport,
  captureReports: readonly RenderCaptureReport[]
): Promise<void> {
  await fs.writeFile(path.join(outputDir, "slots.json"), JSON.stringify(metrics, null, 2), "utf8");
  await fs.writeFile(
    path.join(outputDir, "gate-report.json"),
    JSON.stringify(gateReport, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "render-diagnostics.json"),
    JSON.stringify(captureReports, null, 2),
    "utf8"
  );
}

async function writeRenderError(
  outputDir: string,
  cardIndex: number,
  error: CardnewsError
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  const payload = isRenderFailure(error)
    ? { ...error.diagnostic, userMessage: error.message }
    : { cardIndex, code: error.code, message: error.message };
  await fs.writeFile(
    path.join(outputDir, "render-error.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

function createSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function renderFailed(message: string): CardnewsError {
  return { ok: false, code: "render_failed", message };
}

function renderFailure(
  input: RenderDeckInput,
  cardIndex: number,
  ratio: { readonly id: string; readonly width: number; readonly height: number },
  code: RenderDiagnosticCode,
  message: string,
  facts: {
    readonly capturedBitmap?: { readonly width: number; readonly height: number };
    readonly finalBitmap?: { readonly width: number; readonly height: number };
    readonly geometry?: CardGeometryProbe;
    readonly internalError?: unknown;
    readonly normalization: RenderNormalizationDiagnostic;
  }
): RenderFailure {
  return {
    ok: false,
    code: "render_failed",
    message,
    diagnostic: createRenderDiagnostic({
      appVersion: input.appVersion ?? process.env["npm_package_version"],
      aspectRatioId: ratio.id,
      ...(facts.capturedBitmap ? { capturedBitmap: facts.capturedBitmap } : {}),
      cardIndex,
      code,
      edition: input.edition,
      expected: { width: ratio.width, height: ratio.height },
      ...(facts.finalBitmap ? { finalBitmap: facts.finalBitmap } : {}),
      ...(facts.geometry ? { geometry: facts.geometry } : {}),
      ...(facts.internalError !== undefined ? { internalError: facts.internalError } : {}),
      normalization: facts.normalization
    })
  };
}

function toPublicError(error: CardnewsError): CardnewsError {
  return { ok: false, code: error.code, message: error.message };
}

function isRenderFailure(error: CardnewsError): error is RenderFailure {
  return "diagnostic" in error;
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
