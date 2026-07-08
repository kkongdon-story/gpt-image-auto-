import { describe, expect, it } from "vitest";
import type { CardnewsError, CardnewsResult } from "../domain/types.js";
import {
  buildDesignContract,
  buildSampleStyleJson,
  isStylePresetShape,
  parseStyleJson,
  type ParsedCustomStyle
} from "./customStyles.js";
import { stylePresets } from "./stylePresets.js";

const validStyle = {
  name: "선셋 그라디언트",
  usesPhoto: false,
  usesSurface: false,
  pageBackground: "linear-gradient(180deg, #ff8a5c 0%, #7b2d8b 100%)",
  textBackdrop: "#8a3a52",
  chromeBackdrop: "#8a3a52",
  ink: "#ffffff",
  inkSub: "#ffe9dd",
  inkMuted: "#f3c9b8",
  accentDefault: "#ffd166",
  badgeBackground: "rgba(255, 255, 255, 0.2)",
  badgeInk: "#ffffff",
  fontTitle: '"Pretendard", sans-serif',
  fontBody: '"Pretendard", sans-serif',
  defaultDim: 0
};

function isCardnewsError(
  result: CardnewsResult<ParsedCustomStyle>
): result is CardnewsError {
  return "ok" in result && (result as CardnewsError).ok === false;
}

function expectParsed(result: CardnewsResult<ParsedCustomStyle>): ParsedCustomStyle {
  if (isCardnewsError(result)) {
    throw new Error(result.message);
  }

  return result;
}

describe("parseStyleJson", () => {
  it("parses a valid style and assigns a custom- id", () => {
    const { preset, warnings } = expectParsed(parseStyleJson(JSON.stringify(validStyle), []));

    expect(preset.id.startsWith("custom-")).toBe(true);
    expect(preset.name).toBe("선셋 그라디언트");
    expect(preset.accentDefault).toBe("#ffd166");
    expect(warnings).toHaveLength(0);
    expect(isStylePresetShape(preset)).toBe(true);
  });

  it("accepts JSON wrapped in a markdown code fence (chatbot output)", () => {
    const fenced = "설명입니다.\n```json\n" + JSON.stringify(validStyle) + "\n```\n끝.";
    const { preset } = expectParsed(parseStyleJson(fenced, []));

    expect(preset.name).toBe("선셋 그라디언트");
  });

  it("avoids id collisions with existing styles", () => {
    const first = expectParsed(parseStyleJson(JSON.stringify(validStyle), []));
    const second = expectParsed(
      parseStyleJson(JSON.stringify(validStyle), [first.preset.id])
    );

    expect(second.preset.id).not.toBe(first.preset.id);
  });

  it("rejects malformed colors and missing fields", () => {
    const badColor = { ...validStyle, ink: "white" };
    expect(isCardnewsError(parseStyleJson(JSON.stringify(badColor), []))).toBe(true);

    const { name: _dropped, ...missingName } = validStyle;
    expect(isCardnewsError(parseStyleJson(JSON.stringify(missingName), []))).toBe(true);

    expect(isCardnewsError(parseStyleJson("이건 JSON이 아님", []))).toBe(true);
  });

  it("rejects style-block breakouts in custom CSS fields", () => {
    const scriptBreakout = {
      ...validStyle,
      pageBackground: "#ffffff</style><script>window.evil=true</script>"
    };
    const fontBreakout = {
      ...validStyle,
      fontBody: '"Pretendard"; }</style><script>window.evil=true</script>'
    };

    expect(isCardnewsError(parseStyleJson(JSON.stringify(scriptBreakout), []))).toBe(true);
    expect(isCardnewsError(parseStyleJson(JSON.stringify(fontBreakout), []))).toBe(true);
    expect(isStylePresetShape({ ...scriptBreakout, id: "custom-evil" })).toBe(false);
  });

  it("rejects URL and import based CSS injection in custom style records", () => {
    const externalCss = {
      ...validStyle,
      badgeBackground: 'url("https://example.com/track")'
    };
    const importedCss = {
      ...validStyle,
      pageBackground: "linear-gradient(180deg, #ffffff 0%, #000000 100%) @import test"
    };

    expect(isCardnewsError(parseStyleJson(JSON.stringify(externalCss), []))).toBe(true);
    expect(isCardnewsError(parseStyleJson(JSON.stringify(importedCss), []))).toBe(true);
    expect(isStylePresetShape({ ...externalCss, id: "custom-url" })).toBe(false);
  });

  it("warns when ink contrast against textBackdrop is below 4.5:1", () => {
    const lowContrast = { ...validStyle, ink: "#9a4a62", inkSub: "#9a4a62" };
    const { warnings } = expectParsed(parseStyleJson(JSON.stringify(lowContrast), []));

    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings[0]).toContain("4.5");
  });

  it("normalizes percentage-like defaultDim with a warning", () => {
    const percentDim = { ...validStyle, usesPhoto: true, defaultDim: 65 };
    const { preset, warnings } = expectParsed(parseStyleJson(JSON.stringify(percentDim), []));

    expect(preset.defaultDim).toBe(0.65);
    expect(warnings.some((warning) => warning.includes("0.65"))).toBe(true);
  });

  it("keeps optional v2 style tokens when present", () => {
    const v2Style = {
      ...validStyle,
      surfaceLadder: ["#111111", "#222222", "#333333"],
      inkScale: { ink: "#ffffff", body: "#eeeeee", mute: "#bbbbbb", faint: "#777777" },
      hairline: "rgba(255,255,255,0.2)",
      eyebrowStyle: "bar",
      titleTracking: 0.02,
      badgeRadius: "12px",
      bulletShape: "dash",
      scrimStops: ["rgba(0,0,0,0.1)", "rgba(0,0,0,0.8)"]
    };
    const { preset } = expectParsed(parseStyleJson(JSON.stringify(v2Style), []));

    expect(preset.surfaceLadder).toEqual(["#111111", "#222222", "#333333"]);
    expect(preset.inkScale?.body).toBe("#eeeeee");
    expect(preset.bulletShape).toBe("dash");
    expect(preset.titleTracking).toBe(0.02);
  });
});

describe("buildDesignContract", () => {
  it("round-trips its own examples through parseStyleJson", () => {
    const contract = buildDesignContract();
    const blocks = [...contract.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]!);

    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      const parsed = parseStyleJson(block, stylePresets.map((preset) => preset.id));
      expect(isCardnewsError(parsed)).toBe(false);
    }
  });

  it("mentions every required schema field", () => {
    const contract = buildDesignContract();
    for (const field of ["textBackdrop", "accentDefault", "usesPhoto", "fontBody", "defaultDim"]) {
      expect(contract).toContain(field);
    }
  });

  it("emits a paste-ready sample JSON", () => {
    const parsed = parseStyleJson(buildSampleStyleJson(), stylePresets.map((preset) => preset.id));
    expect(isCardnewsError(parsed)).toBe(false);
  });
});
