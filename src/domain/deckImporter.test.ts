import { describe, expect, it } from "vitest";
import { buildTemplateDocument, parseDeckDocument, type DeckDocument } from "./deckImporter.js";
import type { CardnewsError, CardnewsResult } from "./types.js";

const styleNames = [
  { id: "newsprint", name: "신문 오버레이 (사진)" },
  { id: "cinematic", name: "시네마틱 (사진)" },
  { id: "whiteblue", name: "화이트 & 블루" }
] as const;

function isCardnewsError(result: CardnewsResult<DeckDocument>): result is CardnewsError {
  return "ok" in result && result.ok === false;
}

function expectDocument(result: CardnewsResult<DeckDocument>): DeckDocument {
  if (isCardnewsError(result)) {
    throw new Error(result.message);
  }

  return result;
}

describe("parseDeckDocument", () => {
  it("parses meta block and card blocks separated by ---", () => {
    const doc = expectDocument(
      parseDeckDocument(
        [
          "헤더: MY NOTE",
          "멘션: @tester",
          "스타일: cinematic",
          "포인트색상: #FFC648",
          "하단어둡기: 70",
          "",
          "---",
          "유형: 표지",
          "제목: 첫 카드",
          "---",
          "유형: 본문",
          "제목: 둘째 카드",
          "본문: 내용"
        ].join("\n"),
        styleNames
      )
    );

    expect(doc.headerLabel).toBe("MY NOTE");
    expect(doc.footerAccount).toBe("@tester");
    expect(doc.styleId).toBe("cinematic");
    expect(doc.accentColor).toBe("#ffc648");
    expect(doc.backgroundDim).toBe(0.7);
    expect(doc.cards).toHaveLength(2);
    expect(doc.cards[0]).toContain("첫 카드");
    expect(doc.warnings).toHaveLength(0);
  });

  it("resolves style by Korean name and treats label-less first block as card", () => {
    const doc = expectDocument(
      parseDeckDocument(
        ["유형: 표지", "제목: 메타 없는 문서", "---", "제목: 두 번째"].join("\n"),
        styleNames
      )
    );

    expect(doc.styleId).toBeUndefined();
    expect(doc.cards).toHaveLength(2);
    expect(doc.cards[0]).toContain("메타 없는 문서");
  });

  it("accepts ## 카드 N headings as separators and ignores guide text", () => {
    const doc = expectDocument(
      parseDeckDocument(
        [
          "이 문서는 안내문입니다. 아래를 채우세요.",
          "스타일: 시네마틱 (사진)",
          "## 카드 1",
          "제목: 하나",
          "## 카드 2",
          "제목: 둘"
        ].join("\n"),
        styleNames
      )
    );

    expect(doc.styleId).toBe("cinematic");
    expect(doc.cards).toHaveLength(2);
  });

  it("collects warnings for unknown style and malformed color without failing", () => {
    const doc = expectDocument(
      parseDeckDocument(
        ["스타일: 없는스타일", "포인트색상: 빨강", "---", "제목: 카드"].join("\n"),
        styleNames
      )
    );

    expect(doc.styleId).toBeUndefined();
    expect(doc.accentColor).toBeUndefined();
    expect(doc.warnings).toHaveLength(2);
  });

  it("caps cards at 12 with a warning", () => {
    const body = Array.from({ length: 15 }, (_, i) => `---\n제목: 카드 ${i + 1}`).join("\n");
    const doc = expectDocument(parseDeckDocument(`헤더: X\n${body}`, styleNames));

    expect(doc.cards).toHaveLength(12);
    expect(doc.warnings.some((w) => w.includes("12"))).toBe(true);
  });

  it("rejects empty documents and documents without card blocks", () => {
    expect(isCardnewsError(parseDeckDocument("  \n ", styleNames))).toBe(true);
    expect(isCardnewsError(parseDeckDocument("헤더: X\n멘션: @y", styleNames))).toBe(true);
  });

  it("round-trips its own template document", () => {
    const doc = expectDocument(parseDeckDocument(buildTemplateDocument(styleNames), styleNames));

    expect(doc.headerLabel).toBe("MONEY NOTE");
    expect(doc.styleId).toBe("newsprint");
    expect(doc.cards.length).toBeGreaterThanOrEqual(3);
    expect(doc.warnings).toHaveLength(0);
  });
});

describe("parseDeckDocument (비율)", () => {
  it("parses a valid 비율 label and warns on unknown values", () => {
    const ok = expectDocument(
      parseDeckDocument("비율: 16:9\n---\n제목: 카드", styleNames)
    );
    expect(ok.aspectRatio).toBe("16:9");

    const bad = expectDocument(
      parseDeckDocument("비율: 9:16\n---\n제목: 카드", styleNames)
    );
    expect(bad.aspectRatio).toBeUndefined();
    expect(bad.warnings).toHaveLength(1);
  });
});
