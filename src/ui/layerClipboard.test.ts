import { describe, expect, it } from "vitest";
import type { CardLayer } from "../domain/types.js";
import {
  copyLayerToClipboard,
  createLayerClipboardState,
  cutLayerToClipboard,
  isNativeClipboardTarget,
  pasteLayerFromClipboard,
  resolveLayerClipboardCommand,
  shouldUseNativeClipboard
} from "./layerClipboard.js";

const textLayer: CardLayer = {
  id: "text-1",
  kind: "text",
  text: "본문",
  x: 10,
  y: 20,
  width: 100,
  height: 40,
  color: "#111111",
  backgroundColor: "transparent",
  fontSize: 28,
  fontWeight: 700,
  italic: true,
  align: "center",
  textOpacity: 80,
  zIndex: 2,
  opacity: 90
};

const shapeLayer: CardLayer = {
  id: "shape-1",
  kind: "shape",
  shape: "ellipse",
  x: 180,
  y: 130,
  width: 40,
  height: 30,
  fill: "#abcdef",
  stroke: "#123456",
  strokeWidth: 3,
  radius: 8,
  opacity: 70
};

const lineLayer: CardLayer = {
  id: "line-1",
  kind: "line",
  x1: 180,
  y1: 135,
  x2: 230,
  y2: 155,
  thickness: 4,
  color: "#ff0000",
  opacity: 60,
  zIndex: 5
};

const imageLayer: CardLayer = {
  id: "image-1",
  kind: "image",
  backgroundId: "asset-1",
  objectFit: "contain",
  x: 30,
  y: 40,
  width: 70,
  height: 50,
  opacity: 50
};

const layers: readonly CardLayer[] = [textLayer, shapeLayer, lineLayer, imageLayer];
const bounds = { width: 240, height: 180 };

describe("layer clipboard pure operations", () => {
  it("copies a non-mutating snapshot", () => {
    const original = layers.map((layer) => ({ ...layer }));
    const result = copyLayerToClipboard(layers, "text-1");

    expect(result.status).toBe("copied");
    expect(result.layers).toBe(layers);
    expect(result.clipboard.snapshot).toEqual(textLayer);
    expect(result.clipboard.snapshot).not.toBe(textLayer);
    expect(layers).toEqual(original);
  });

  it("cuts only after a clipboard snapshot succeeds", () => {
    const stale = cutLayerToClipboard(layers, "missing", createLayerClipboardState());

    expect(stale.status).toBe("noop");
    expect(stale.layers).toBe(layers);
    expect(stale.clipboard.snapshot).toBeUndefined();

    const cut = cutLayerToClipboard(layers, "shape-1", createLayerClipboardState());

    expect(cut.status).toBe("cut");
    expect(cut.clipboard.snapshot).toEqual(shapeLayer);
    expect(cut.layers.map((layer) => layer.id)).toEqual(["text-1", "line-1", "image-1"]);
    expect(layers.map((layer) => layer.id)).toEqual(["text-1", "shape-1", "line-1", "image-1"]);
  });

  it("pastes with a new id, predictable offset, clamp, and selected pasted layer", () => {
    const copied = copyLayerToClipboard(layers, "shape-1");
    const pasted = pasteLayerFromClipboard({
      layers,
      clipboard: copied.clipboard,
      bounds,
      idFactory: (_source, pasteIndex) => `shape-copy-${pasteIndex}`
    });

    expect(pasted.status).toBe("pasted");
    expect(pasted.selectedLayerId).toBe("shape-copy-1");
    expect(pasted.clipboard.pasteCount).toBe(1);
    expect(pasted.layers).toHaveLength(layers.length + 1);
    expect(pasted.layers.at(-1)).toEqual({
      ...shapeLayer,
      id: "shape-copy-1",
      x: 192,
      y: 142
    });
  });

  it("repeated paste produces unique ids and cumulative deterministic offsets", () => {
    const copied = copyLayerToClipboard(layers, "text-1");
    const first = pasteLayerFromClipboard({
      layers,
      clipboard: copied.clipboard,
      bounds,
      idFactory: (_source, pasteIndex) => `text-copy-${pasteIndex}`
    });
    const second = pasteLayerFromClipboard({
      layers: first.layers,
      clipboard: first.clipboard,
      bounds,
      idFactory: (_source, pasteIndex) => `text-copy-${pasteIndex}`
    });

    expect(first.layers.at(-1)).toMatchObject({ id: "text-copy-1", x: 22, y: 32 });
    expect(second.layers.at(-1)).toMatchObject({ id: "text-copy-2", x: 34, y: 44 });
    expect(new Set(second.layers.map((layer) => layer.id)).size).toBe(second.layers.length);
  });

  it("copies on one page and pastes into another page", () => {
    const copied = copyLayerToClipboard(layers, "image-1");
    const pageB: readonly CardLayer[] = [];
    const pasted = pasteLayerFromClipboard({
      layers: pageB,
      clipboard: copied.clipboard,
      bounds,
      idFactory: () => "image-page-b"
    });

    expect(pasted.layers).toEqual([
      {
        ...imageLayer,
        id: "image-page-b",
        x: 42,
        y: 52
      }
    ]);
    expect(copied.clipboard.snapshot).toEqual(imageLayer);
  });

  it("preserves text, shape, line, and image subtype properties", () => {
    const pastedLayers = layers.map((layer) => {
      const copied = copyLayerToClipboard(layers, layer.id);
      const pasted = pasteLayerFromClipboard({
        layers: [],
        clipboard: copied.clipboard,
        bounds,
        idFactory: () => `${layer.id}-copy`
      });
      return pasted.layers[0];
    });

    expect(pastedLayers[0]).toMatchObject({
      kind: "text",
      text: "본문",
      color: "#111111",
      backgroundColor: "transparent",
      fontSize: 28,
      fontWeight: 700,
      italic: true,
      align: "center",
      textOpacity: 80
    });
    expect(pastedLayers[1]).toMatchObject({
      kind: "shape",
      shape: "ellipse",
      fill: "#abcdef",
      stroke: "#123456",
      strokeWidth: 3,
      radius: 8
    });
    expect(pastedLayers[2]).toMatchObject({
      kind: "line",
      thickness: 4,
      color: "#ff0000",
      x1: 190,
      y1: 147,
      x2: 240,
      y2: 167
    });
    expect(pastedLayers[3]).toMatchObject({
      kind: "image",
      backgroundId: "asset-1",
      objectFit: "contain"
    });
  });

  it("treats empty clipboard, no selection, and stale selection as no-ops", () => {
    expect(copyLayerToClipboard(layers, undefined).status).toBe("noop");
    expect(copyLayerToClipboard(layers, "deleted").status).toBe("noop");
    expect(
      pasteLayerFromClipboard({
        layers,
        clipboard: createLayerClipboardState(),
        bounds,
        idFactory: () => "unused"
      })
    ).toMatchObject({ status: "noop", layers });
  });
});

