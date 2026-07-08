// noqa: SIZE_OK - v4 release keeps the deterministic HTML/CSS template in one audited unit; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import { findAspectRatio } from "../domain/aspectRatios.js";
import type {
  Card,
  CardImageAdjust,
  CardLayer,
  CardLineLayer,
  CardLayoutOverride,
  CardOverride,
  CardTypographyOverride,
  ChromeConfig,
  ChromeSlotStyle,
  Deck
} from "../domain/types.js";
import { defaultChromeConfig, normalizeChromeConfig, renderPageNumber } from "../domain/chromeConfig.js";
import { getLineLayerRenderGeometry, normalizeLineLayer } from "../domain/lineLayer.js";
import { resolveStylePreset, type StylePreset } from "./stylePresets.js";

export type CardTemplateInput = {
  readonly assetCssUrls?: Readonly<Record<string, string>>;
  readonly backgroundCssUrl: string | undefined;
  readonly card: Card;
  readonly deck: Deck;
  readonly customStyles?: readonly StylePreset[];
  /** `@font-face` CSS 블록 — data URI(오프스크린 렌더) 또는 blob URL(미리보기) 소스 */
  readonly fontCss?: string;
  readonly override?: CardOverride;
};

type ResolvedTheme = {
  readonly preset: StylePreset;
  readonly accent: string;
  readonly dim: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly adjust: CardImageAdjust;
  readonly layout: CardLayoutOverride;
  readonly layers: readonly CardLayer[];
  readonly typography: ResolvedTypography;
  readonly chrome: ChromeConfig;
};

type ResolvedTypography = {
  readonly fontFamily: string | undefined;
  readonly italic: boolean | undefined;
  readonly sizeScale: number;
  readonly weight: number | undefined;
};

type FontFaceOptions = {
  readonly family?: string;
  readonly format?: "opentype" | "truetype" | "woff2" | "woff2-variations";
};

export function buildFontFaceCss(source: string, options: FontFaceOptions = {}): string {
  const family = options.family ?? "Pretendard";
  const format = options.format ?? "woff2-variations";
  return `@font-face {
        font-family: "${escapeAttribute(family)}";
        src: url("${escapeAttribute(source)}") format("${format}");
        font-weight: 100 900;
        font-style: normal;
        font-display: block;
      }`;
}

export function buildCardHtml(input: CardTemplateInput): string {
  const theme = resolveTheme(input.deck, input.customStyles ?? [], input.override);
  const { preset, accent, dim } = theme;
  const totalCards = input.deck.cards.length;
  const bodyNumber = computeBodyNumber(input.deck, input.card);
  const hasPhoto = Boolean(input.backgroundCssUrl);
  const textFit = computeTextFit(input.card);

  const photoLayer =
    input.backgroundCssUrl
      ? `<div class="photo" style="background-image: url(&quot;${escapeAttribute(input.backgroundCssUrl)}&quot;);"></div>
         <div class="scrim"></div>`
      : "";

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <style>
      ${input.fontCss ?? ""}
      ${buildCss(theme)}
    </style>
  </head>
  <body data-card-index="${input.card.index}">
    <article class="card ${preset.id} ${input.card.type}${hasPhoto ? " has-photo" : ""}${preset.usesPhoto ? " photo-preset" : " solid-preset"}" style="--title-scale: ${textFit.titleScale.toFixed(3)}; --body-scale: ${textFit.bodyScale.toFixed(3)}; --gap-scale: ${textFit.gapScale.toFixed(3)}; --chrome-scale: ${textFit.chromeScale.toFixed(3)}; --gap-badge-scale: ${theme.layout.gapBadge.toFixed(3)}; --gap-subtitle-scale: ${theme.layout.gapSubtitle.toFixed(3)};">
      ${photoLayer}
      ${renderLayers(theme, input.assetCssUrls ?? {})}
      ${renderHeaderChrome(input.deck, input.card, totalCards, theme)}
      <section class="content">
        ${renderCardBody(input.card, theme, bodyNumber)}
      </section>
      ${renderFooterChrome(input.deck, input.card, totalCards, theme)}
    </article>
    <script>
      window.__CARDNEWS_COLLECT_METRICS__ = function () {
        const cardIndex = Number(document.body.dataset.cardIndex || "0");
        return Array.from(document.querySelectorAll("[data-slot]")).map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const inlineFontSize = Number.parseFloat(element.style.fontSize) || 0;
          const dataFontSize = Number.parseFloat(element.getAttribute("data-font-size") || "") || 0;
          const styleAttribute = element.getAttribute("style") || "";
          const attributeFontSize =
            Number.parseFloat(
              styleAttribute
                .split(";")
                .map((part) => part.trim())
                .find((part) => part.startsWith("font-size:"))
                ?.slice("font-size:".length) || ""
            ) || 0;
          return {
            backgroundColor: element.getAttribute("data-background-color") || "${preset.textBackdrop}",
            cardIndex,
            color: style.color,
            fontSize: Math.max(Number.parseFloat(style.fontSize) || 0, inlineFontSize, dataFontSize, attributeFontSize),
            height: Math.round(rect.height * 100) / 100,
            left: Math.round(rect.left * 100) / 100,
            slot: element.getAttribute("data-slot") || "unknown",
            text: element.textContent || "",
            top: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100
          };
        });
      };
    </script>
  </body>
