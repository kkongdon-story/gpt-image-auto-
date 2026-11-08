import { describe, expect, it } from "vitest";
import type { BodyNumberStyle, CardTextBoxLayer, CardTypographyOverride } from "../domain/types.js";
import {
  applyBodyNumberToolbarPatch,
  applyCardTypographyToolbarPatch,
  applyTextLayerToolbarPatch,
  isEditorToolbarVisible,
  resolveEditorToolbarTarget
} from "./editorToolbar.js";

const textLayer: CardTextBoxLayer = {
  id: "text-1",
  kind: "text",
  text: "테스트",
  x: 10,
  y: 20,
  width: 30,
  height: 10,
  color: "#111111",
  fontSize: 32,
  fontWeight: 500,
  italic: false,
  align: "left"
};

describe("editor toolbar target semantics", () => {
  it("resolves text-layer and card-typography targets deterministically", () => {
    expect(resolveEditorToolbarTarget({ editMode: true, selectedLayer: textLayer })).toEqual({
      kind: "text-layer",
      layerId: "text-1"
    });
    expect(resolveEditorToolbarTarget({ editMode: true, selectedLayer: undefined })).toEqual({
      kind: "card-typography"
    });
    expect(
      resolveEditorToolbarTarget({
        editMode: true,
        selectedLayer: undefined,
        selectedSemanticSlotId: "card-2:body-number"
      })
    ).toEqual({
      kind: "body-number",
      slotId: "card-2:body-number"
    });
    expect(resolveEditorToolbarTarget({ editMode: false, selectedLayer: textLayer })).toBeNull();
    expect(isEditorToolbarVisible(null)).toBe(false);
    expect(isEditorToolbarVisible({ kind: "card-typography" })).toBe(true);
  });

  it("updates text layer toolbar fields without leaking into card typography", () => {
    const updated = applyTextLayerToolbarPatch(textLayer, {
      align: "center",
      color: "#abcdef",
      fontSize: 48,
      fontWeight: 800,
      italic: true
    });

    expect(updated).toMatchObject({
      align: "center",
      color: "#ABCDEF",
      fontSize: 48,
      fontWeight: 800,
      italic: true
    });
  });

  it("updates card typography toolbar fields without text layer fields", () => {
    const current: CardTypographyOverride = { color: "#101010", scope: "title", sizeScale: 1 };
    const updated = applyCardTypographyToolbarPatch(current, {
      color: "#123abc",
      italic: true,
      scope: "body",
      sizeScale: 1.2,
      weight: 900
    });

    expect(updated).toEqual({
      color: "#123ABC",
      italic: true,
      scope: "body",
      sizeScale: 1.2,
      weight: 900
    });
    expect("align" in updated).toBe(false);
  });

  it("updates body-number style independently and clamps persisted values", () => {
    const current: BodyNumberStyle = { color: "#111111", fontSize: 92, textAlign: "left" };
    const updated = applyBodyNumberToolbarPatch(current, {
      color: "#abcdef",
      fontSize: 999,
      fontWeight: 820,
      italic: true,
      textAlign: "right",
      textOpacity: -5
    });

    expect(updated).toEqual({
      color: "#ABCDEF",
      fontSize: 220,
      fontWeight: 820,
      italic: true,
      textAlign: "right",
      textOpacity: 0
    });
  });
});
