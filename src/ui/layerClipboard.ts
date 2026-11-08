import type { CardLayer } from "../domain/types.js";

export type LayerClipboardCommand = "copy" | "cut" | "paste";

export type LayerClipboardBounds = {
  readonly width: number;
  readonly height: number;
};

export type LayerClipboardState = {
  readonly snapshot?: CardLayer;
  readonly pasteCount: number;
};

export type LayerClipboardResult = {
  readonly clipboard: LayerClipboardState;
  readonly layers: readonly CardLayer[];
  readonly selectedLayerId?: string;
  readonly status: "copied" | "cut" | "pasted" | "noop";
};

export type LayerClipboardKeyboardLike = {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
  readonly target?: EventTarget | null;
};

export type NativeClipboardGuardInput = {
  readonly target?: EventTarget | null | undefined;
  readonly inlineEditActive?: boolean | undefined;
  readonly isComposing?: boolean | undefined;
};

export type LayerClipboardCommandContext = NativeClipboardGuardInput & {
  readonly editMode?: boolean;
};

export type IdFactory = (source: CardLayer, pasteIndex: number) => string;

const DEFAULT_OFFSET = 12;

const EMPTY_CLIPBOARD: LayerClipboardState = { pasteCount: 0 };

export function createLayerClipboardState(): LayerClipboardState {
  return EMPTY_CLIPBOARD;
}

export function copyLayerToClipboard(
  layers: readonly CardLayer[],
  selectedLayerId: string | undefined,
  clipboard: LayerClipboardState = EMPTY_CLIPBOARD
): LayerClipboardResult {
  const selectedLayer = findLayer(layers, selectedLayerId);
  if (!selectedLayer) {
    return { clipboard, layers, status: "noop" };
  }

  return {
    clipboard: { snapshot: cloneLayer(selectedLayer), pasteCount: 0 },
    layers,
    selectedLayerId: selectedLayer.id,
    status: "copied"
  };
}

export function cutLayerToClipboard(
  layers: readonly CardLayer[],
  selectedLayerId: string | undefined,
  clipboard: LayerClipboardState = EMPTY_CLIPBOARD
): LayerClipboardResult {
  const copyResult = copyLayerToClipboard(layers, selectedLayerId, clipboard);
  if (copyResult.status !== "copied") {
    return copyResult;
  }

  return {
    clipboard: copyResult.clipboard,
    layers: layers.filter((layer) => layer.id !== selectedLayerId),
    status: "cut"
  };
}

export function pasteLayerFromClipboard(input: {
  readonly layers: readonly CardLayer[];
  readonly clipboard: LayerClipboardState;
  readonly idFactory: IdFactory;
  readonly bounds: LayerClipboardBounds;
  readonly offset?: number;
}): LayerClipboardResult {
  const snapshot = input.clipboard.snapshot;
  if (!snapshot) {
    return { clipboard: input.clipboard, layers: input.layers, status: "noop" };
  }

  const pasteCount = input.clipboard.pasteCount + 1;
  const offset = input.offset ?? DEFAULT_OFFSET;
  const pastedLayer = cloneWithGeometry(snapshot, {
    bounds: input.bounds,
    id: input.idFactory(snapshot, pasteCount),
    offset: offset * pasteCount
  });

  return {
    clipboard: { snapshot, pasteCount },
    layers: [...input.layers, pastedLayer],
    selectedLayerId: pastedLayer.id,
    status: "pasted"
  };
}

export function resolveLayerClipboardCommand(
  event: LayerClipboardKeyboardLike,
  context: LayerClipboardCommandContext = {}
): LayerClipboardCommand | null {
  if (!context.editMode || shouldUseNativeClipboard({ ...context, target: event.target, isComposing: event.isComposing })) {
    return null;
  }

  if (event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey)) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "c") {
    return "copy";
  }
  if (key === "x") {
    return "cut";
  }
  if (key === "v") {
    return "paste";
  }

  return null;
}

export function shouldUseNativeClipboard(input: NativeClipboardGuardInput): boolean {
  return Boolean(input.inlineEditActive || input.isComposing || isNativeClipboardTarget(input.target));
}

export function isNativeClipboardTarget(target: EventTarget | null | undefined): boolean {
  let current: unknown = target;
  while (isElementLike(current)) {
    if (current.isContentEditable) {
      return true;
    }

    const tagName = current.tagName?.toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return true;
    }

    const contentEditable = current.getAttribute?.("contenteditable");
    if (contentEditable !== undefined && contentEditable !== null && contentEditable.toLowerCase() !== "false") {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function findLayer(layers: readonly CardLayer[], selectedLayerId: string | undefined): CardLayer | undefined {
  if (!selectedLayerId) {
    return undefined;
  }
  return layers.find((layer) => layer.id === selectedLayerId);
}

function cloneLayer<T extends CardLayer>(layer: T): T {
  return { ...layer };
}

function cloneWithGeometry(
  layer: CardLayer,
  input: { readonly bounds: LayerClipboardBounds; readonly id: string; readonly offset: number }
): CardLayer {
  if (layer.kind === "line") {
    const translated = translateLine(layer, input.offset);
    return { ...translated, id: input.id, ...clampLine(translated, input.bounds) };
  }

  return {
    ...layer,
    id: input.id,
    ...clampBox(
      {
        x: layer.x + input.offset,
        y: layer.y + input.offset,
        width: layer.width,
        height: layer.height
      },
      input.bounds
    )
  };
}

function translateLine(
  layer: Extract<CardLayer, { readonly kind: "line" }>,
  offset: number
): Extract<CardLayer, { readonly kind: "line" }> {
  return {
    ...layer,
    x1: layer.x1 + offset,
    y1: layer.y1 + offset,
    x2: layer.x2 + offset,
    y2: layer.y2 + offset
  };
}

function clampBox(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  bounds: LayerClipboardBounds
): Pick<Extract<CardLayer, { readonly kind: "text" | "shape" | "image" }>, "x" | "y" | "width" | "height"> {
  return {
    x: clamp(box.x, 0, Math.max(0, bounds.width - box.width)),
    y: clamp(box.y, 0, Math.max(0, bounds.height - box.height)),
    width: box.width,
    height: box.height
  };
}

function clampLine(
  layer: Extract<CardLayer, { readonly kind: "line" }>,
  bounds: LayerClipboardBounds
): Pick<Extract<CardLayer, { readonly kind: "line" }>, "x1" | "y1" | "x2" | "y2"> {
  const minX = Math.min(layer.x1, layer.x2);
  const maxX = Math.max(layer.x1, layer.x2);
  const minY = Math.min(layer.y1, layer.y2);
  const maxY = Math.max(layer.y1, layer.y2);
  const dx = clampTranslate(minX, maxX, bounds.width);
  const dy = clampTranslate(minY, maxY, bounds.height);

  return {
    x1: clamp(layer.x1 + dx, 0, bounds.width),
    y1: clamp(layer.y1 + dy, 0, bounds.height),
    x2: clamp(layer.x2 + dx, 0, bounds.width),
    y2: clamp(layer.y2 + dy, 0, bounds.height)
  };
}

function clampTranslate(min: number, max: number, limit: number): number {
  if (min < 0) {
    return -min;
  }
  if (max > limit) {
    return limit - max;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

type ElementLike = {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly parentElement?: unknown;
  readonly getAttribute?: (name: string) => string | null;
};

function isElementLike(value: unknown): value is ElementLike {
  return typeof value === "object" && value !== null;
}
