import { describe, expect, it } from "vitest";
import { normalizeChromeConfig, pageNumberTemplatePresets, renderPageNumber } from "./chromeConfig.js";

describe("chromeConfig", () => {
  it("renders page number templates with supported tokens only", () => {
    expect(renderPageNumber("{n2} / {total}", 3, 12)).toBe("03 / 12");
    expect(renderPageNumber("CARD {n} of {total}", 3, 12)).toBe("CARD 3 of 12");
    expect(renderPageNumber("{n} / {bad}", 3, 12)).toBe("3 / {bad}");
  });

  it("offers the five user-facing page number presets", () => {
    expect(pageNumberTemplatePresets.map((preset) => preset.label)).toEqual([
      "1 / N",
      "1/N",
      "1-N",
      "01 / N",
      "1장 / N장"
    ]);
    expect(pageNumberTemplatePresets.map((preset) => renderPageNumber(preset.template, 1, 10))).toEqual([
      "1 / 10",
      "1/10",
      "1-10",
      "01 / 10",
      "1장 / 10장"
    ]);
  });

  it("normalizes slot styles with safe clamps and color fallback", () => {
    const chrome = normalizeChromeConfig({
      header: {
        visible: true,
        color: "#123456",
        fontSize: 8,
        fontWeight: 999,
        offsetX: 80,
        offsetY: -80,
        useDeckFont: true
      },
      footer: { visible: false },
      pageNumber: {
        visible: true,
        color: "white",
        fontSize: 60,
        fontWeight: 20,
        offsetX: -90,
        offsetY: 90,
        template: "{n2}"
      }
    });

    expect(chrome.header).toMatchObject({
      visible: true,
      color: "#123456",
      fontSize: 18,
      fontWeight: 950,
      offsetX: 40,
      offsetY: -40,
      useDeckFont: true
    });
    expect(chrome.footer.visible).toBe(false);
    expect(chrome.pageNumber).toMatchObject({
      visible: true,
      color: "#141414",
      fontSize: 48,
      fontWeight: 100,
      offsetX: -40,
      offsetY: 40,
      template: "{n2}"
    });
  });
});
