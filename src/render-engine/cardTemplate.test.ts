import { describe, expect, it } from "vitest";
import type { Card, Deck } from "../domain/types.js";
import { buildCardHtml, buildFontFaceCss } from "./cardTemplate.js";
import { findStylePreset, stylePresets } from "./stylePresets.js";

const sampleCard: Card = {
  index: 2,
  type: "body",
  title: "정보는 쌓이는데 *연결*이 안 된다",
  badge: "SECOND BRAIN",
  paragraphs: ["수집을 넘어 생각을 잇는 능력이 경쟁력."],
  bullets: ["첫 번째 항목"],
  source: "내부 메모"
};

function sampleDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: "test",
    headerLabel: "MONEY NOTE",
    footerAccount: "@kkongdon_story",
    cards: [
      { index: 1, type: "cover", title: "표지", paragraphs: [], bullets: [] },
      sampleCard,
      { index: 3, type: "cta", title: "마무리", paragraphs: [], bullets: [] }
    ],
    ...overrides
  };
}

describe("buildCardHtml (style presets)", () => {
  it("renders *단어* emphasis as an accent highlight, not literal asterisks", () => {
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ styleId: "minimal", accentColor: "#e0342c" })
    });

    expect(html).toContain('<em class="hl">연결</em>');
    expect(html).not.toContain("*연결*");
  });

  it("renders badge, page number, and footer mention", () => {
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck()
    });

    expect(html).toContain("SECOND BRAIN");
    expect(html).toContain("2 / 3");
    expect(html).toContain("@kkongdon_story");
    expect(html).toContain("&gt;&gt;&gt;&gt;");
  });

  it("applies deck chrome slot styles and visibility through the shared template", () => {
    const deck = {
      ...sampleDeck(),
      chrome: {
        header: {
          visible: true,
          color: "#123456",
          fontSize: 22,
          fontWeight: 700,
          offsetX: 4,
          offsetY: -2,
          useDeckFont: true
        },
        footer: {
          visible: false,
          color: "#141414",
          fontSize: 30,
          fontWeight: 800,
          offsetX: 0,
          offsetY: 0,
          useDeckFont: true
        },
        pageNumber: {
          visible: true,
          color: "#ffffff",
          fontSize: 24,
          fontWeight: 850,
          offsetX: -3,
          offsetY: 10,
          useDeckFont: true,
          template: "{n2}"
        }
      }
    };
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck
    });

    expect(html).toContain('data-slot="header"');
    expect(html).toContain("color: #123456");
    expect(html).toContain("font-size: 22px");
    expect(html).toContain("font-weight: 700");
    expect(html).toContain("translate(4px, -2px)");
    expect(html).toContain('data-slot="page"');
    expect(html).toContain(">02<");
    expect(html).toContain("color: #ffffff");
    expect(html).toContain("font-size: 24px");
    expect(html).toContain("font-weight: 850");
    expect(html).toContain("translate(-3px, 10px)");
    expect(html).not.toContain('data-slot="footer"');
  });

  it("applies the requested accent color", () => {
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ styleId: "darkinfo", accentColor: "#f2b705" })
    });

    expect(html).toContain("#f2b705");
  });

  it("falls back to the preset default accent when accentColor is malformed", () => {
    const preset = findStylePreset("cinematic");
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ styleId: "cinematic", accentColor: "red" })
    });

    expect(html).toContain(preset.accentDefault);
  });

  it("produces valid metric slots for every style preset", () => {
    for (const preset of stylePresets) {
      const html = buildCardHtml({
        backgroundCssUrl: undefined,
        card: sampleCard,
        deck: sampleDeck({ styleId: preset.id })
      });

      expect(html, preset.id).toContain('data-slot="title"');
      expect(html, preset.id).toContain('data-slot="header"');
      expect(html, preset.id).toContain('data-slot="footer"');
      expect(html, preset.id).toContain("__CARDNEWS_COLLECT_METRICS__");
    }
  });

  it("applies an imported background to both solid and photo styles", () => {
    const bg = "file:///C:/tmp/bg.png";
    const solid = buildCardHtml({
      backgroundCssUrl: bg,
      card: sampleCard,
      deck: sampleDeck({ styleId: "whiteblue" })
    });
    const photo = buildCardHtml({
      backgroundCssUrl: bg,
      card: sampleCard,
      deck: sampleDeck({ styleId: "cinematic" })
    });

    expect(solid).toContain('class="photo"');
    expect(solid).toContain("solid-preset");
    expect(solid).toContain("bg.png");
    expect(photo).toContain('class="photo"');
    expect(photo).toContain("photo-preset");
    expect(photo).toContain("bg.png");
  });

  it("adds deterministic text-fit variables for dense card copy", () => {
    const denseCard: Card = {
      ...sampleCard,
      title: "긴 제목이 여러 줄로 밀려도 서로 겹치지 않도록 자동으로 줄어드는 카드",
      paragraphs: [
        "첫 문단이 길게 들어와도 렌더러는 일정한 비율로 글자와 간격을 함께 줄여야 합니다.",
        "둘째 문단도 같은 계산에 포함되어야 합니다."
      ],
      bullets: ["첫 번째 긴 불릿 문장", "두 번째 긴 불릿 문장", "세 번째 긴 불릿 문장"]
    };
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: denseCard,
      deck: sampleDeck({ styleId: "minimal" })
    });

    expect(html).toContain("--title-scale:");
    expect(html).toContain("--body-scale:");
    expect(html).toContain("overflow-wrap: anywhere");
  });
});

