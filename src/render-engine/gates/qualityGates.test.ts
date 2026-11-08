import { describe, expect, it } from "vitest";
import { evaluateQualityGates } from "./qualityGates.js";
import type { RenderSlotMetric } from "../../domain/types.js";

function makeMetric(overrides: Partial<RenderSlotMetric>): RenderSlotMetric {
  return {
    backgroundColor: "#ffffff",
    cardIndex: 1,
    color: "#111111",
    fontSize: 48,
    height: 120,
    left: 120,
    slot: "title",
    text: "테스트 제목",
    top: 160,
    width: 720,
    ...overrides
  };
}

describe("evaluateQualityGates", () => {
  it("passes valid readable slots inside the safe zone", () => {
    const report = evaluateQualityGates([makeMetric({})]);

    expect(report.status).toBe("pass");
    expect(report.issues).toEqual([]);
  });

  it("fails low contrast with a measured ratio", () => {
    const report = evaluateQualityGates([
      makeMetric({ backgroundColor: "#ffffff", color: "#777777", slot: "body" })
    ]);

    expect(report.status).toBe("fail");
    expect(report.issues[0]?.gate).toBe("contrast");
    expect(report.issues[0]?.measured).toBeLessThan(4.5);
  });

  it("accepts Chromium color(srgb) values when measuring contrast", () => {
    const report = evaluateQualityGates([
      makeMetric({ backgroundColor: "#fffcf4", color: "color(srgb 0.113725 0.113725 0.105882)" })
    ]);

    expect(report.status).toBe("pass");
    expect(report.issues).toEqual([]);
  });

  it("does not evaluate the aggregate body container twice when child text slots exist", () => {
    const report = evaluateQualityGates([
      makeMetric({ slot: "body", fontSize: 16, top: 300, height: 180, text: "문단과 불릿" }),
      makeMetric({ slot: "paragraph", fontSize: 34, top: 300, height: 48, text: "문단" }),
      makeMetric({ slot: "bullet", fontSize: 34, top: 372, height: 48, text: "불릿" })
    ]);

    expect(report.status).toBe("pass");
    expect(report.issues).toEqual([]);
  });

  it("fails text that leaves the safe zone", () => {
    const report = evaluateQualityGates([makeMetric({ left: 12, slot: "footer" })]);

    expect(report.status).toBe("fail");
    expect(report.issues[0]?.gate).toBe("overflow");
    expect(report.issues[0]?.slot).toBe("footer");
  });

  it("fails text below the font floor", () => {
    const report = evaluateQualityGates([makeMetric({ fontSize: 17, slot: "source" })]);

    expect(report.status).toBe("fail");
    expect(report.issues[0]?.gate).toBe("font_floor");
    expect(report.issues[0]?.required).toBe(18);
  });

  it("warns without failing for too many font sizes", () => {
    const report = evaluateQualityGates([
      makeMetric({ fontSize: 22, slot: "header", top: 100 }),
      makeMetric({ fontSize: 30, slot: "badge", top: 230 }),
      makeMetric({ fontSize: 40, slot: "subtitle", top: 380 }),
      makeMetric({ fontSize: 52, slot: "title", top: 540 }),
      makeMetric({ fontSize: 64, slot: "emphasis", top: 720 })
    ]);

    expect(report.status).toBe("warn");
    expect(report.issues[0]?.gate).toBe("font_variety");
    expect(report.issues[0]?.severity).toBe("warn");
  });

  it("fails visible slots that overlap vertically", () => {
    const report = evaluateQualityGates([
      makeMetric({ slot: "title", top: 200, height: 120, width: 700 }),
      makeMetric({ slot: "subtitle", top: 314, height: 70, width: 680 })
    ]);

    expect(report.status).toBe("fail");
    expect(report.issues.some((issue) => issue.gate === "overlap")).toBe(true);
  });
});