describe("layer clipboard shortcut arbitration", () => {
  it("guards native clipboard targets and inline/IME composition", () => {
    expect(isNativeClipboardTarget(element("input"))).toBe(true);
    expect(isNativeClipboardTarget(element("textarea"))).toBe(true);
    expect(isNativeClipboardTarget(element("select"))).toBe(true);
    expect(isNativeClipboardTarget(element("div", { contentEditable: true }))).toBe(true);
    expect(isNativeClipboardTarget(element("span", { parentElement: element("div", { contentEditable: true }) }))).toBe(
      true
    );
    expect(isNativeClipboardTarget(element("button"))).toBe(false);

    expect(shouldUseNativeClipboard({ inlineEditActive: true })).toBe(true);
    expect(shouldUseNativeClipboard({ isComposing: true })).toBe(true);
  });

  it("resolves Ctrl and Meta command variants through the same helper", () => {
    expect(resolveLayerClipboardCommand({ key: "c", ctrlKey: true }, { editMode: true })).toBe("copy");
    expect(resolveLayerClipboardCommand({ key: "x", metaKey: true }, { editMode: true })).toBe("cut");
    expect(resolveLayerClipboardCommand({ key: "V", ctrlKey: true }, { editMode: true })).toBe("paste");
    expect(resolveLayerClipboardCommand({ key: "v", metaKey: true }, { editMode: true })).toBe("paste");
  });

  it("lets browser clipboard win for text editing targets and inactive editor states", () => {
    expect(resolveLayerClipboardCommand({ key: "c", ctrlKey: true }, { editMode: false })).toBeNull();
    expect(
      resolveLayerClipboardCommand(
        { key: "c", ctrlKey: true, target: element("textarea") },
        { editMode: true }
      )
    ).toBeNull();
    expect(resolveLayerClipboardCommand({ key: "x", ctrlKey: true }, { editMode: true, inlineEditActive: true })).toBeNull();
    expect(resolveLayerClipboardCommand({ key: "v", ctrlKey: true, isComposing: true }, { editMode: true })).toBeNull();
    expect(resolveLayerClipboardCommand({ key: "c", ctrlKey: true, shiftKey: true }, { editMode: true })).toBeNull();
  });
});

function element(
  tagName: string,
  options: {
    readonly contentEditable?: boolean;
    readonly parentElement?: unknown;
  } = {}
): EventTarget {
  return {
    tagName,
    isContentEditable: options.contentEditable ?? false,
    parentElement: options.parentElement,
    getAttribute(name: string): string | null {
      if (name === "contenteditable" && options.contentEditable) {
        return "true";
      }
      return null;
    }
  } as unknown as EventTarget;
}
