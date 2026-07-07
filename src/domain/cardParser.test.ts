import { describe, expect, it } from "vitest";
import { parseCardText } from "./cardParser.js";
import type { Card, CardnewsError, CardnewsResult } from "./types.js";

function isCardnewsError(result: CardnewsResult<Card>): result is CardnewsError {
  return "ok" in result && result.ok === false;
}

function expectParsedCard(result: CardnewsResult<Card>): Card {
  if (isCardnewsError(result)) {
    throw new Error(result.message);
  }

  return result;
}

function expectParserError(result: CardnewsResult<Card>): CardnewsError {
  if (!isCardnewsError(result)) {
    throw new Error("Expected parser error.");
  }

  return result;
}

describe("parseCardText", () => {
  it("parses Korean labels even when the label order changes", () => {
    const parsed = expectParsedCard(
      parseCardText(
        [
          "제목: 돈 이야기를 다시 배워야 하는 이유",
          "유형: 표지",
          "소제목: 숫자보다 먼저 보는 관점",
          "본문: 첫 문단",
          "출처: 내부 메모",
          "강조: 저장하고 다시 보기"
        ].join("\n"),
        3
      )
    );

    expect(parsed).toEqual({
      index: 3,
      type: "cover",
      title: "돈 이야기를 다시 배워야 하는 이유",
      subtitle: "숫자보다 먼저 보는 관점",
      paragraphs: ["첫 문단"],
      bullets: [],
      source: "내부 메모",
      emphasis: "저장하고 다시 보기"
    });
  });

  it("defaults to a body card when the optional type label is missing", () => {
    const parsed = expectParsedCard(
      parseCardText(
        [
          "제목: 소비를 다시 보는 질문",
          "본문: 첫 번째 문단입니다.",
          "두 번째 문단입니다."
        ].join("\n"),
        2
      )
    );

    expect(parsed.type).toBe("body");
    expect(parsed.paragraphs).toEqual(["첫 번째 문단입니다.", "두 번째 문단입니다."]);
  });

  it("extracts bullets from body content without keeping dash markers", () => {
    const parsed = expectParsedCard(
      parseCardText(
        [
          "유형: 마무리",
          "제목: 오늘의 질문",
          "본문:",
          "- 지금 내 소비에서 반복되는 감정은?",
          "- 다음 카드뉴스 주제로 남길 것은?"
        ].join("\n"),
        10
      )
    );

    expect(parsed.type).toBe("cta");
    expect(parsed.paragraphs).toEqual([]);
    expect(parsed.bullets).toEqual([
      "지금 내 소비에서 반복되는 감정은?",
      "다음 카드뉴스 주제로 남길 것은?"
    ]);
  });

  it("rejects an unsupported Korean card type", () => {
    const error = expectParserError(
      parseCardText(
        [
          "유형: 광고",
          "제목: 잘못된 유형",
          "본문: 이 카드는 렌더링하면 안 됩니다."
        ].join("\n"),
        4
      )
    );

    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("유형");
  });

  it("rejects an empty card", () => {
    const error = expectParserError(parseCardText("   \n\t", 1));

    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("비어");
  });

  it("rejects a card without a title", () => {
    const error = expectParserError(
      parseCardText(
        [
          "유형: 본문",
          "본문: 제목 없이 본문만 있는 카드는 사용할 수 없습니다."
        ].join("\n"),
        5
      )
    );

    expect(error.code).toBe("invalid_input");
    expect(error.message).toContain("제목");
  });
});

describe("parseCardText v2 (배지 + 강조 문법)", () => {
  it("parses the 배지 label into card.badge", () => {
    const parsed = expectParsedCard(
      parseCardText("유형: 표지\n배지: SECOND BRAIN\n제목: 지식을 자산으로", 1)
    );

    expect(parsed.badge).toBe("SECOND BRAIN");
  });

  it("omits badge when the 배지 label is absent", () => {
    const parsed = expectParsedCard(parseCardText("제목: 배지 없는 카드", 1));

    expect(parsed.badge).toBeUndefined();
  });

  it("keeps *단어* emphasis lines as paragraphs instead of bullets", () => {
    const parsed = expectParsedCard(
      parseCardText("제목: 강조 충돌\n본문: *핵심*만 기억하세요\n- 진짜 불릿\n* 공백 불릿", 1)
    );

    expect(parsed.paragraphs).toEqual(["*핵심*만 기억하세요"]);
    expect(parsed.bullets).toEqual(["진짜 불릿", "공백 불릿"]);
  });
});
