import { describe, expect, it } from "vitest";
import type { Card, CardOverride } from "./types.js";
import {
  buildSemanticItemManifest,
  createSemanticItemId,
  normalizeSemanticIdentity,
  removeSemanticItemPlacement,
  semanticSlotPlacementToItemPlacement,
  setSemanticItemPlacement
} from "./m23Semantic.js";

const card: Card = {
  index: 1,
  type: "body",
  badge: "NOTE",
  title: "Stable title",
  subtitle: "Stable subtitle",
  paragraphs: ["First paragraph", "Second paragraph", "Third paragraph"],
  bullets: ["First bullet", "Second bullet", "Third bullet"],
  source: "Source",
  emphasis: "Emphasis"
};

describe("M23 semantic identity", () => {
  it("migrates legacy semanticSlots to per-item placements without removing the legacy slots", () => {
    const override: CardOverride = {
      semanticSlots: {
        body: { mode: "card", x: 10, y: 20, width: 80, height: 30, anchor: "top-left" },
        title: { mode: "card", x: 12, y: 8, width: 70, height: 10, anchor: "top-center" }
      }
    };

    const migrated = normalizeSemanticIdentity({ card, override });
    const firstParagraphId = createSemanticItemId(1, "paragraph", migrated.semanticContentKeys?.paragraphs?.[0]?.key);

    expect(migrated.semanticSlots).toBe(override.semanticSlots);
    expect(migrated.semanticItemPlacements?.[createSemanticItemId(1, "title")]).toEqual({
      mode: "card",
      x: 12,
      y: 8,
      width: 70,
      height: 10,
      anchor: "top-center"
    });
    expect(migrated.semanticItemPlacements?.[firstParagraphId]).toEqual({
      mode: "card",
      x: 10,
      y: 20,
      width: 80,
      height: 30,
      anchor: "top-left"
    });
  });

  it("keeps paragraph and bullet content keys stable across reorder and text edit", () => {
    const initial = normalizeSemanticIdentity({ card });
    const editedCard: Card = {
      ...card,
      paragraphs: ["Third paragraph", "First paragraph edited", "Second paragraph"],
      bullets: ["Third bullet", "First bullet", "Second bullet edited"]
    };
    const edited = normalizeSemanticIdentity({
      card: editedCard,
      previousCard: card,
      override: initial
    });

    expect(edited.semanticContentKeys?.paragraphs?.map((ref) => ref.key)).toEqual([
      initial.semanticContentKeys?.paragraphs?.[2]?.key,
      initial.semanticContentKeys?.paragraphs?.[0]?.key,
      initial.semanticContentKeys?.paragraphs?.[1]?.key
    ]);
    expect(new Set(edited.semanticContentKeys?.paragraphs?.map((ref) => ref.key)).size).toBe(3);
    expect(edited.semanticContentKeys?.bullets?.map((ref) => ref.key)).toEqual([
      initial.semanticContentKeys?.bullets?.[2]?.key,
      initial.semanticContentKeys?.bullets?.[0]?.key,
      initial.semanticContentKeys?.bullets?.[1]?.key
    ]);
    expect(new Set(edited.semanticContentKeys?.bullets?.map((ref) => ref.key)).size).toBe(3);
  });

  it("allocates a new key for added content without reusing still-live IDs", () => {
    const initial = normalizeSemanticIdentity({ card });
    const expandedCard: Card = {
      ...card,
      paragraphs: ["Inserted paragraph", ...card.paragraphs]
    };
    const expanded = normalizeSemanticIdentity({
      card: expandedCard,
      previousCard: card,
      override: initial
    });
    const initialKeys = initial.semanticContentKeys?.paragraphs?.map((ref) => ref.key) ?? [];
    const expandedKeys = expanded.semanticContentKeys?.paragraphs?.map((ref) => ref.key) ?? [];

    expect(expandedKeys.slice(1)).toEqual(initialKeys);
    expect(initialKeys).not.toContain(expandedKeys[0]);
    expect(new Set(expandedKeys).size).toBe(expandedKeys.length);
  });

  it("builds renderer/UI manifest entries for static, paragraph, and bullet items", () => {
    const override = normalizeSemanticIdentity({ card, footerAccount: "@kkongdon" });
    const manifest = buildSemanticItemManifest({ card, footerAccount: "@kkongdon", override });

    expect(manifest.map((item) => item.kind)).toEqual([
      "title",
      "subtitle",
      "badge-text",
      "emphasis",
      "source",
      "footer",
      "paragraph",
      "paragraph",
      "paragraph",
      "bullet",
      "bullet",
      "bullet"
    ]);
    expect(manifest.every((item) => item.id.length > 0)).toBe(true);
    expect(new Set(manifest.map((item) => item.id)).size).toBe(manifest.length);
    expect(manifest.find((item) => item.kind === "footer")?.text).toBe("@kkongdon");
  });

  it("updates and removes item placements by semantic item id", () => {
    const itemId = createSemanticItemId(1, "title");
    const placed = setSemanticItemPlacement({}, itemId, {
      mode: "card",
      x: 120,
      y: -1,
      width: 40,
      height: 12,
      anchor: "top-right"
    });

    expect(placed.semanticItemPlacements?.[itemId]).toEqual({
      mode: "card",
      x: 100,
      y: 0,
      width: 40,
      height: 12,
      anchor: "top-right"
    });
    expect(removeSemanticItemPlacement(placed, itemId).semanticItemPlacements).toBeUndefined();
  });

  it("converts legacy optional slot size into required item placement size", () => {
    expect(
      semanticSlotPlacementToItemPlacement({
        mode: "card",
        x: 5,
        y: 6,
        anchor: "top-left"
      })
    ).toEqual({
      mode: "card",
      x: 5,
      y: 6,
      width: 1,
      height: 1,
      anchor: "top-left"
    });
  });
});