describe("buildCardHtml (aspect ratio + font)", () => {
  it("emits stable font-face descriptors for imported static fonts", () => {
    const css = buildFontFaceCss("file:///C:/fonts/custom.ttf", {
      family: "Cardnews User Font",
      format: "truetype"
    });

    expect(css).toContain('font-family: "Cardnews User Font"');
    expect(css).toContain('format("truetype")');
    expect(css).toContain("font-weight: 100 900;");
    expect(css).toContain("font-style: normal;");
    expect(css).not.toContain("font-weight: 45 920");
    expect(css).not.toContain("font-style: normal italic");
  });

  it("sizes the card by deck aspect ratio", () => {
    const square = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ aspectRatio: "1:1" })
    });
    const wide = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ aspectRatio: "16:9" })
    });

    expect(square).toContain("width: 1080px");
    expect(square).toContain("height: 1080px");
    expect(wide).toContain("width: 1920px");
    expect(wide).toContain("height: 1080px");
  });

  it("falls back to 4:5 for unknown ratios and injects fontCss when given", () => {
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ aspectRatio: "9:16" }),
      fontCss: '@font-face { font-family: "Pretendard"; src: url("blob:x"); }'
    });

    expect(html).toContain("height: 1350px");
    expect(html).toContain("blob:x");
  });

  it("applies the custom font family to card body, title, and text layers", () => {
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({
        fontId: "font-test",
        overrides: {
          "2": {
            layers: [
              {
                id: "layer-font-test",
                kind: "text",
                x: 10,
                y: 10,
                width: 80,
                height: 10,
                text: "Layer font",
                fontSize: 28
              }
            ]
          }
        }
      }),
      fontCss: buildFontFaceCss("data:font/ttf;base64,AA==", {
        family: "Cardnews User Font",
        format: "truetype"
      }),
      override: {
        layers: [
          {
            id: "layer-font-test",
            kind: "text",
            x: 10,
            y: 10,
            width: 80,
            height: 10,
            text: "Layer font",
            fontSize: 28
          }
        ]
      }
    });

    const family = 'font-family: "Cardnews User Font", "Pretendard", "Malgun Gothic", sans-serif';
    expect(html).toContain(family);
    expect((html.match(/Cardnews User Font/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('class="layer layer-text"');
  });

  it("keeps default text layers transparent and sized for direct editing", () => {
    const backdrop = findStylePreset("minimal").textBackdrop;
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ styleId: "minimal" }),
      override: {
        layers: [
          {
            id: "layer-default-text",
            kind: "text",
            x: 18,
            y: 44,
            width: 64,
            height: 12,
            text: "텍스트 입력"
          }
        ]
      }
    });

    expect(html).toContain('data-slot="layer-layer-default-text"');
    expect(html).toContain("background: transparent");
    expect(html).toContain("font-size: 40px");
    expect(html).toContain('data-font-size="40"');
    expect(html).toContain(`data-background-color="${backdrop}"`);
    const styleAttribute = html.match(/class="layer layer-text"[^>]*style="([^"]*)"/)?.[1] ?? "";
    expect(styleAttribute).toContain("&quot;Pretendard&quot;");
    expect(styleAttribute).toContain("font-size: 40px");
  });

  it("renders endpoint line layers with pixel segment geometry", () => {
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      deck: sampleDeck({ styleId: "minimal" }),
      override: {
        layers: [
          {
            id: "endpoint-line",
            kind: "line",
            x1: 55,
            y1: 8.5,
            x2: 55,
            y2: 32.5,
            color: "#111111",
            thickness: 5
          }
        ]
      }
    });

    expect(html).toContain('class="layer layer-line"');
    expect(html).toContain("left: 594.000px");
    expect(html).toContain("top: 114.750px");
    expect(html).toContain("width: 324.000px");
    expect(html).toContain("height: 5px");
    expect(html).toContain("transform: rotate(90deg)");
    expect(html).toContain("transform-origin: 0 50%");
  });

  it("applies per-card image and layout overrides deterministically", () => {
    const html = buildCardHtml({
      backgroundCssUrl: "file:///C:/tmp/bg.png",
      card: sampleCard,
      deck: sampleDeck({ styleId: "cinematic" }),
      override: {
        adjust: { brightness: 1.25, contrast: 0.9, saturation: 1.4 },
        layout: { align: "center", offsetY: -8, gapBadge: 1.5, gapSubtitle: 0.75 },
        dim: 0.2
      }
    });

    expect(html).toContain("brightness(1.25) contrast(0.90) saturate(1.40)");
    expect(html).toContain("text-align: center");
    expect(html).toContain("transform: translateY(-8.00%)");
    expect(html).toContain("--gap-badge-scale: 1.500");
    expect(html).toContain("--gap-subtitle-scale: 0.750");
    expect(html).toContain("display: block;");
    expect(html).toContain("margin-bottom: calc(40px * var(--gap-scale) * var(--gap-badge-scale))");
    expect(html).toContain("width: fit-content;");
    expect(html).toContain("margin-top: calc(36px * var(--gap-scale) * var(--gap-subtitle-scale))");
  });

  it("resolves custom styles by id before falling back to built-ins", () => {
    const customStyle = {
      ...findStylePreset("minimal"),
      id: "custom-test",
      name: "테스트 커스텀",
      accentDefault: "#123456",
      pageBackground: "#abcdef"
    };
    const html = buildCardHtml({
      backgroundCssUrl: undefined,
      card: sampleCard,
      customStyles: [customStyle],
      deck: sampleDeck({ styleId: "custom-test" })
    });

    expect(html).toContain("#abcdef");
    expect(html).toContain("#123456");
  });

  it("wires v2 style tokens into rendered CSS", () => {
    const customStyle = {
      ...findStylePreset("minimal"),
      id: "custom-v2",
      name: "v2 토큰 테스트",
      usesPhoto: true,
      usesSurface: true,
      defaultDim: 0.5,
      accentDefault: "#123456",
      surfaceLadder: ["#fafafa", "#eeeeee", "#dddddd"] as const,
      inkScale: { ink: "#010101", body: "#202020", mute: "#606060", faint: "#a0a0a0" },
      eyebrowStyle: "bar" as const,
      scrimStops: ["rgba(1,2,3,0.50) 0%", "rgba(4,5,6,0.80) 100%"] as const
    };
    const html = buildCardHtml({
      backgroundCssUrl: "file:///C:/tmp/bg.png",
      card: sampleCard,
      customStyles: [customStyle],
      deck: sampleDeck({ styleId: "custom-v2" })
    });

    expect(html).toContain("--surface-1: #fafafa");
    expect(html).toContain("--ink-title: #010101");
    expect(html).toContain("--ink-body: #202020");
    expect(html).toContain("linear-gradient(180deg, rgba(1,2,3, 0.50) 0%, rgba(4,5,6, 0.80) 100%)");
    expect(html).toContain("border-left: 12px solid #123456");
    expect(html).toContain("color: var(--ink-body)");
  });
});
