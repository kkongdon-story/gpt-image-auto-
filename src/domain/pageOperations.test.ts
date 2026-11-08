import { describe, expect, it } from "vitest";
import type { BulkBindingMetadata, Card, CardOverrideMap } from "./types.js";
import { deletePage, duplicatePage, insertPageAfter, insertPageBefore } from "./pageOperations.js";

const idFactory = (sourceId: string) => `${sourceId}__copy`;
const bindingKeyFactory = (sourceKey: string) => `${sourceKey}_copy`;

function card(index: number, title = `card-${index}`): Card {
  return {
    index,
    type: index === 1 ? "cover" : "body",
    title,
    paragraphs: [`paragraph-${index}`],
    bullets: [`bullet-${index}`],
    backgroundId: `card-bg-${index}`
  };
}

const cards = [card(1), card(2), card(3)];

const overrides: CardOverrideMap = {
  "1": {
    backgroundId: "override-bg-1",
    layers: [
      {
        id: "text-1",
        kind: "text",
        text: "Text",
        x: 1,
        y: 2,
        width: 30,
        height: 10,
        backgroundColor: "transparent"
      }
    ]
  },
  "3": {
    backgroundId: "override-bg-3",
    layers: [
      {
        id: "image-3",
        kind: "image",
        backgroundId: "asset-image-3",
        x: 3,
        y: 4,
        width: 30,
        height: 20
      }
    ]
  }
};

const bulkBindings: BulkBindingMetadata = {
  schemaVersion: 1,
  templateId: "template",
  templateRevision: 7,
  bindings: [
    {
      key: "deck_header",
      label: "Deck header",
      required: true,
      target: { kind: "deck", field: "header" }
    },
    {
      key: "page_one_title",
      label: "Page 1 title",
      required: true,
      target: { kind: "standard", cardNumber: 1, field: "title" }
    },
    {
      key: "page_three_layer",
      label: "Page 3 layer",
      required: false,
      target: { kind: "layer-text", cardNumber: 3, layerId: "image-3", property: "text" }
    }
  ]
};

