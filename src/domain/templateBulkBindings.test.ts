import { describe, expect, it } from "vitest";
import type { BulkBindingMetadata, WorkspaceState } from "./types.js";
import {
  TEMPLATE_BULK_V2_LIMITS,
  TEMPLATE_BULK_V2_SCHEMA,
  buildTemplateBulkSampleCsv,
  escapeTemplateBulkCsvValue,
  materializeTemplateBulkRow,
  preflightTemplateBulkCsv,
  validateBulkBindingMetadata
} from "./templateBulkBindings.js";

function isError(result: unknown): result is { readonly ok: false; readonly message: string } {
  return typeof result === "object" && result !== null && "ok" in result;
}

const metadata: BulkBindingMetadata = {
  schemaVersion: 1,
  templateId: "tmpl-money",
  templateRevision: 7,
  bindings: [
    {
      key: "deck_header",
      label: "Header",
      required: true,
      target: { kind: "deck", field: "header" }
    },
    {
      key: "card1_title",
      label: "Card 1 title",
      required: true,
      target: { kind: "standard", cardNumber: 1, field: "title" }
    },
    {
      key: "card1_bullets",
      label: "Card 1 bullets",
      required: false,
      target: { kind: "standard", cardNumber: 1, field: "bullets" }
    },
    {
      key: "custom_text",
      label: "Custom text",
      required: false,
      target: { kind: "layer-text", cardNumber: 1, layerId: "layer-text-1", property: "text" }
    }
  ]
};

describe("validateBulkBindingMetadata", () => {
  it("accepts the exact v2 metadata contract", () => {
    expect(validateBulkBindingMetadata(metadata)).toBe(metadata);
  });

  it("rejects reserved, duplicate, and unstable binding keys", () => {
    const reserved = {
      ...metadata,
      bindings: [{ ...metadata.bindings[0]!, key: "__schema" }]
    };
    const duplicate = {
      ...metadata,
      bindings: [metadata.bindings[0]!, { ...metadata.bindings[1]!, key: "deck_header" }]
    };
    const unstable = {
      ...metadata,
      bindings: [{ ...metadata.bindings[0]!, key: "1한글" }]
    };

    expect(isError(validateBulkBindingMetadata(reserved))).toBe(true);
    expect(isError(validateBulkBindingMetadata(duplicate))).toBe(true);
    expect(isError(validateBulkBindingMetadata(unstable))).toBe(true);
  });
});

describe("buildTemplateBulkSampleCsv", () => {
  it("builds stable reserved headers and formula-escaped sample values", () => {
    const withFormulaDefault: BulkBindingMetadata = {
      ...metadata,
      bindings: [
        ...metadata.bindings,
        {
          key: "formula_like",
          label: "Formula-like",
          required: false,
          defaultValue: "=SUM(A1:A2)",
          target: { kind: "standard", cardNumber: 1, field: "source" }
        }
      ]
    };

    const csv = buildTemplateBulkSampleCsv(withFormulaDefault);

    expect(isError(csv)).toBe(false);
    if (isError(csv)) {
      return;
    }
    expect(csv.split("\n")[0]).toBe(
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text,formula_like"
    );
    expect(csv).toContain(`${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,sample-deck`);
    expect(csv).toContain("'=SUM(A1:A2)");
  });

  it("escapes CSV syntax after applying formula protection", () => {
    expect(escapeTemplateBulkCsvValue("=1,2")).toBe("\"'=1,2\"");
  });
});

