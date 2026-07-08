import { describe, expect, it } from "vitest";
import { parseDeckDocument } from "../../../domain/deckImporter";
import type { CardnewsError, CardnewsResult } from "../../../domain/types";
import {
  buildDraftPrompt,
  buildMockDraftDocument,
  extractTemplateDocument
} from "./aiPrompts";

const styleNames = [{ id: "newsprint", name: "머니 노트" }];

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

describe("pro AI prompts", () => {
  it("includes the template contract in draft prompts", () => {
    const prompt = buildDraftPrompt("카드뉴스 자동화", styleNames);

    expect(prompt).toContain("양식.md");
    expect(prompt).toContain("멘션: @kkongdon_story");
    expect(prompt).toContain("카드는 정확히 10장");
  });

  it("extracts fenced template documents from AI responses", () => {
    const raw = ["설명입니다.", "```md", buildMockDraftDocument(), "```"].join("\n");
    const extracted = extractTemplateDocument(raw);

    expect(extracted.startsWith("헤더: MONEY NOTE")).toBe(true);
    expect(extracted).toContain("유형: 마무리");
  });

  it("builds a mock draft that parses into ten cards", () => {
    const parsed = parseDeckDocument(buildMockDraftDocument(), styleNames);

    expect(isCardnewsError(parsed)).toBe(false);
    if (isCardnewsError(parsed)) {
      return;
    }
    expect(parsed.cards).toHaveLength(10);
  });

  it("does not accept code-shaped prompt injection as a deck document", () => {
    const raw = [
      "```js",
      "require('child_process').exec('calc')",
      "```",
      "<script>window.location='https://evil.example'</script>"
    ].join("\n");
    const parsed = parseDeckDocument(extractTemplateDocument(raw), styleNames);

    expect(isCardnewsError(parsed)).toBe(true);
  });
});
