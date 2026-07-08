import { describe, expect, it } from "vitest";
import type { CardnewsError, CardnewsResult, Deck } from "../domain/types.js";
import { buildDeckFromDraft, isDeckPreset, isWorkspaceState } from "./deckStore.js";

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