describe("page operation transactions", () => {
  it("inserts before first, middle, and last pages with 1-based override and binding mapping", () => {
    expect(insertPageBefore({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 0)).toMatchObject({
      cards: [{ index: 1, title: "새 페이지" }, { index: 2, title: "card-1" }, { index: 3, title: "card-2" }, { index: 4, title: "card-3" }],
      overrides: { "2": overrides["1"], "4": overrides["3"] },
      selectedIndex: 0
    });

    const middle = insertPageBefore({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 1);
    expect(middle.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "새 페이지", "card-2", "card-3"]);
    expect(Object.keys(middle.overrides ?? {})).toEqual(["1", "4"]);
    expect(middle.bulkBindings?.bindings.map((binding) => binding.target)).toEqual([
      { kind: "deck", field: "header" },
      { kind: "standard", cardNumber: 1, field: "title" },
      { kind: "layer-text", cardNumber: 4, layerId: "image-3", property: "text" }
    ]);
    expect(middle.selectedIndex).toBe(1);

    const last = insertPageBefore({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 2);
    expect(last.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "card-2", "새 페이지", "card-3"]);
    expect(Object.keys(last.overrides ?? {})).toEqual(["1", "4"]);
    expect(last.selectedIndex).toBe(2);
  });

  it("inserts after first, middle, and last pages with PRD mapping", () => {
    const first = insertPageAfter({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 0);
    expect(first.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "새 페이지", "card-2", "card-3"]);
    expect(Object.keys(first.overrides ?? {})).toEqual(["1", "4"]);
    expect(first.selectedIndex).toBe(1);

    const middle = insertPageAfter({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 1);
    expect(middle.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "card-2", "새 페이지", "card-3"]);
    expect(Object.keys(middle.overrides ?? {})).toEqual(["1", "4"]);
    expect(middle.selectedIndex).toBe(2);

    const last = insertPageAfter({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 2);
    expect(last.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "card-2", "card-3", "새 페이지"]);
    expect(Object.keys(last.overrides ?? {})).toEqual(["1", "3"]);
    expect(last.selectedIndex).toBe(3);
  });

  it("duplicates a page, remints layer IDs, preserves asset refs, and creates unique binding keys", () => {
    const sourceOverrides: CardOverrideMap = {
      "1": {
        backgroundId: "override-bg-1",
        badge: { imageId: "badge-asset" },
        layers: [
          { id: "text-layer", kind: "text", text: "A", x: 1, y: 1, width: 10, height: 10 },
          { id: "shape-layer", kind: "shape", shape: "rect", fill: "#fff", x: 2, y: 2, width: 10, height: 10 },
          { id: "line-layer", kind: "line", x1: 0, y1: 0, x2: 10, y2: 10, thickness: 2, color: "#111111" },
          { id: "image-layer", kind: "image", backgroundId: "shared-image-asset", x: 3, y: 3, width: 10, height: 10 }
        ]
      },
      "3": overrides["3"]!
    };
    const sourceBindings: BulkBindingMetadata = {
      ...bulkBindings,
      bindings: [
        ...bulkBindings.bindings,
        {
          key: "custom_text",
          label: "Custom text",
          required: false,
          target: { kind: "layer-text", cardNumber: 1, layerId: "text-layer", property: "text" }
        },
        {
          key: "standard_title",
          label: "Standard title",
          required: false,
          target: { kind: "standard", cardNumber: 1, field: "title" }
        }
      ]
    };

    const result = duplicatePage(
      { cards, overrides: sourceOverrides, bulkBindings: sourceBindings, idFactory, bindingKeyFactory },
      0
    );

    expect(result.cards.map((nextCard) => [nextCard.index, nextCard.title, nextCard.backgroundId])).toEqual([
      [1, "card-1", "card-bg-1"],
      [2, "card-1", "card-bg-1"],
      [3, "card-2", "card-bg-2"],
      [4, "card-3", "card-bg-3"]
    ]);
    expect(Object.keys(result.overrides ?? {})).toEqual(["1", "2", "4"]);
    expect(result.overrides?.["1"]?.layers?.map((layer) => layer.id)).toEqual([
      "text-layer",
      "shape-layer",
      "line-layer",
      "image-layer"
    ]);
    expect(result.overrides?.["2"]?.layers?.map((layer) => layer.id)).toEqual([
      "text-layer__copy",
      "shape-layer__copy",
      "line-layer__copy",
      "image-layer__copy"
    ]);
    expect(result.overrides?.["2"]?.backgroundId).toBe("override-bg-1");
    expect(result.overrides?.["2"]?.badge?.imageId).toBe("badge-asset");
    expect(result.overrides?.["2"]?.layers?.[3]).toMatchObject({ kind: "image", backgroundId: "shared-image-asset" });
    expect(result.bulkBindings?.bindings.map((binding) => binding.key)).toEqual([
      "deck_header",
      "page_one_title",
      "page_three_layer",
      "custom_text",
      "standard_title",
      "page_one_title_copy",
      "custom_text_copy",
      "standard_title_copy"
    ]);
    expect(result.bulkBindings?.bindings.at(-2)?.target).toEqual({
      kind: "layer-text",
      cardNumber: 2,
      layerId: "text-layer__copy",
      property: "text"
    });
    expect(result.bulkBindings?.bindings.at(-1)?.target).toEqual({
      kind: "standard",
      cardNumber: 2,
      field: "title"
    });
    expect(result.selectedIndex).toBe(1);
  });

  it("duplicates body-number state independently and remaps semantic item ids to the copied page", () => {
    const placement = {
      mode: "card" as const,
      x: 11,
      y: 22,
      width: 20,
      height: 10,
      anchor: "top-left" as const
    };
    const bodyNumberOverrides = {
      "1": {
        bodyNumberMode: "show",
        bodyNumberText: "첫 번째",
        semanticItemPlacements: {
          "card-1:body-number": placement,
          "card-1:title": { ...placement, y: 36 }
        }
      }
    } as CardOverrideMap;

    const result = duplicatePage(
      { cards, overrides: bodyNumberOverrides, idFactory, bindingKeyFactory },
      0
    );
    const source = result.overrides?.["1"] as
      | (NonNullable<CardOverrideMap[string]> & { readonly bodyNumberText?: string })
      | undefined;
    const copy = result.overrides?.["2"] as
      | (NonNullable<CardOverrideMap[string]> & { readonly bodyNumberText?: string })
      | undefined;

    expect(source?.bodyNumberText).toBe("첫 번째");
    expect(copy?.bodyNumberText).toBe("첫 번째");
    expect(copy).not.toBe(source);
    expect(copy?.semanticItemPlacements).not.toBe(source?.semanticItemPlacements);
    expect(Object.keys(source?.semanticItemPlacements ?? {})).toEqual([
      "card-1:body-number",
      "card-1:title"
    ]);
    expect(Object.keys(copy?.semanticItemPlacements ?? {})).toEqual([
      "card-2:body-number",
      "card-2:title"
    ]);
  });

  it("remaps semantic item ids whenever inserting a page changes an existing card number", () => {
    const result = insertPageBefore(
      {
        cards,
        overrides: {
          "1": {
            semanticItemPlacements: {
              "card-1:body-number": {
                mode: "card",
                x: 10,
                y: 20,
                width: 30,
                height: 10,
                anchor: "top-left"
              }
            }
          }
        },
        idFactory,
        bindingKeyFactory
      },
      0
    );

    expect(result.overrides?.["2"]?.semanticItemPlacements).toHaveProperty("card-2:body-number");
    expect(result.overrides?.["2"]?.semanticItemPlacements).not.toHaveProperty("card-1:body-number");
  });

  it("deletes first, middle, and last pages and guards the last remaining page", () => {
    const first = deletePage({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 0);
    expect(first.cards.map((nextCard) => nextCard.title)).toEqual(["card-2", "card-3"]);
    expect(Object.keys(first.overrides ?? {})).toEqual(["2"]);
    expect(first.bulkBindings?.bindings.map((binding) => binding.target)).toEqual([
      { kind: "deck", field: "header" },
      { kind: "layer-text", cardNumber: 2, layerId: "image-3", property: "text" }
    ]);
    expect(first.selectedIndex).toBe(0);

    const middle = deletePage({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 1);
    expect(middle.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "card-3"]);
    expect(Object.keys(middle.overrides ?? {})).toEqual(["1", "2"]);
    expect(middle.selectedIndex).toBe(1);

    const last = deletePage({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory }, 2);
    expect(last.cards.map((nextCard) => nextCard.title)).toEqual(["card-1", "card-2"]);
    expect(Object.keys(last.overrides ?? {})).toEqual(["1"]);
    expect(last.selectedIndex).toBe(1);

    const singleCard = [card(0)];
    const guarded = deletePage({ cards: singleCard, idFactory, bindingKeyFactory }, 0);
    expect(guarded.cards).toBe(singleCard);
    expect(guarded.selectedIndex).toBe(0);
    expect(guarded.warnings).toEqual(["Cannot delete the last remaining page."]);
  });

  it("does not mutate source cards, overrides, or bulk binding metadata", () => {
    const sourceCards = [card(0), card(1)];
    const sourceOverrides: CardOverrideMap = {
      "1": {
        layers: [{ id: "layer", kind: "text", text: "A", x: 1, y: 1, width: 10, height: 10 }]
      }
    };
    const sourceBindings: BulkBindingMetadata = {
      schemaVersion: 1,
      templateId: "template",
      templateRevision: 1,
      bindings: [
        {
          key: "layer_text",
          label: "Layer text",
          required: false,
          target: { kind: "layer-text", cardNumber: 1, layerId: "layer", property: "text" }
        }
      ]
    };
    const before = JSON.stringify({ sourceCards, sourceOverrides, sourceBindings });

    duplicatePage({ cards: sourceCards, overrides: sourceOverrides, bulkBindings: sourceBindings, idFactory, bindingKeyFactory }, 0);

    expect(JSON.stringify({ sourceCards, sourceOverrides, sourceBindings })).toBe(before);
  });

  it("keeps deterministic output with injected factories and falls back when binding keys collide", () => {
    const collisionFactory = () => "page_one_title";
    const first = duplicatePage({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory: collisionFactory }, 0);
    const second = duplicatePage({ cards, overrides, bulkBindings, idFactory, bindingKeyFactory: collisionFactory }, 0);

    expect(first).toEqual(second);
    expect(first.bulkBindings?.bindings.map((binding) => binding.key)).toEqual([
      "deck_header",
      "page_one_title",
      "page_three_layer",
      "page_one_title_2"
    ]);
  });
});
