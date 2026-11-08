// noqa: SIZE_OK - v4 release keeps the deterministic HTML/CSS template in one audited unit; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import { findAspectRatio } from "../domain/aspectRatios.js";
import { resolveBodyNumber, type ResolvedBodyNumber } from "../domain/bodyNumber.js";
import { isHexColor, normalizeHexColor } from "../domain/colors.js";
import type {
  BodyNumberTextStyle,
  Card,
  CardBadgeOverride,
  CardImageAdjust,
  CardLayer,
  CardLineLayer,
  CardLayoutOverride,
  CardOverride,
  CardTypographyOverride,
  ChromeConfig,
  ChromeSlotStyle,
  Deck,
  NextHintConfig
} from "../domain/types.js";
import { defaultChromeConfig, normalizeChromeConfig, renderPageNumber } from "../domain/chromeConfig.js";
import { getLineLayerRenderGeometry, normalizeLineLayer } from "../domain/lineLayer.js";
import {
  normalizeSemanticItemPlacement,
  normalizeSemanticSlotPlacement,
  normalizeVideoLayer
} from "../domain/media.js";
import { resolveEffectiveCardBackgroundMedia } from "../domain/mediaResolver.js";
import {
  buildSemanticItemManifest,
  createSemanticItemId,
  type SemanticItemManifestEntry
} from "../domain/m23Semantic.js";
import { buildSemanticPlacementRuntimeScript } from "./semanticPlacement.js";
import { resolveStylePreset, type StylePreset } from "./stylePresets.js";

export type CardTemplateInput = {
  readonly assetCssUrls?: Readonly<Record<string, string>>;
  readonly backgroundCssUrl: string | undefined;
  readonly card: Card;
  readonly deck: Deck;
  readonly customStyles?: readonly StylePreset[];
  /** `@font-face` CSS 블록 — data URI(오프스크린 렌더) 또는 blob URL(미리보기) 소스 */
  readonly fontCss?: string;
  readonly liveVideo?: boolean;
  readonly override?: CardOverride;
};

type ResolvedTheme = {
  readonly preset: StylePreset;
  readonly accent: string;
  readonly dim: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly adjust: CardImageAdjust;
  readonly badge: ResolvedBadge;
  readonly layout: ResolvedLayout;
  readonly layers: readonly CardLayer[];
  readonly nextHint: ResolvedNextHint;
  readonly typography: ResolvedTypography;
  readonly chrome: ChromeConfig;
  readonly mediaAssets: Deck["mediaAssets"];
  readonly bodyNumberStyle: BodyNumberTextStyle | undefined;
};

type ResolvedLayout = CardLayoutOverride & {
  readonly semanticSlots: {
    readonly badge: ReturnType<typeof normalizeSemanticSlotPlacement>;
    readonly body: ReturnType<typeof normalizeSemanticSlotPlacement>;
    readonly footer: ReturnType<typeof normalizeSemanticSlotPlacement>;
    readonly subtitle: ReturnType<typeof normalizeSemanticSlotPlacement>;
    readonly title: ReturnType<typeof normalizeSemanticSlotPlacement>;
  };
};

type ResolvedBadge = {
  readonly shape: "pill" | "rect" | "none" | undefined;
  readonly imageId: string | undefined;
  readonly imageHeight: number;
  readonly textColor: string | undefined;
};

type ResolvedNextHint = {
  readonly kind: "arrows" | "image" | "none";
  readonly imageId: string | undefined;
  readonly height: number;
};

