import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CardnewsError, CardnewsResult, Deck } from "../domain/types.js";
import { buildDeckFromDraft, isDeckPreset, isWorkspaceState, loadWorkspaceState } from "./deckStore.js";

function isCardnewsError(result: CardnewsResult<Deck>): result is CardnewsError {
  return "ok" in result && result.ok === false;
}

describe("deckStore migration guards", () => {
  it("accepts v3 workspace snapshots without v4 optional fields", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "newsprint",
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("accepts v4 workspace overrides and rail width", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "newsprint",
        aspectRatio: "16:9",
        backgroundId: "bg-test",
        railWidth: 220,
        overrides: {
          "1": {
            backgroundId: null,
            adjust: { brightness: 1.2, contrast: 0.9, saturation: 1.1 },
            layout: { align: "center", offsetY: -4, gapBadge: 1.2, gapSubtitle: 0.8 },
            dim: 0.4
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("accepts v4 preset overrides", () => {
    expect(
      isDeckPreset({
        name: "wide preset",
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        aspectRatio: "4:3",
        overrides: {
          "2": { backgroundId: "bg-test" }
        },
        cards: ["유형: 본문\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("migrates legacy rect/rotation line layers when loading a workspace", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-workspace-"));
    await fs.writeFile(
      path.join(storageRoot, "workspace.json"),
      JSON.stringify({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            layers: [
              {
                id: "legacy-line",
                kind: "line",
                x: 40,
                y: 20,
                width: 30,
                height: 1,
                color: "#111111",
                strokeWidth: 5,
                rotation: 90
              }
            ]
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      }),
      "utf8"
    );

    const state = await loadWorkspaceState(storageRoot);
    const layer = state?.overrides?.["1"]?.layers?.[0];

    expect(state?.footerAccount).toBe("kkongdon_story");
    expect(layer?.kind).toBe("line");
    if (layer?.kind !== "line") {
      throw new Error("expected migrated line layer");
    }
    expect(layer.x1).toBeCloseTo(55, 3);
    expect(layer.y1).toBeCloseTo(8.5, 3);
    expect(layer.x2).toBeCloseTo(55, 3);
    expect(layer.y2).toBeCloseTo(32.5, 3);
    expect(layer.thickness).toBe(5);
  });

  it("normalizes optional chrome settings when loading a workspace", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-workspace-chrome-"));
    await fs.writeFile(
      path.join(storageRoot, "workspace.json"),
      JSON.stringify({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        chrome: {
          header: { color: "#123456", fontSize: 4, offsetX: 90 },
          footer: { visible: false },
          pageNumber: { template: "{n2}", color: "white", offsetY: -90 }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      }),
      "utf8"
    );

    const state = await loadWorkspaceState(storageRoot);

    expect(state?.chrome?.header.color).toBe("#123456");
    expect(state?.chrome?.header.fontSize).toBe(18);
    expect(state?.chrome?.header.offsetX).toBe(40);
    expect(state?.chrome?.footer.visible).toBe(false);
    expect(state?.chrome?.pageNumber.template).toBe("{n2}");
    expect(state?.chrome?.pageNumber.color).toBe("#141414");
    expect(state?.chrome?.pageNumber.offsetY).toBe(-40);
  });

  it("normalizes legacy @ footer values at the deck boundary", () => {
    for (const footerAccount of ["", "@", "@kkongdon_story", "kkongdon_story"]) {
      const deck = buildDeckFromDraft(
        "current",
        {
          headerLabel: "MONEY NOTE",
          footerAccount,
          cards: [{ index: 1, rawText: "유형: 표지\n제목: 테스트" }]
        },
        undefined
      );

      if (isCardnewsError(deck)) {
        throw new Error(deck.message);
      }
      expect(deck.footerAccount).toBe("kkongdon_story");
    }
  });
});