describe("preflightTemplateBulkCsv", () => {
  it("validates template identity, required values, unsafe output names, and limits before rendering", () => {
    const missingRequired = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,deck,MONEY,,one,two`
    ].join("\n");
    const traversal = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,..\\bad,MONEY,Title,one,two`
    ].join("\n");
    const mismatch = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      `${TEMPLATE_BULK_V2_SCHEMA},other,7,deck,MONEY,Title,one,two`
    ].join("\n");
    const extraHeader = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text,extra",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,deck,MONEY,Title,one,two,ignored`
    ].join("\n");
    const tooLargeCell = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,deck,MONEY,Title,one,${"a".repeat(
        TEMPLATE_BULK_V2_LIMITS.maxCellCharacters + 1
      )}`
    ].join("\n");

    expect(isError(preflightTemplateBulkCsv(missingRequired, metadata))).toBe(true);
    expect(isError(preflightTemplateBulkCsv(traversal, metadata))).toBe(true);
    expect(isError(preflightTemplateBulkCsv(mismatch, metadata))).toBe(true);
    expect(isError(preflightTemplateBulkCsv(extraHeader, metadata))).toBe(true);
    expect(isError(preflightTemplateBulkCsv(tooLargeCell, metadata))).toBe(true);
  });

  it("returns plain text row values without evaluating or unescaping formula-safe cells", () => {
    const csv = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,deck,MONEY,Title,"fixed\nvariable","'=SUM(A1:A2)"`
    ].join("\n");

    const result = preflightTemplateBulkCsv(csv, metadata);

    expect(isError(result)).toBe(false);
    if (isError(result)) {
      return;
    }
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.rowNumber).toBe(2);
    expect(result.rows[0]?.values["custom_text"]).toBe("'=SUM(A1:A2)");
  });

  it("keeps original CSV row numbers after skipped blank rows", () => {
    const csv = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      "",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,deck,MONEY,Title,one,two`
    ].join("\n");

    const result = preflightTemplateBulkCsv(csv, metadata);

    expect(isError(result)).toBe(false);
    if (isError(result)) {
      return;
    }
    expect(result.rows[0]?.rowNumber).toBe(3);
  });
});

describe("materializeTemplateBulkRow", () => {
  it("materializes one independent WorkspaceState-like row without mutating the template", () => {
    const template: WorkspaceState = {
      headerLabel: "OLD",
      footerAccount: "@old",
      styleId: "newsprint",
      cards: ["유형: 표지\n배지: OLD\n제목: Old title\n본문: Old body\n- old bullet"],
      overrides: {
        "1": {
          layers: [
            {
              id: "layer-text-1",
              kind: "text",
              text: "Old custom",
              x: 10,
              y: 10,
              width: 50,
              height: 20
            },
            {
              id: "shape-1",
              kind: "shape",
              shape: "rect",
              fill: "#000000",
              x: 0,
              y: 0,
              width: 10,
              height: 10
            }
          ]
        }
      }
    };
    const csv = [
      "__schema,__template_id,__template_revision,output_name,deck_header,card1_title,card1_bullets,custom_text",
      `${TEMPLATE_BULK_V2_SCHEMA},tmpl-money,7,row-1,NEW,New title,"first\nsecond",New custom`
    ].join("\n");
    const preflight = preflightTemplateBulkCsv(csv, metadata);
    expect(isError(preflight)).toBe(false);
    if (isError(preflight)) {
      return;
    }

    const materialized = materializeTemplateBulkRow(template, metadata, preflight.rows[0]!);

    expect(isError(materialized)).toBe(false);
    if (isError(materialized)) {
      return;
    }
    expect(materialized).not.toBe(template);
    expect(materialized.headerLabel).toBe("NEW");
    expect(materialized.cards[0]).toContain("제목: New title");
    expect(materialized.cards[0]).toContain("- first");
    expect(materialized.cards[0]).toContain("- second");
    expect(materialized.overrides?.["1"]?.layers?.[0]).toMatchObject({ id: "layer-text-1", text: "New custom" });
    expect(template.headerLabel).toBe("OLD");
    expect(template.cards[0]).toContain("Old title");
    expect(template.overrides?.["1"]?.layers?.[0]).toMatchObject({ text: "Old custom" });
  });

  it("updates the body standard slot without deleting the independent bullets slot", () => {
    const bodyMetadata: BulkBindingMetadata = {
      schemaVersion: 1,
      templateId: "tmpl-money",
      templateRevision: 7,
      bindings: [
        {
          key: "card1_body",
          label: "Card 1 body",
          required: true,
          target: { kind: "standard", cardNumber: 1, field: "body" }
        }
      ]
    };
    const template: WorkspaceState = {
      headerLabel: "OLD",
      footerAccount: "@old",
      styleId: "newsprint",
      cards: ["유형: 본문\n제목: Title\n본문: Old body\n- keep bullet"]
    };

    const materialized = materializeTemplateBulkRow(template, bodyMetadata, {
      rowNumber: 2,
      outputName: "row",
      values: { card1_body: "New body" }
    });

    expect(isError(materialized)).toBe(false);
    if (isError(materialized)) {
      return;
    }
    expect(materialized.cards[0]).toContain("본문: New body");
    expect(materialized.cards[0]).toContain("- keep bullet");
  });
});