type ResolvedTypography = {
  readonly color: string | undefined;
  readonly fontFamily: string | undefined;
  readonly italic: boolean | undefined;
  readonly letterSpacing: number;
  readonly lineHeight: number;
  readonly sizeScale: number;
  readonly scope: "all" | "title" | "body";
  readonly weight: number | undefined;
  readonly textOpacity: number;
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
  const bodyNumber = resolveBodyNumber(input.deck, input.card, input.override);
  const resolvedBackground = resolveEffectiveCardBackgroundMedia(input.deck, input.card, input.override);
  const backgroundMediaUrl =
    resolvedBackground.status === "asset" ? input.assetCssUrls?.[resolvedBackground.asset.id] : undefined;
  const effectiveBackgroundCssUrl = backgroundMediaUrl ?? input.backgroundCssUrl;
  const hasPhoto = Boolean(effectiveBackgroundCssUrl);
  const textFit = computeTextFit(input.card);
  const semanticItems = buildSemanticItemManifest({
    card: input.card,
    footerAccount: input.deck.footerAccount,
    ...(input.override ? { override: input.override } : {})
  });

  const isLiveBackgroundVideo =
    input.liveVideo === true &&
    resolvedBackground.status === "asset" &&
    resolvedBackground.asset.kind === "video";
  const backgroundMediaId =
    resolvedBackground.status === "asset" ? resolvedBackground.asset.id : "";
  const photoLayer = effectiveBackgroundCssUrl
    ? isLiveBackgroundVideo
      ? `<video class="photo live-card-video" data-slot="background" data-media-kind="video" data-media-id="${escapeAttribute(backgroundMediaId)}" data-clip-start-ms="0" data-clip-end-ms="" src="${escapeAttribute(effectiveBackgroundCssUrl)}" autoplay muted playsinline preload="auto"></video>
         <div class="scrim"></div>`
      : resolvedBackground.status === "asset" && resolvedBackground.asset.kind === "video"
        ? `<div class="photo video-poster" data-slot="background" data-media-kind="video" data-media-id="${escapeAttribute(backgroundMediaId)}"></div>
           <div class="scrim"></div>`
        : `<div class="photo" data-slot="background" data-media-kind="image" data-media-id="${escapeAttribute(backgroundMediaId)}" style="background-image: url(&quot;${escapeAttribute(effectiveBackgroundCssUrl)}&quot;);"></div>
           <div class="scrim"></div>`
    : "";

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <style>
      ${input.fontCss ?? ""}
      ${buildCss(theme)}
      ${buildSemanticItemPlacementCss(input.override?.semanticItemPlacements)}
    </style>
  </head>
  <body data-card-index="${input.card.index}">
    <article class="card ${preset.id} ${input.card.type}${hasPhoto ? " has-photo" : ""}${preset.usesPhoto ? " photo-preset" : " solid-preset"}" style="--title-scale: ${textFit.titleScale.toFixed(3)}; --body-scale: ${textFit.bodyScale.toFixed(3)}; --gap-scale: ${textFit.gapScale.toFixed(3)}; --chrome-scale: ${textFit.chromeScale.toFixed(3)}; --gap-badge-scale: ${theme.layout.gapBadge.toFixed(3)}; --gap-subtitle-scale: ${theme.layout.gapSubtitle.toFixed(3)};">
      ${photoLayer}
      ${renderLayers(theme, input.assetCssUrls ?? {}, input.liveVideo === true)}
      ${renderHeaderChrome(input.deck, input.card, totalCards, theme)}
      ${renderDirectTitle(input.card, theme)}
      <section class="content">
        ${renderCardBody(input.card, theme, bodyNumber, input.assetCssUrls ?? {}, semanticItems)}
      </section>
      ${renderFooterChrome(input.deck, input.card, totalCards, theme, input.assetCssUrls ?? {})}
    </article>
    <script>
      ${buildSemanticPlacementRuntimeScript()}
      for (const video of document.querySelectorAll("video.live-card-video")) {
        const clipStartSeconds = Math.max(0, Number(video.dataset.clipStartMs || "0") / 1000);
        const rawClipEndMs = Number(video.dataset.clipEndMs || "");
        const clipEndSeconds = Number.isFinite(rawClipEndMs) && rawClipEndMs > 0 ? rawClipEndMs / 1000 : null;
        video.addEventListener("loadedmetadata", () => {
          if (clipStartSeconds > 0 && video.currentTime < clipStartSeconds) {
            video.currentTime = Math.min(clipStartSeconds, video.duration || clipStartSeconds);
          }
          void video.play().catch(() => undefined);
        }, { once: true });
        video.addEventListener("timeupdate", () => {
          if (clipEndSeconds !== null && video.currentTime >= clipEndSeconds) {
            video.currentTime = Math.max(clipStartSeconds, clipEndSeconds - (1 / 30));
            video.pause();
          }
        });
      }
      window.__CARDNEWS_COLLECT_METRICS__ = function () {
        const cardIndex = Number(document.body.dataset.cardIndex || "0");
        return Array.from(document.querySelectorAll("[data-semantic-item-id], [data-slot]")).map((element) => {
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
            semanticItemId: element.getAttribute("data-semantic-item-id") || "",
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
  const accent = preserveHexColor(deck.accentColor) ?? preset.accentDefault;
  const dim = clamp01(override?.dim ?? deck.backgroundDim ?? preset.defaultDim);
  const ratio = findAspectRatio(deck.aspectRatio);
  return {
    preset,
    accent,
    dim,
    cardWidth: ratio.width,
    cardHeight: ratio.height,
    adjust: normalizeAdjust(override?.adjust),
    badge: normalizeBadge(override?.badge),
    layout: normalizeLayout(override),
    layers: normalizeLayers(override?.layers),
    nextHint: normalizeNextHint(deck.nextHint),
    typography: normalizeTypography(override?.typography, Boolean(deck.fontId)),
    chrome: deck.chrome ? normalizeChromeConfig(deck.chrome) : defaultChromeForPreset(preset),
    mediaAssets: deck.mediaAssets,
    bodyNumberStyle: override?.bodyNumberStyle
  };
}

function defaultChromeForPreset(preset: StylePreset): ChromeConfig {
  const chromeBackground = preserveHexColor(preset.chromeBackdrop);
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
      ? `<span class="chrome-label" data-slot="header" data-semantic-item-id="${createSemanticItemId(card.index, "header")}" data-background-color="${chromeBackdrop(theme)}" style="${escapeHtml(buildChromeSlotStyle(theme.chrome.header, theme))}">${escapeHtml(deck.headerLabel)}</span>`
      : "",
    theme.chrome.pageNumber.visible
      ? `<span class="page-no" data-slot="page" data-semantic-item-id="${createSemanticItemId(card.index, "page-number")}" data-background-color="${chromeBackdrop(theme)}" style="${escapeHtml(buildChromeSlotStyle(theme.chrome.pageNumber, theme))}">${escapeHtml(renderPageNumber(theme.chrome.pageNumber.template, card.index, totalCards))}</span>`
      : ""
  ].join("");

  return parts.length > 0 ? `<div class="chrome header">${parts}</div>` : "";
}

function renderFooterChrome(
  deck: Deck,
  card: Card,
  totalCards: number,
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>
): string {
  const footerPlacement = theme.layout.semanticSlots.footer;
  const footerPlaced = footerPlacement.mode === "card";
  const footerStyle = `${buildChromeSlotStyle(theme.chrome.footer, theme)}${buildSemanticSlotStyle(footerPlacement, "footer", theme)}`;
  const footer = theme.chrome.footer.visible
    ? `<span class="footer-label${footerPlaced ? " placed" : ""}" data-slot="footer" data-semantic-item-id="${createSemanticItemId(card.index, "footer")}" data-background-color="${chromeBackdrop(theme)}" style="${escapeHtml(footerStyle)}">${escapeHtml(deck.footerAccount)}</span>`
    : "";
  const nextHint = renderNextHint(card, totalCards, theme, assetCssUrls);
  return footer.length > 0 || nextHint.length > 0
    ? `<div class="chrome footer${footerPlaced ? " placed" : ""}">${footer}${nextHint}</div>`
    : "";
}

function renderNextHint(
  card: Card,
  totalCards: number,
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>
): string {
  const nextHint = theme.nextHint;
  if (card.index >= totalCards || nextHint.kind === "none") {
    return "";
  }

  if (nextHint.kind === "image") {
    const imageSource = nextHint.imageId ? assetCssUrls[nextHint.imageId] : undefined;
    return imageSource
      ? `<img class="next-hint-image" data-slot="next-hint-image" data-semantic-item-id="${createSemanticItemId(card.index, "next-hint")}" src="${escapeAttribute(imageSource)}" alt="" style="display: block; height: ${nextHint.height}px; max-width: 96px; object-fit: contain; width: auto;" />`
      : "";
  }

  return `<span class="next-hint" data-slot="next-hint" data-semantic-item-id="${createSemanticItemId(card.index, "next-hint")}" style="color: ${theme.accent}; font-weight: 900; letter-spacing: 0.2em;">&gt;&gt;&gt;&gt;</span>`;
}

function buildChromeSlotStyle(slot: ChromeSlotStyle, theme: ResolvedTheme): string {
  const family = slot.useDeckFont
    ? ` font-family: ${theme.typography.fontFamily ?? theme.preset.fontBody};`
    : "";
  return `color: ${slot.color}; font-size: ${Math.round(slot.fontSize)}px; font-weight: ${Math.round(slot.fontWeight)}; transform: translate(${Math.round(slot.offsetX)}px, ${Math.round(slot.offsetY)}px);${family}`;
}

function renderDirectTitle(card: Card, theme: ResolvedTheme): string {
  const placement = theme.layout.titlePlacement;
  if (placement?.mode !== "card-y") {
    return "";
  }
  const y = clampRange(placement.y, 0, 100);
  const backdrop = theme.preset.usesSurface ? theme.preset.textBackdrop : textBackdrop(theme);
  return `<h1 class="title-direct" data-slot="title-direct" data-semantic-item-id="${createSemanticItemId(card.index, "title")}" data-background-color="${backdrop}" style="top: ${y.toFixed(2)}%; transform: translateY(-${y.toFixed(2)}%);">${renderRichText(card.title)}</h1>`;
}

function buildCss(theme: ResolvedTheme): string {
  const { preset, accent, dim, adjust, layout } = theme;
  const pageBackground = preset.pageBackground.replaceAll("__ACCENT__", accent);
  const bullet = resolveBulletShape(preset.bulletShape);
  const defaultTitleInk = preset.inkScale?.ink ?? preset.ink;
  const defaultBodyInk = preset.inkScale?.body ?? preset.inkSub;
  const titleInk =
    theme.typography.color && theme.typography.scope !== "body" ? theme.typography.color : defaultTitleInk;
  const bodyInk =
    theme.typography.color && theme.typography.scope !== "title" ? theme.typography.color : defaultBodyInk;
  const mutedInk = preset.inkScale?.mute ?? preset.inkMuted;
  const faintInk = preset.inkScale?.faint ?? preset.inkMuted;
  const surface = preset.surfaceLadder ?? [preset.textBackdrop, preset.chromeBackdrop, preset.textBackdrop];
  const badge = resolveEyebrowStyle(preset, accent, mutedInk);
  const titleLetterSpacing =
    theme.typography.scope === "body" ? Math.max(0, preset.titleTracking ?? 0) : theme.typography.letterSpacing;
  const bodyLetterSpacing = theme.typography.scope === "title" ? 0 : theme.typography.letterSpacing;
  const titleLineHeight = theme.typography.scope === "body" ? 1 : theme.typography.lineHeight;
  const bodyLineHeight = theme.typography.scope === "title" ? 1 : theme.typography.lineHeight;
  const titleTextOpacity = theme.typography.scope === "body" ? 100 : theme.typography.textOpacity;
  const bodyTextOpacity = theme.typography.scope === "title" ? 100 : theme.typography.textOpacity;

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
      video.photo {
        height: 100%;
        object-fit: cover;
        width: 100%;
      }
      .video-poster {
        background: color-mix(in srgb, var(--surface-2) 78%, black);
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
      .footer.placed { inset: 0; pointer-events: none; }
      .footer-label.placed { pointer-events: auto; position: absolute; white-space: nowrap; }
      .chrome-label { text-transform: uppercase; }
      .page-no { color: var(--ink-title); font-weight: 700; opacity: 0.92; }
      .content {
        display: flex;
        flex-direction: column;
        bottom: ${(-layout.offsetY).toFixed(2)}%;
        left: 0;
        position: absolute;
        padding: 190px 96px 170px;
        right: 0;
        text-align: ${layout.align};
        top: ${layout.offsetY.toFixed(2)}%;
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
        background: ${theme.badge.shape === "none" ? "transparent" : badge.background};
        border-left: ${theme.badge.shape === "none" ? "0" : badge.borderLeft};
        border-radius: ${badgeRadius(theme.badge, badge.radius)};
        color: ${theme.badge.textColor ?? badge.color};
        display: block;
        font-size: calc(26px * var(--body-scale));
        font-weight: 800;
        letter-spacing: 0.14em;
        margin-bottom: calc(40px * var(--gap-scale) * var(--gap-badge-scale));
        max-width: 100%;
        padding: ${theme.badge.shape === "none" ? "0" : badge.padding};
        width: fit-content;
      }
      .badge-image {
        align-self: ${layout.align === "center" ? "center" : "flex-start"};
        display: block;
        height: ${theme.badge.imageHeight}px;
        margin-bottom: calc(40px * var(--gap-scale) * var(--gap-badge-scale));
        max-width: 100%;
        object-fit: contain;
        width: auto;
      }
      .big-number {
        color: ${preset.numberInk ?? accent};
        font-size: calc(92px * var(--title-scale));
        font-weight: 900;
        line-height: 1;
        margin-bottom: calc(34px * var(--gap-scale));
      }
      h1 {
        color: color-mix(in srgb, var(--ink-title) ${titleTextOpacity.toFixed(1)}%, transparent);
        font-family: ${theme.typography.fontFamily ?? preset.fontTitle};
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 900};
        letter-spacing: ${titleLetterSpacing.toFixed(3)}em;
        margin: 0;
        overflow-wrap: anywhere;
        word-break: keep-all;
      }
      .title-placeholder { visibility: hidden; }
      .title-direct {
        left: 96px;
        position: absolute;
        right: 96px;
        text-align: ${layout.align};
        z-index: 5;
      }
      .cover h1 { font-size: calc(88px * var(--title-scale) * ${theme.typography.sizeScale.toFixed(3)}); line-height: ${(1.16 * titleLineHeight).toFixed(3)}; }
      .body h1 { font-size: calc(58px * var(--title-scale) * ${theme.typography.sizeScale.toFixed(3)}); line-height: ${(1.2 * titleLineHeight).toFixed(3)}; }
      .cta h1 { font-size: calc(72px * var(--title-scale) * ${theme.typography.sizeScale.toFixed(3)}); line-height: ${(1.18 * titleLineHeight).toFixed(3)}; }
      h1 .hl {
        background: linear-gradient(transparent 58%, ${withAlpha(accent, 0.45)} 58%);
        color: ${preset.usesSurface ? titleInk : accent};
        font-style: normal;
      }
      .subtitle {
        color: color-mix(in srgb, var(--ink-body) ${bodyTextOpacity.toFixed(1)}%, transparent);
        font-size: calc(40px * var(--body-scale) * ${theme.typography.sizeScale.toFixed(3)});
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 700};
        letter-spacing: ${bodyLetterSpacing.toFixed(3)}em;
        line-height: ${(1.35 * bodyLineHeight).toFixed(3)};
        margin-top: calc(36px * var(--gap-scale) * var(--gap-subtitle-scale));
        overflow-wrap: anywhere;
        word-break: keep-all;
      }
      .paragraphs {
        color: color-mix(in srgb, var(--ink-body) ${bodyTextOpacity.toFixed(1)}%, transparent);
        display: grid;
        font-size: calc(35px * var(--body-scale) * ${theme.typography.sizeScale.toFixed(3)});
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 600};
        gap: calc(24px * var(--gap-scale));
        letter-spacing: ${bodyLetterSpacing.toFixed(3)}em;
        line-height: ${(1.58 * bodyLineHeight).toFixed(3)};
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
        color: color-mix(in srgb, var(--ink-body) ${bodyTextOpacity.toFixed(1)}%, transparent);
        font-size: calc(34px * var(--body-scale) * ${theme.typography.sizeScale.toFixed(3)});
        font-style: ${theme.typography.italic === true ? "italic" : "normal"};
        font-weight: ${theme.typography.weight ?? 700};
        letter-spacing: ${bodyLetterSpacing.toFixed(3)}em;
        line-height: ${(1.42 * bodyLineHeight).toFixed(3)};
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
        color: color-mix(in srgb, ${pickReadableInk(accent)} ${bodyTextOpacity.toFixed(1)}%, transparent);
        display: inline-block;
        font-size: calc(44px * var(--body-scale));
        font-weight: 900;
        letter-spacing: ${bodyLetterSpacing.toFixed(3)}em;
        line-height: ${(1.25 * bodyLineHeight).toFixed(3)};
        margin-top: calc(52px * var(--gap-scale));
        padding: 22px 34px;
        overflow-wrap: anywhere;
      }
      .source {
        color: color-mix(in srgb, var(--ink-muted) ${bodyTextOpacity.toFixed(1)}%, transparent);
        font-size: max(18px, calc(25px * var(--body-scale)));
        font-weight: 600;
        letter-spacing: ${bodyLetterSpacing.toFixed(3)}em;
        line-height: ${(1.3 * bodyLineHeight).toFixed(3)};
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
      .layer-video {
        background-position: center;
        background-repeat: no-repeat;
      }
  `;
}

function renderLayers(
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>,
  liveVideo: boolean
): string {
  if (theme.layers.length === 0) {
    return "";
  }

  return theme.layers.map((layer) => renderLayer(layer, theme, assetCssUrls, liveVideo)).join("");
}

function renderLayer(
  layer: CardLayer,
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>,
  liveVideo: boolean
): string {
  switch (layer.kind) {
    case "text": {
      const baseStyle = buildLayerBaseStyle(layer);
      const color = preserveHexColor(layer.color) ?? theme.preset.ink;
      const background = preserveHexColor(layer.backgroundColor) ?? "transparent";
      const fontSize = Math.round(clampRange(layer.fontSize ?? 40, 10, 144));
      const fontWeight = Math.round(clampRange(layer.fontWeight ?? theme.typography.weight ?? 700, 100, 950));
      const align = layer.align ?? "left";
      const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
      const backdrop = background === "transparent" ? theme.preset.textBackdrop : background;
      const style = `${baseStyle} color: ${color}; background: ${background}; font-family: ${theme.typography.fontFamily ?? theme.preset.fontBody}; font-size: ${fontSize}px; font-style: ${layer.italic === true ? "italic" : "normal"}; font-weight: ${fontWeight}; justify-content: ${justify}; text-align: ${align};`;
      const textOpacity = clampRange(layer.textOpacity ?? 100, 0, 100) / 100;
      return `<div class="layer layer-text" data-slot="layer-${escapeAttribute(layer.id)}" data-editor-layer-id="${escapeAttribute(layer.id)}" data-background-color="${backdrop}" data-font-size="${fontSize}" style="${escapeHtml(style)}"><span data-layer-text="${escapeAttribute(layer.id)}" style="opacity: ${textOpacity.toFixed(3)};">${escapeHtml(layer.text)}</span></div>`;
    }
    case "shape": {
      const baseStyle = buildLayerBaseStyle(layer);
      const fill = preserveHexColor(layer.fill) ?? withAlpha(theme.accent, 0.28);
      const stroke = preserveHexColor(layer.stroke);
      const borderRadius = layer.shape === "ellipse" ? "9999px" : `${Math.round(clampRange(layer.radius ?? 0, 0, 80))}px`;
      const border = stroke ? `${Math.round(clampRange(layer.strokeWidth ?? 2, 1, 24))}px solid ${stroke}` : "0";
      return `<div class="layer layer-shape" data-editor-layer-id="${escapeAttribute(layer.id)}" style="${baseStyle} background: ${fill}; border: ${border}; border-radius: ${borderRadius};"></div>`;
    }
    case "line": {
      const geometry = getLineLayerRenderGeometry(layer, {
        width: theme.cardWidth,
        height: theme.cardHeight
      });
      const color = preserveHexColor(layer.color) ?? theme.accent;
      const zIndex = Math.round(clampRange(layer.zIndex ?? defaultLayerZIndex(layer), 0, 20));
      const opacity = clamp01(layer.opacity ?? 1);
      const style = `left: ${geometry.leftPx.toFixed(3)}px; top: ${geometry.topPx.toFixed(3)}px; width: ${geometry.widthPx.toFixed(3)}px; height: ${geometry.heightPx}px; z-index: ${zIndex}; opacity: ${opacity.toFixed(3)}; transform: rotate(${geometry.angleDeg}deg); transform-origin: 0 50%; background: ${color};`;
      return `<div class="layer layer-line" data-editor-layer-id="${escapeAttribute(layer.id)}" style="${escapeHtml(style)}"></div>`;
    }
    case "image": {
      const baseStyle = buildLayerBaseStyle(layer);
      const source = assetCssUrls[layer.backgroundId];
      if (!source) {
        return `<div class="layer layer-image" data-editor-layer-id="${escapeAttribute(layer.id)}" style="${baseStyle} background: ${withAlpha(theme.accent, 0.16)};"></div>`;
      }
      return `<div class="layer layer-image" data-editor-layer-id="${escapeAttribute(layer.id)}" style="${baseStyle} background-image: url(&quot;${escapeAttribute(source)}&quot;); background-size: ${layer.objectFit ?? "cover"};"></div>`;
    }
    case "video": {
      const normalized = normalizeVideoLayer(layer, theme.mediaAssets?.find((asset) => asset.id === layer.mediaId)?.durationMs);
      const baseStyle = buildLayerBaseStyle(normalized);
      const source = assetCssUrls[normalized.mediaId];
      if (source && liveVideo) {
        return `<video class="layer layer-video live-card-video" data-slot="layer-${escapeAttribute(normalized.id)}" data-editor-layer-id="${escapeAttribute(normalized.id)}" data-media-kind="video" data-media-id="${escapeAttribute(normalized.mediaId)}" data-clip-start-ms="${normalized.clipStartMs}" data-clip-end-ms="${normalized.clipEndMs ?? ""}" data-volume="${normalized.volume.toFixed(3)}" src="${escapeAttribute(source)}" autoplay muted playsinline preload="auto" style="${baseStyle} object-fit: ${normalized.objectFit};"></video>`;
      }
      const posterStyle = source
        ? `background: color-mix(in srgb, ${withAlpha(theme.accent, 0.22)} 70%, black);`
        : `background: ${withAlpha(theme.accent, 0.16)};`;
      return `<div class="layer layer-video" data-slot="layer-${escapeAttribute(normalized.id)}" data-editor-layer-id="${escapeAttribute(normalized.id)}" data-media-kind="video" data-media-id="${escapeAttribute(normalized.mediaId)}" data-clip-start-ms="${normalized.clipStartMs}" data-clip-end-ms="${normalized.clipEndMs ?? ""}" data-volume="${normalized.volume.toFixed(3)}" style="${baseStyle} ${posterStyle}"></div>`;
    }
  }

  return "";
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
    case "video":
      return 1;
    case "line":
    case "text":
      return 4;
  }
}

function renderCardBody(
  card: Card,
  theme: ResolvedTheme,
  bodyNumber: ResolvedBodyNumber | undefined,
  assetCssUrls: Readonly<Record<string, string>>,
  semanticItems: readonly SemanticItemManifestEntry[]
): string {
  const backdrop = theme.preset.usesSurface ? theme.preset.textBackdrop : textBackdrop(theme);
  const emphasisBackdrop = theme.accent;
  const bodyNumberStyle = buildBodyNumberInlineStyle(theme.bodyNumberStyle);

  const parts = [
    renderBadge(card, theme, assetCssUrls),
    bodyNumber?.visible && bodyNumber.text !== undefined
      ? `<div class="big-number" data-slot="body-number" data-semantic-item-id="${createSemanticItemId(card.index, "body-number")}" data-background-color="${backdrop}"${bodyNumberStyle ? ` style="${escapeHtml(bodyNumberStyle)}"` : ""}>${escapeHtml(bodyNumber.text)}</div>`
      : "",
    theme.layout.titlePlacement?.mode === "card-y"
      ? `<h1 class="title-placeholder" aria-hidden="true">${renderRichText(card.title)}</h1>`
      : `<h1 data-slot="title" data-semantic-item-id="${createSemanticItemId(card.index, "title")}" data-background-color="${backdrop}">${renderRichText(card.title)}</h1>`,
    card.subtitle
      ? `<div class="subtitle" data-slot="subtitle" data-semantic-item-id="${createSemanticItemId(card.index, "subtitle")}" data-background-color="${backdrop}">${renderRichText(card.subtitle)}</div>`
      : "",
    renderBodyContent(card, backdrop, theme, semanticItems),
    card.emphasis
      ? `<div class="emphasis" data-slot="emphasis" data-semantic-item-id="${createSemanticItemId(card.index, "emphasis")}" data-background-color="${emphasisBackdrop}">${renderPlainText(card.emphasis)}</div>`
      : "",
    card.source
      ? `<div class="source" data-slot="source" data-semantic-item-id="${createSemanticItemId(card.index, "source")}" data-background-color="${backdrop}">출처: ${escapeHtml(card.source)}</div>`
      : ""
  ].join("");

  return `<div class="content-inner">${parts}</div>`;
}

function renderBadge(
  card: Card,
  theme: ResolvedTheme,
  assetCssUrls: Readonly<Record<string, string>>
): string {
  const imageId = theme.badge.imageId;
  const imageSource = imageId ? assetCssUrls[imageId] : undefined;
  if (imageId && imageSource) {
    return `<img class="badge-image" data-slot="badge-image" data-semantic-item-id="${createSemanticItemId(card.index, "badge-image")}" src="${escapeAttribute(imageSource)}" alt="" style="height: ${theme.badge.imageHeight}px;${escapeHtml(buildSemanticSlotStyle(theme.layout.semanticSlots.badge, "badge", theme))}" />`;
  }

  if (!card.badge) {
    return "";
  }

  return `<span class="badge" data-slot="badge" data-semantic-item-id="${createSemanticItemId(card.index, "badge-text")}" data-background-color="${badgeMetricBackdrop(theme)}" style="${escapeHtml(buildSemanticSlotStyle(theme.layout.semanticSlots.badge, "badge", theme))}">${escapeHtml(card.badge)}</span>`;
}

function renderBodyContent(
  card: Card,
  backdrop: string,
  theme: ResolvedTheme,
  semanticItems: readonly SemanticItemManifestEntry[]
): string {
  const paragraphs = renderParagraphs(card, backdrop, semanticItems);
  const bullets = renderBullets(card, backdrop, semanticItems);
  if (!paragraphs && !bullets) {
    return "";
  }

  return `<div class="body-slot" data-slot="body" data-background-color="${backdrop}" style="${escapeHtml(buildSemanticSlotStyle(theme.layout.semanticSlots.body, "body", theme))}">${paragraphs}${bullets}</div>`;
}

function renderParagraphs(
  card: Card,
  backdrop: string,
  semanticItems: readonly SemanticItemManifestEntry[]
): string {
  if (card.paragraphs.length === 0) {
    return "";
  }

  return `<div class="paragraphs">${card.paragraphs
    .map(
      (paragraph, index) =>
        `<p data-slot="paragraph" data-semantic-item-id="${semanticItemIdForContent(semanticItems, "paragraph", index, card.index)}" data-background-color="${backdrop}">${renderRichText(paragraph)}</p>`
    )
    .join("")}</div>`;
}

function renderBullets(
  card: Card,
  backdrop: string,
  semanticItems: readonly SemanticItemManifestEntry[]
): string {
  if (card.bullets.length === 0) {
    return "";
  }

  return `<ul class="bullets">${card.bullets
    .map(
      (bullet, index) =>
        `<li data-slot="bullet" data-semantic-item-id="${semanticItemIdForContent(semanticItems, "bullet", index, card.index)}" data-background-color="${backdrop}">${renderRichText(bullet)}</li>`
    )
    .join("")}</ul>`;
}

function semanticItemIdForContent(
  semanticItems: readonly SemanticItemManifestEntry[],
  kind: "paragraph" | "bullet",
  contentIndex: number,
  cardIndex: number
): string {
  return (
    semanticItems.find((item) => item.kind === kind && item.contentIndex === contentIndex)?.id ??
    createSemanticItemId(cardIndex, kind, `${kind === "paragraph" ? "p" : "b"}-${contentIndex + 1}`)
  );
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
function renderRichText(value: string): string {
  return renderLineBreaks(escapeHtml(value).replace(/\*([^*]+)\*/g, '<em class="hl">$1</em>'));
}

function renderPlainText(value: string): string {
  return renderLineBreaks(escapeHtml(value));
}

function renderLineBreaks(value: string): string {
  return value.replace(/\n/g, "<br/>");
}

function normalizeAdjust(adjust: CardImageAdjust | undefined): CardImageAdjust {
  return {
    brightness: clampRange(adjust?.brightness ?? 1, 0.5, 1.5),
    contrast: clampRange(adjust?.contrast ?? 1, 0.5, 1.5),
    saturation: clampRange(adjust?.saturation ?? 1, 0.5, 1.5)
  };
}

function normalizeBadge(badge: CardBadgeOverride | undefined): ResolvedBadge {
  const imageId = badge?.imageId?.trim();
  return {
    shape: badge?.shape === "pill" || badge?.shape === "rect" || badge?.shape === "none" ? badge.shape : undefined,
    imageId: imageId && imageId.length > 0 ? imageId : undefined,
    imageHeight: Math.round(clampRange(badge?.imageHeight ?? 96, 40, 200)),
    textColor: preserveHexColor(badge?.textColor)
  };
}

function badgeMetricBackdrop(theme: ResolvedTheme): string {
  const mutedInk = theme.preset.inkScale?.mute ?? theme.preset.inkMuted;
  const badge = resolveEyebrowStyle(theme.preset, theme.accent, mutedInk);
  if (theme.badge.shape === "none" || badge.background === "transparent") {
    return textBackdrop(theme);
  }

  return preserveHexColor(badge.background) ?? textBackdrop(theme);
}

function normalizeNextHint(nextHint: NextHintConfig | undefined): ResolvedNextHint {
  if (!nextHint || nextHint.kind === "arrows") {
    return { kind: "arrows", imageId: undefined, height: 40 };
  }

  if (nextHint.kind === "none") {
    return { kind: "none", imageId: undefined, height: 40 };
  }

  const imageId = nextHint.imageId?.trim();
  return {
    kind: "image",
    imageId: imageId && imageId.length > 0 ? imageId : undefined,
    height: Math.round(clampRange(nextHint.height ?? 40, 24, 72))
  };
}

function badgeRadius(badge: ResolvedBadge, presetRadius: string): string {
  switch (badge.shape) {
    case "pill":
      return "999px";
    case "rect":
      return "8px";
    case "none":
      return "0";
    case undefined:
      return presetRadius;
  }
}

function normalizeTypography(
  typography: CardTypographyOverride | undefined,
  hasCustomFont: boolean
): ResolvedTypography {
  return {
    color: normalizeHexColor(typography?.color),
    fontFamily: hasCustomFont
      ? "\"Cardnews User Font\", \"Pretendard\", \"Malgun Gothic\", sans-serif"
      : undefined,
    italic: typography?.italic,
    letterSpacing: clampRange(typography?.letterSpacing ?? 0, -0.05, 0.1),
    lineHeight: typography?.lineHeight === undefined ? 1 : clampRange(typography.lineHeight, 1.1, 2),
    sizeScale: clampRange(typography?.sizeScale ?? 1, 0.65, 1.35),
    scope:
      typography?.scope === "title" || typography?.scope === "body" || typography?.scope === "all"
        ? typography.scope
        : "all",
    weight:
      typography?.weight === undefined
        ? undefined
        : Math.round(clampRange(typography.weight, 100, 950)),
    textOpacity: clampRange(typography?.textOpacity ?? 100, 0, 100)
  };
}

function buildBodyNumberInlineStyle(style: BodyNumberTextStyle | undefined): string {
  if (!style) return "";
  const declarations: string[] = [];
  const color = preserveHexColor(style.color);
  if (color) declarations.push(`color: ${color}`);
  const fontFamily = normalizeInlineFontFamily(style.fontFamily);
  if (fontFamily) declarations.push(`font-family: ${fontFamily}`);
  if (style.fontSize !== undefined && Number.isFinite(style.fontSize)) {
    declarations.push(`font-size: ${clampRange(style.fontSize, 8, 400).toFixed(2)}px`);
  }
  if (style.fontWeight !== undefined && Number.isFinite(style.fontWeight)) {
    declarations.push(`font-weight: ${Math.round(clampRange(style.fontWeight, 100, 950))}`);
  }
  if (style.italic !== undefined) {
    declarations.push(`font-style: ${style.italic ? "italic" : "normal"}`);
  }
  if (style.lineHeight !== undefined && Number.isFinite(style.lineHeight)) {
    declarations.push(`line-height: ${clampRange(style.lineHeight, 0.7, 3).toFixed(3)}`);
  }
  if (style.letterSpacing !== undefined && Number.isFinite(style.letterSpacing)) {
    declarations.push(`letter-spacing: ${clampRange(style.letterSpacing, -0.2, 1).toFixed(3)}em`);
  }
  const textAlign = style.textAlign ?? style.align;
  if (textAlign === "left" || textAlign === "center" || textAlign === "right") {
    declarations.push(`text-align: ${textAlign}`);
  }
  if (style.textOpacity !== undefined && Number.isFinite(style.textOpacity)) {
    declarations.push(`opacity: ${(clampRange(style.textOpacity, 0, 100) / 100).toFixed(3)}`);
  }
  if (style.zIndex !== undefined && Number.isFinite(style.zIndex)) {
    declarations.push(`z-index: ${Math.round(clampRange(style.zIndex, 0, 1000))}`);
  }
  return declarations.join("; ");
}

function normalizeInlineFontFamily(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\p{L}\p{N}\s"',._()-]+$/u.test(trimmed)) {
    return undefined;
  }
  return trimmed;
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
          ...(layer.align ? { align: layer.align } : {}),
          ...(layer.textOpacity !== undefined ? { textOpacity: clampRange(layer.textOpacity, 0, 100) } : {})
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
      case "video":
        return normalizeVideoLayer({ ...layer, ...base }, undefined);
    }
  });
}

function normalizeLayout(override: CardOverride | undefined): ResolvedLayout {
  const layout = override?.layout;
  const titlePlacement = layout?.titlePlacement;
  return {
    align: layout?.align === "center" ? "center" : "left",
    offsetY: clampRange(layout?.offsetY ?? 0, -20, 20),
    gapBadge: clampRange(layout?.gapBadge ?? 1, 0.5, 2),
    gapSubtitle: clampRange(layout?.gapSubtitle ?? 1, 0.5, 2),
    ...(titlePlacement?.mode === "card-y"
      ? { titlePlacement: { mode: "card-y" as const, y: clampRange(titlePlacement.y, 0, 100) } }
      : titlePlacement?.mode === "flow"
        ? { titlePlacement: { mode: "flow" as const } }
        : {}),
    semanticSlots: {
      badge: normalizeSemanticSlotPlacement(override?.semanticSlots?.badge),
      body: normalizeSemanticSlotPlacement(override?.semanticSlots?.body),
      footer: normalizeSemanticSlotPlacement(override?.semanticSlots?.footer),
      subtitle: normalizeSemanticSlotPlacement(override?.semanticSlots?.subtitle),
      title: normalizeSemanticSlotPlacement(override?.semanticSlots?.title)
    }
  };
}

function buildSemanticSlotStyle(
  placement: ReturnType<typeof normalizeSemanticSlotPlacement>,
  slot: "badge" | "body" | "footer" | "subtitle" | "title",
  theme: ResolvedTheme
): string {
  if (placement.mode !== "card") {
    return "";
  }

  const width = placement.width ?? defaultSemanticSlotSize(slot).width;
  const height = placement.height ?? defaultSemanticSlotSize(slot).height;
  const left =
    placement.anchor === "top-right"
      ? `calc(${placement.x.toFixed(3)}% - ${width.toFixed(3)}%)`
      : placement.anchor === "top-center"
        ? `calc(${placement.x.toFixed(3)}% - ${(width / 2).toFixed(3)}%)`
        : `${placement.x.toFixed(3)}%`;
  const textAlign = placement.anchor === "top-right" ? "right" : placement.anchor === "top-center" ? "center" : theme.layout.align;

  return ` position: absolute; left: ${left}; top: ${placement.y.toFixed(3)}%; width: ${width.toFixed(3)}%; min-height: ${height.toFixed(3)}%; text-align: ${textAlign};`;
}

function buildSemanticItemPlacementCss(
  placements: CardOverride["semanticItemPlacements"] | undefined
): string {
  return Object.entries(placements ?? {})
    .map(([itemId, rawPlacement]) => {
      if (!rawPlacement) return "";
      const placement = normalizeSemanticItemPlacement(rawPlacement);
      if (placement.mode !== "card") return "";
      const leftPercent =
        placement.anchor === "top-right"
          ? placement.x - placement.width
          : placement.anchor === "top-center"
            ? placement.x - (placement.width / 2)
            : placement.x;
      const textAlign =
        placement.anchor === "top-right"
          ? "right"
          : placement.anchor === "top-center"
            ? "center"
            : "left";
      return `[data-semantic-item-id="${escapeAttribute(itemId)}"] {
        --editor-card-left: ${leftPercent.toFixed(3)};
        --editor-card-top: ${placement.y.toFixed(3)};
        --editor-card-width: ${placement.width.toFixed(3)};
        --editor-card-height: ${placement.height.toFixed(3)};
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: ${placement.width.toFixed(3)}% !important;
        height: ${placement.height.toFixed(3)}% !important;
        min-height: 0 !important;
        margin: 0 !important;
        text-align: ${textAlign} !important;
        box-sizing: border-box !important;
        transform: none !important;
      }`;
    })
    .join("\n");
}

function defaultSemanticSlotSize(slot: "badge" | "body" | "footer" | "subtitle" | "title"): {
  readonly width: number;
  readonly height: number;
} {
  switch (slot) {
    case "badge":
      return { width: 32, height: 7 };
    case "body":
      return { width: 80, height: 24 };
    case "footer":
      return { width: 18, height: 5 };
    case "subtitle":
      return { width: 80, height: 8 };
    case "title":
      return { width: 80, height: 14 };
  }
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

function preserveHexColor(value: string | undefined): string | undefined {
  return value && isHexColor(value) ? value : undefined;
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