</html>`;
}

function resolveTheme(
  deck: Deck,
  customStyles: readonly StylePreset[],
  override: CardOverride | undefined
): ResolvedTheme {
  const preset = resolveStylePreset(deck.styleId, customStyles);
  const accent = normalizeHexColor(deck.accentColor) ?? preset.accentDefault;
  const dim = clamp01(override?.dim ?? deck.backgroundDim ?? preset.defaultDim);
  const ratio = findAspectRatio(deck.aspectRatio);
  return {
    preset,
    accent,
    dim,
    cardWidth: ratio.width,
    cardHeight: ratio.height,
    adjust: normalizeAdjust(override?.adjust),
    layout: normalizeLayout(override?.layout),
    layers: normalizeLayers(override?.layers),
    typography: normalizeTypography(override?.typography, Boolean(deck.fontId)),
    chrome: deck.chrome ? normalizeChromeConfig(deck.chrome) : defaultChromeForPreset(preset)
  };
}

function defaultChromeForPreset(preset: StylePreset): ChromeConfig {
  const chromeBackground = normalizeHexColor(preset.chromeBackdrop);
  const readableInk = chromeBackground ? pickReadableInk(chromeBackground) : defaultChromeConfig.header.color;
  return {
    header: { ...defaultChromeConfig.header, color: readableInk },
    footer: { ...defaultChromeConfig.footer, color: readableInk },
    pageNumber: { ...defaultChromeConfig.pageNumber, color: readableInk }
  };
}

function renderHeaderChrome(deck: Deck, card: Card, totalCards: number, theme: ResolvedTheme): string {
  const parts = [
    theme.chrome.header.visible
      ? `<span class="chrome-label" data-slot="header" data-background-color="${chromeBackdrop(theme)}" style="${escapeHtml(buildChromeSlotStyle(theme.chrome.header, theme))}">${escapeHtml(deck.headerLabel)}</span>`
      : "",
    theme.chrome.pageNumber.visible
      ? `<span class="page-no" data-slot="page" data-background-color="${chromeBackdrop(theme)}" style="${escapeHtml(buildChromeSlotStyle(theme.chrome.pageNumber, theme))}">${escapeHtml(renderPageNumber(theme.chrome.pageNumber.template, card.index, totalCards))}</span>`
      : ""
  ].join("");

  return parts.length > 0 ? `<div class="chrome header">${parts}</div>` : "";
}

function renderFooterChrome(deck: Deck, card: Card, totalCards: number, theme: ResolvedTheme): string {
  const footer = theme.chrome.footer.visible
    ? `<span data-slot="footer" data-background-color="${chromeBackdrop(theme)}" style="${escapeHtml(buildChromeSlotStyle(theme.chrome.footer, theme))}">${escapeHtml(deck.footerAccount)}</span>`
    : "";
  const nextHint =
    card.index < totalCards ? `<span class="next-hint">&gt;&gt;&gt;&gt;</span>` : `<span class="next-hint">■</span>`;
  return footer.length > 0 || nextHint.length > 0
    ? `<div class="chrome footer">${footer}${nextHint}</div>`
    : "";
}

function buildChromeSlotStyle(slot: ChromeSlotStyle, theme: ResolvedTheme): string {
  const family = slot.useDeckFont
    ? ` font-family: ${theme.typography.fontFamily ?? theme.preset.fontBody};`
    : "";
  return `color: ${slot.color}; font-size: ${Math.round(slot.fontSize)}px; font-weight: ${Math.round(slot.fontWeight)}; transform: translate(${Math.round(slot.offsetX)}px, ${Math.round(slot.offsetY)}px);${family}`;
}

function buildCss(theme: ResolvedTheme): string {
  const { preset, accent, dim, adjust, layout } = theme;
  const pageBackground = preset.pageBackground.replaceAll("__ACCENT__", accent);
  const bullet = resolveBulletShape(preset.bulletShape);
  const titleInk = preset.inkScale?.ink ?? preset.ink;
  const bodyInk = preset.inkScale?.body ?? preset.inkSub;
  const mutedInk = preset.inkScale?.mute ?? preset.inkMuted;
  const faintInk = preset.inkScale?.faint ?? preset.inkMuted;
  const surface = preset.surfaceLadder ?? [preset.textBackdrop, preset.chromeBackdrop, preset.textBackdrop];
  const badge = resolveEyebrowStyle(preset, accent, mutedInk);

  return `
      :root {
        --surface-1: ${surface[0]};
        --surface-2: ${surface[1]};
        --surface-3: ${surface[2]};
        --ink-title: ${titleInk};
        --ink-body: ${bodyInk};
        --ink-muted: ${mutedInk};
        --ink-faint: ${faintInk};
        color: var(--ink-title);
      }
      * { box-sizing: border-box; }
      body { margin: 0; overflow: hidden; }
      .card {
        --title-scale: 1;
        --body-scale: 1;
        --gap-scale: 1;
        --gap-badge-scale: 1;
        --gap-subtitle-scale: 1;
        --chrome-scale: 1;
        background: ${pageBackground};
        color: var(--ink-body);
        font-family: ${theme.typography.fontFamily ?? preset.fontBody};
        height: ${theme.cardHeight}px;
        overflow: hidden;
        position: relative;
        width: ${theme.cardWidth}px;
      }
      .photo {
        background-position: center;
        background-size: cover;
        filter: brightness(${adjust.brightness.toFixed(2)}) contrast(${adjust.contrast.toFixed(2)}) saturate(${adjust.saturation.toFixed(2)});
        inset: 0;
        position: absolute;
      }
      ${buildScrimCss(preset, dim)}
      .chrome {
        color: var(--ink-title);
        align-items: center;
        display: flex;
        font-size: calc(30px * var(--chrome-scale));
        font-weight: 800;
        justify-content: space-between;
        left: 84px;
        letter-spacing: 0.06em;
        position: absolute;
      right: 84px;
      z-index: 3;
      }
      .header { top: 80px; }
      .footer { bottom: 80px; }
      .chrome-label { text-transform: uppercase; }
      .page-no { color: var(--ink-title); font-weight: 700; opacity: 0.92; }
      .next-hint { color: ${accent}; font-weight: 900; letter-spacing: 0.2em; }
      .content {
        display: flex;
        flex-direction: column;
        inset: 0;
        position: absolute;
        padding: 190px 96px 170px;
        text-align: ${layout.align};
        transform: translateY(${layout.offsetY.toFixed(2)}%);
        z-index: 2;
      }
      ${
        preset.usesSurface
          ? `.content-inner {
        background: var(--surface-1);
        border: 4px solid ${preset.hairline ?? preset.ink};
        box-shadow: 18px 18px 0 var(--surface-3);
        padding: 78px 70px;
      }
      .cover .content { justify-content: center; }
      .body .content { justify-content: flex-start; }
      .cta .content { justify-content: center; }`
          : `.content-inner { padding: 0; }
      .cover .content { justify-content: flex-end; padding-bottom: 210px; }
      .body .content { justify-content: flex-start; padding-top: 230px; }
      .cta .content { justify-content: center; }`
      }
      .badge {
        align-self: ${layout.align === "center" ? "center" : "flex-start"};
        background: ${badge.background};
        border-left: ${badge.borderLeft};
        border-radius: ${badge.radius};
        color: ${badge.color};
        display: block;
        font-size: calc(26px * var(--body-scale));
        font-weight: 800;
        letter-spacing: 0.14em;
        margin-bottom: calc(40px * var(--gap-scale) * var(--gap-badge-scale));
        max-width: 100%;
        padding: ${badge.padding};
        text-transform: uppercase;
        width: fit-content;
      }
      .big-number {
        color: ${preset.numberInk ?? accent};
        font-size: calc(92px * var(--title-scale));
        font-weight: 900;
        line-height: 1;
        margin-bottom: calc(34px * var(--gap-scale));
      }
      h1 {
        color: var(--ink-title);
        font-family: ${theme.typography.fontFamily ?? preset.fontTitle};
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 900};
        letter-spacing: ${Math.max(0, preset.titleTracking ?? 0).toFixed(3)}em;
        margin: 0;
        overflow-wrap: anywhere;
        word-break: keep-all;
      }
      .cover h1 { font-size: calc(88px * var(--title-scale) * ${theme.typography.sizeScale.toFixed(3)}); line-height: 1.16; }
      .body h1 { font-size: calc(58px * var(--title-scale) * ${theme.typography.sizeScale.toFixed(3)}); line-height: 1.2; }
      .cta h1 { font-size: calc(72px * var(--title-scale) * ${theme.typography.sizeScale.toFixed(3)}); line-height: 1.18; }
      h1 .hl {
        background: linear-gradient(transparent 58%, ${withAlpha(accent, 0.45)} 58%);
        color: ${preset.usesSurface ? titleInk : accent};
        font-style: normal;
      }
      .subtitle {
        color: var(--ink-body);
        font-size: calc(40px * var(--body-scale) * ${theme.typography.sizeScale.toFixed(3)});
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 700};
        line-height: 1.35;
        margin-top: calc(36px * var(--gap-scale) * var(--gap-subtitle-scale));
        overflow-wrap: anywhere;
        word-break: keep-all;
      }
      .paragraphs {
        color: var(--ink-body);
        display: grid;
        font-size: calc(35px * var(--body-scale) * ${theme.typography.sizeScale.toFixed(3)});
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 600};
        gap: calc(24px * var(--gap-scale));
        line-height: 1.58;
        margin-top: calc(44px * var(--gap-scale) * var(--gap-subtitle-scale));
        overflow-wrap: anywhere;
        word-break: keep-all;
      }
      .paragraphs p { margin: 0; }
      .bullets {
        display: grid;
        gap: calc(24px * var(--gap-scale));
        list-style: none;
        margin: calc(44px * var(--gap-scale) * var(--gap-subtitle-scale)) 0 0;
        padding: 0;
      }
      .bullets li {
        color: var(--ink-body);
        font-size: calc(34px * var(--body-scale) * ${theme.typography.sizeScale.toFixed(3)});
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 700};
        line-height: 1.42;
        padding-left: 46px;
        position: relative;
        overflow-wrap: anywhere;
        word-break: keep-all;
      }
      .bullets li::before {
        background: ${accent};
        border-radius: ${bullet.radius};
        content: "";
        height: ${bullet.height}px;
        left: 0;
        position: absolute;
        top: ${bullet.top}px;
        width: ${bullet.width}px;
      }
      .emphasis {
        align-self: ${layout.align === "center" ? "center" : "flex-start"};
        background: ${accent};
        border-radius: ${preset.usesSurface ? "0" : "14px"};
        color: ${pickReadableInk(accent)};
        display: inline-block;
        font-size: calc(44px * var(--body-scale));
        font-weight: 900;
        line-height: 1.25;
        margin-top: calc(52px * var(--gap-scale));
        padding: 22px 34px;
        overflow-wrap: anywhere;
      }
      .source {
        color: var(--ink-muted);
        font-size: max(18px, calc(25px * var(--body-scale)));
        font-weight: 600;
        line-height: 1.3;
        margin-top: calc(42px * var(--gap-scale));
        overflow-wrap: anywhere;
      }
      .layer {
        overflow: hidden;
        pointer-events: none;
        position: absolute;
      }
      .layer-text {
        align-items: center;
        display: flex;
        line-height: 1.24;
        overflow-wrap: anywhere;
        padding: 10px 14px;
        white-space: pre-wrap;
        word-break: keep-all;
      }
      .layer-image {
        background-position: center;
        background-repeat: no-repeat;
      }
  `;
}

function renderLayers(
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>
): string {
  if (theme.layers.length === 0) {
    return "";
  }

  return theme.layers.map((layer) => renderLayer(layer, theme, assetCssUrls)).join("");
}

function renderLayer(
  layer: CardLayer,
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>
): string {
  switch (layer.kind) {
    case "text": {
      const baseStyle = buildLayerBaseStyle(layer);
      const color = normalizeHexColor(layer.color) ?? theme.preset.ink;
      const background = normalizeHexColor(layer.backgroundColor) ?? "transparent";
      const fontSize = Math.round(clampRange(layer.fontSize ?? 40, 10, 144));
      const fontWeight = Math.round(clampRange(layer.fontWeight ?? theme.typography.weight ?? 700, 100, 950));
      const align = layer.align ?? "left";
      const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
      const backdrop = background === "transparent" ? theme.preset.textBackdrop : background;
      const style = `${baseStyle} color: ${color}; background: ${background}; font-family: ${theme.typography.fontFamily ?? theme.preset.fontBody}; font-size: ${fontSize}px; font-style: ${layer.italic === true ? "italic" : "normal"}; font-weight: ${fontWeight}; justify-content: ${justify}; text-align: ${align};`;
      return `<div class="layer layer-text" data-slot="layer-${escapeAttribute(layer.id)}" data-background-color="${backdrop}" data-font-size="${fontSize}" style="${escapeHtml(style)}">${escapeHtml(layer.text)}</div>`;
    }
    case "shape": {
      const baseStyle = buildLayerBaseStyle(layer);
      const fill = normalizeHexColor(layer.fill) ?? withAlpha(theme.accent, 0.28);
      const stroke = normalizeHexColor(layer.stroke);
      const borderRadius = layer.shape === "ellipse" ? "9999px" : `${Math.round(clampRange(layer.radius ?? 0, 0, 80))}px`;
      const border = stroke ? `${Math.round(clampRange(layer.strokeWidth ?? 2, 1, 24))}px solid ${stroke}` : "0";
      return `<div class="layer layer-shape" style="${baseStyle} background: ${fill}; border: ${border}; border-radius: ${borderRadius};"></div>`;
    }
    case "line": {
      const geometry = getLineLayerRenderGeometry(layer, {
        width: theme.cardWidth,
        height: theme.cardHeight
      });
      const color = normalizeHexColor(layer.color) ?? theme.accent;
      const zIndex = Math.round(clampRange(layer.zIndex ?? defaultLayerZIndex(layer), 0, 20));
      const opacity = clamp01(layer.opacity ?? 1);
      const style = `left: ${geometry.leftPx.toFixed(3)}px; top: ${geometry.topPx.toFixed(3)}px; width: ${geometry.widthPx.toFixed(3)}px; height: ${geometry.heightPx}px; z-index: ${zIndex}; opacity: ${opacity.toFixed(3)}; transform: rotate(${geometry.angleDeg}deg); transform-origin: 0 50%; background: ${color};`;
      return `<div class="layer layer-line" style="${escapeHtml(style)}"></div>`;
    }
    case "image": {
      const baseStyle = buildLayerBaseStyle(layer);
      const source = assetCssUrls[layer.backgroundId];
      if (!source) {
        return `<div class="layer layer-image" style="${baseStyle} background: ${withAlpha(theme.accent, 0.16)};"></div>`;
      }
      return `<div class="layer layer-image" style="${baseStyle} background-image: url(&quot;${escapeAttribute(source)}&quot;); background-size: ${layer.objectFit ?? "cover"};"></div>`;
    }
  }
}

function buildLayerBaseStyle(layer: Exclude<CardLayer, CardLineLayer>): string {
  const left = clampRange(layer.x, 0, 100);
  const top = clampRange(layer.y, 0, 100);
  const width = clampRange(layer.width, 1, 100);
  const height = clampRange(layer.height, 1, 100);
  const zIndex = Math.round(clampRange(layer.zIndex ?? defaultLayerZIndex(layer), 0, 20));
  const opacity = clamp01(layer.opacity ?? 1);
  return `left: ${left.toFixed(3)}%; top: ${top.toFixed(3)}%; width: ${width.toFixed(3)}%; height: ${height.toFixed(3)}%; z-index: ${zIndex}; opacity: ${opacity.toFixed(3)};`;
}

function defaultLayerZIndex(layer: CardLayer): number {
  switch (layer.kind) {
    case "shape":
    case "image":
      return 1;
    case "line":
    case "text":
      return 4;
  }
}

function renderCardBody(
  card: Card,
  theme: ResolvedTheme,
  bodyNumber: number | undefined
): string {
  const backdrop = theme.preset.usesSurface ? theme.preset.textBackdrop : textBackdrop(theme);
  const emphasisBackdrop = theme.accent;

  const parts = [
    card.badge ? `<span class="badge">${escapeHtml(card.badge)}</span>` : "",
    card.type === "body" && bodyNumber !== undefined
      ? `<div class="big-number">${String(bodyNumber).padStart(2, "0")}</div>`
      : "",
    `<h1 data-slot="title" data-background-color="${backdrop}">${renderEmphasisText(card.title)}</h1>`,
    card.subtitle
      ? `<div class="subtitle" data-slot="subtitle" data-background-color="${backdrop}">${renderEmphasisText(card.subtitle)}</div>`
      : "",
    renderParagraphs(card, backdrop),
    renderBullets(card, backdrop),
    card.emphasis
      ? `<div class="emphasis" data-slot="emphasis" data-background-color="${emphasisBackdrop}">${escapeHtml(card.emphasis)}</div>`
      : "",
    card.source
      ? `<div class="source" data-slot="source" data-background-color="${backdrop}">출처: ${escapeHtml(card.source)}</div>`
      : ""
  ].join("");

  return `<div class="content-inner">${parts}</div>`;
}

function computeBodyNumber(deck: Deck, card: Card): number | undefined {
  if (card.type !== "body") {
    return undefined;
  }

  let count = 0;
  for (const candidate of deck.cards) {
    if (candidate.type === "body") {
      count += 1;
    }

    if (candidate.index === card.index) {
      return count;
    }
  }

  return count;
}

function renderParagraphs(card: Card, backdrop: string): string {
  if (card.paragraphs.length === 0) {
    return "";
  }

  return `<div class="paragraphs">${card.paragraphs
    .map(
      (paragraph) =>
        `<p data-slot="paragraph" data-background-color="${backdrop}">${renderEmphasisText(paragraph)}</p>`
    )
    .join("")}</div>`;
}

function renderBullets(card: Card, backdrop: string): string {
  if (card.bullets.length === 0) {
    return "";
  }

  return `<ul class="bullets">${card.bullets
    .map(
      (bullet) =>
        `<li data-slot="bullet" data-background-color="${backdrop}">${renderEmphasisText(bullet)}</li>`
    )
    .join("")}</ul>`;
}

function textBackdrop(theme: ResolvedTheme): string {
  return theme.preset.textBackdrop;
}

function chromeBackdrop(theme: ResolvedTheme): string {
  return theme.preset.chromeBackdrop;
}

type TextFit = {
  readonly bodyScale: number;
  readonly chromeScale: number;
  readonly gapScale: number;
  readonly titleScale: number;
};

function computeTextFit(card: Card): TextFit {
  const titleLength = visualTextLength(card.title);
  const subtitleLength = visualTextLength(card.subtitle ?? "");
  const paragraphLength = card.paragraphs.reduce((sum, paragraph) => sum + visualTextLength(paragraph), 0);
  const bulletLength = card.bullets.reduce((sum, bullet) => sum + visualTextLength(bullet), 0);
  const sourceLength = visualTextLength(card.source ?? "");
  const emphasisLength = visualTextLength(card.emphasis ?? "");
  const bodyItemPressure = Math.max(0, card.paragraphs.length + card.bullets.length - 3) * 0.12;

  const titleLimit = card.type === "cover" ? 32 : card.type === "cta" ? 30 : 28;
  const bodyLimit = card.type === "cover" ? 90 : card.type === "cta" ? 105 : 130;
  const titlePressure = Math.max(titleLength / titleLimit, subtitleLength / 54);
  const bodyPressure =
    (paragraphLength + bulletLength * 1.15 + sourceLength * 0.35 + emphasisLength * 0.7) / bodyLimit +
    bodyItemPressure;
  const pressure = Math.max(1, titlePressure, bodyPressure);
  const baseScale = clampRange(1 / pressure, 0.62, 1);
  const titleScale = clampRange(baseScale + (card.type === "body" ? 0.04 : 0), 0.64, 1);
  const bodyScale = clampRange(baseScale + 0.03, 0.64, 1);

  return {
    bodyScale,
    chromeScale: titleLength > 34 || subtitleLength > 60 ? 0.92 : 1,
    gapScale: clampRange(baseScale + 0.1, 0.72, 1),
    titleScale
  };
}

function visualTextLength(value: string): number {
  return Array.from(value.replace(/\*/g, "")).reduce((sum, char) => {
    if (/\s/.test(char)) {
      return sum + 0.3;
    }

    return sum + (char.charCodeAt(0) > 127 ? 1 : 0.55);
  }, 0);
}

/** `*단어*` 문법을 강조 하이라이트로 변환한다. escape 이후에 치환하므로 안전하다. */
function renderEmphasisText(value: string): string {
  return escapeHtml(value).replace(/\*([^*]+)\*/g, '<em class="hl">$1</em>');
}

function normalizeAdjust(adjust: CardImageAdjust | undefined): CardImageAdjust {
  return {
    brightness: clampRange(adjust?.brightness ?? 1, 0.5, 1.5),
    contrast: clampRange(adjust?.contrast ?? 1, 0.5, 1.5),
    saturation: clampRange(adjust?.saturation ?? 1, 0.5, 1.5)
  };
}

function normalizeTypography(
  typography: CardTypographyOverride | undefined,
  hasCustomFont: boolean
): ResolvedTypography {
  return {
    fontFamily: hasCustomFont
      ? "\"Cardnews User Font\", \"Pretendard\", \"Malgun Gothic\", sans-serif"
      : undefined,
    italic: typography?.italic,
    sizeScale: clampRange(typography?.sizeScale ?? 1, 0.65, 1.35),
    weight:
      typography?.weight === undefined
        ? undefined
        : Math.round(clampRange(typography.weight, 100, 950))
  };
}

function normalizeLayers(layers: readonly CardLayer[] | undefined): readonly CardLayer[] {
  return (layers ?? []).slice(0, 24).map((layer) => {
    if (layer.kind === "line") {
      return normalizeLineLayer(layer);
    }

    const base = {
      id: layer.id.trim() || "layer",
      x: clampRange(layer.x, 0, 100),
      y: clampRange(layer.y, 0, 100),
      width: clampRange(layer.width, 1, 100),
      height: clampRange(layer.height, 1, 100),
      ...(layer.zIndex !== undefined ? { zIndex: Math.round(clampRange(layer.zIndex, 0, 20)) } : {}),
      ...(layer.opacity !== undefined ? { opacity: clamp01(layer.opacity) } : {})
    };

    switch (layer.kind) {
      case "text":
        return {
          ...base,
          kind: "text",
          text: layer.text.slice(0, 500),
          ...(layer.color ? { color: layer.color } : {}),
          ...(layer.backgroundColor ? { backgroundColor: layer.backgroundColor } : {}),
          ...(layer.fontSize !== undefined ? { fontSize: clampRange(layer.fontSize, 10, 144) } : {}),
          ...(layer.fontWeight !== undefined ? { fontWeight: clampRange(layer.fontWeight, 100, 950) } : {}),
          ...(layer.italic !== undefined ? { italic: layer.italic } : {}),
          ...(layer.align ? { align: layer.align } : {})
        };
      case "shape":
        return {
          ...base,
          kind: "shape",
          shape: layer.shape,
          fill: layer.fill,
          ...(layer.stroke ? { stroke: layer.stroke } : {}),
          ...(layer.strokeWidth !== undefined ? { strokeWidth: clampRange(layer.strokeWidth, 1, 24) } : {}),
          ...(layer.radius !== undefined ? { radius: clampRange(layer.radius, 0, 80) } : {})
        };
      case "image":
        return {
          ...base,
          kind: "image",
          backgroundId: layer.backgroundId,
          ...(layer.objectFit ? { objectFit: layer.objectFit } : {})
        };
    }
  });
}

function normalizeLayout(layout: CardLayoutOverride | undefined): CardLayoutOverride {
  return {
    align: layout?.align === "center" ? "center" : "left",
    offsetY: clampRange(layout?.offsetY ?? 0, -20, 20),
    gapBadge: clampRange(layout?.gapBadge ?? 1, 0.5, 2),
    gapSubtitle: clampRange(layout?.gapSubtitle ?? 1, 0.5, 2)
  };
}

function resolveBulletShape(shape: StylePreset["bulletShape"]): {
  readonly height: number;
  readonly radius: string;
  readonly top: number;
  readonly width: number;
} {
  if (shape === "dash") {
    return { height: 5, radius: "0", top: 22, width: 26 };
  }

  if (shape === "square") {
    return { height: 15, radius: "0", top: 16, width: 15 };
  }

  return { height: 15, radius: "50%", top: 16, width: 15 };
}

function buildScrimCss(preset: StylePreset, dim: number): string {
  const stops =
    preset.scrimStops && preset.scrimStops.length > 0
      ? scaleScrimStops(preset.scrimStops, dim, preset.defaultDim)
      : [
          `rgba(10, 10, 14, ${(dim * 0.55).toFixed(2)}) 0%`,
          `rgba(10, 10, 14, ${(dim * 0.75).toFixed(2)}) 45%`,
          `rgba(10, 10, 14, ${Math.min(1, dim + 0.25).toFixed(2)}) 100%`
        ];

  if (preset.id === "newsprint" && (!preset.scrimStops || preset.scrimStops.length === 0)) {
    return `.scrim { background: rgba(248, 244, 232, ${dim.toFixed(2)}); inset: 0; position: absolute; }`;
  }

  return `.scrim {
        background: linear-gradient(180deg, ${stops.join(", ")});
        inset: 0;
        position: absolute;
      }`;
}

function scaleScrimStops(stops: readonly string[], dim: number, defaultDim: number): readonly string[] {
  const scale = defaultDim > 0 ? dim / defaultDim : 1;
  return stops.map((stop) =>
    stop.replace(/rgba\(([^)]+),\s*([0-9.]+)\)/g, (_match, channels: string, alphaText: string) => {
      const alpha = Number.parseFloat(alphaText);
      if (Number.isNaN(alpha)) {
        return `rgba(${channels}, ${alphaText})`;
      }

      return `rgba(${channels}, ${Math.min(1, Math.max(0, alpha * scale)).toFixed(2)})`;
    })
  );
}

function resolveEyebrowStyle(
  preset: StylePreset,
  accent: string,
  mutedInk: string
): {
  readonly background: string;
  readonly borderLeft: string;
  readonly color: string;
  readonly padding: string;
  readonly radius: string;
} {
  if (preset.eyebrowStyle === "bar") {
    return {
      background: "transparent",
      borderLeft: `12px solid ${accent}`,
      color: accent,
      padding: "10px 0 10px 18px",
      radius: "0"
    };
  }

  if (preset.eyebrowStyle === "plain") {
    return {
      background: "transparent",
      borderLeft: "0",
      color: mutedInk,
      padding: "0",
      radius: "0"
    };
  }

  return {
    background: preset.badgeBackground,
    borderLeft: "0",
    color: preset.badgeInk,
    padding: "14px 30px",
    radius: preset.badgeRadius ?? "999px"
  };
}

function normalizeHexColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, minimum: number, maximum: number): number {
  if (Number.isNaN(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

function withAlpha(hexColor: string, alpha: number): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function pickReadableInk(hexColor: string): string {
  // WCAG 대비비 기준으로 흰색/검은색 중 더 잘 읽히는 잉크를 고른다 (대비 게이트와 동일 수식).
  const backgroundLuminance = relativeLuminance(hexColor);
  const whiteContrast = (1.0 + 0.05) / (backgroundLuminance + 0.05);
  const blackContrast = (backgroundLuminance + 0.05) / (relativeLuminance("#141414") + 0.05);
  return whiteContrast >= blackContrast ? "#ffffff" : "#141414";
}

function relativeLuminance(hexColor: string): number {
  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', "%22");
}
