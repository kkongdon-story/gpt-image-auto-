import { describe, expect, it } from "vitest";
import { parseDeckDocument } from "../../../domain/deckImporter";
import type { CardnewsError, CardnewsResult } from "../../../domain/types";
import {
  buildDraftPrompt,
  buildMockDraftDocument,
  buildResearchPrompt,
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
    expect(prompt).toContain("모드: draft");
    expect(prompt).toContain("푸터: @kkongdon_story");
    expect(prompt).toContain("카드는 정확히 10장");
    expect(prompt.indexOf("앱 안전/형식 계약")).toBeLessThan(prompt.indexOf("사용자 기본 지시"));
  });

  it("applies editable default instructions once and preserves raw user text", () => {
    const instruction = "내 브랜드는 담백한 실행 조언을 우선한다.";
    const rawSeed = "  첫 줄 유지\n둘째 줄도 그대로  ";
    const topicPrompt = buildResearchPrompt(rawSeed, instruction);

    expect(topicPrompt.match(new RegExp(instruction, "g"))).toHaveLength(1);
    expect(topicPrompt).toContain(`사용자 원문 주제:\n${rawSeed}`);
    expect(topicPrompt).not.toContain("브랜드: 꽁돈");
    expect(topicPrompt).not.toContain("kkongdon_story");
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
    expect(parsed.footerAccount).toBe("@kkongdon_story");
  });

  it("does not extract research prose as an applyable deck document", () => {
    const prompt = buildResearchPrompt("7월 7일 정보통신망법 시행");
    const researchResponse = [
      "역할: 카드뉴스 리서처.",
      "요약: 시행일과 적용 대상을 먼저 확인해야 합니다.",
      "근거: 법령 원문, 보도자료, 관련 해설을 비교합니다.",
      "제목: 이 줄은 참고 문장이지 카드 양식이 아닙니다."
    ].join("\n");

    expect(prompt).toContain("모드: research");
    expect(prompt).not.toContain("앱에서 파싱하는 양식 계약");
    expect(extractTemplateDocument(researchResponse)).toBe("");
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
