import { describe, expect, it } from "vitest";
import { buildBulkCsvTemplate, parseBulkCsv } from "./csvBulk.js";

function isError(result: unknown): result is { readonly ok: false; readonly message: string } {
  return typeof result === "object" && result !== null && "ok" in result;
}

describe("parseBulkCsv", () => {
  it("parses valid rows and keeps row-scoped failures", () => {
    const text = [
      "output_name,header_label,footer_account,style_id,aspect_ratio,card_01,card_02,dim",
      "\"ok deck\",MONEY,@me,newsprint,portrait,\"유형: 표지\n제목: 시작\",\"유형: 본문\n제목: 둘째\",65",
      "bad,MONEY,@me,missing,portrait,\"유형: 표지\n제목: 시작\",\"유형: 본문\n제목: 둘째\","
    ].join("\n");

    const parsed = parseBulkCsv(text, ["newsprint"], ["portrait"]);

    expect(isError(parsed)).toBe(false);
    if (isError(parsed)) {
      return;
    }
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues).toEqual([{ rowNumber: 3, message: "style_id를 찾을 수 없습니다: missing" }]);
    expect(parsed.rows[0]?.deckDraft.backgroundDim).toBe(0.65);
  });

  it("builds a template that the parser accepts", () => {
    const template = buildBulkCsvTemplate("newsprint", "portrait");
    const parsed = parseBulkCsv(template, ["newsprint"], ["portrait"]);

    expect(isError(parsed)).toBe(false);
    if (isError(parsed)) {
      return;
    }
    expect(parsed.rows[0]?.outputName).toBe("sample-deck");
  });
});

describe("parseBulkCsv (BOM 라운드트립)", () => {
  it("strips a leading UTF-8 BOM from exported templates", () => {
    const styleIds = ["newsprint"];
    const ratios = ["4:5"];
    const plain = buildBulkCsvTemplate("newsprint", "4:5");
    const withBom = "﻿" + plain;

    const parsedPlain = parseBulkCsv(plain, styleIds, ratios);
    const parsedBom = parseBulkCsv(withBom, styleIds, ratios);

    expect("ok" in parsedBom && parsedBom.ok === false).toBe(false);
    expect(JSON.stringify(parsedBom)).toBe(JSON.stringify(parsedPlain));
  });
});
