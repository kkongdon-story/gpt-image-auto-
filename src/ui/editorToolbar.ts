import { normalizeHexColor } from "../domain/colors.js";
import { isBodyNumberSemanticItemId } from "../domain/bodyNumber.js";
import type {
  BodyNumberStyle,
  CardTextBoxLayer,
  CardTypographyOverride,
  SemanticItemId
} from "../domain/types.js";

export type EditorToolbarTarget =
  | { readonly kind: "text-layer"; readonly layerId: string }
  | { readonly kind: "body-number"; readonly slotId: SemanticItemId }
  | { readonly kind: "card-typography" };

export type EditorToolbarTargetInput = {
  readonly editMode: boolean;
  readonly selectedLayer: CardTextBoxLayer | undefined;
  readonly selectedSemanticSlotId?: SemanticItemId | null;
};

export type TextLayerToolbarPatch = {
  readonly align?: "left" | "center" | "right";
  readonly color?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly italic?: boolean;
  readonly textOpacity?: number;
};

export type CardTypographyToolbarPatch = {
  readonly color?: string;
  readonly italic?: boolean;
  readonly scope?: "all" | "title" | "body";
  readonly sizeScale?: number;
  readonly weight?: number;
  readonly textOpacity?: number;
};

export type BodyNumberToolbarPatch = {
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
  readonly italic?: boolean;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly textAlign?: "left" | "center" | "right";
  readonly textOpacity?: number;
  readonly zIndex?: number;
};

export function resolveEditorToolbarTarget(input: EditorToolbarTargetInput): EditorToolbarTarget | null {
  if (!input.editMode) {
    return null;
  }

  if (input.selectedLayer) {
    return { kind: "text-layer", layerId: input.selectedLayer.id };
  }
  if (isBodyNumberSemanticItemId(input.selectedSemanticSlotId)) {
    return { kind: "body-number", slotId: input.selectedSemanticSlotId as SemanticItemId };
  }
  return { kind: "card-typography" };
}

export function isEditorToolbarVisible(target: EditorToolbarTarget | null): boolean {
  return target !== null;
}

export function applyTextLayerToolbarPatch(
  layer: CardTextBoxLayer,
  patch: TextLayerToolbarPatch
): CardTextBoxLayer {
  const color = patch.color === undefined ? undefined : normalizeHexColor(patch.color);
  return {
    ...layer,
    ...(patch.align ? { align: patch.align } : {}),
    ...(color ? { color } : {}),
    ...(patch.fontSize !== undefined ? { fontSize: Math.round(clampRange(patch.fontSize, 10, 144)) } : {}),
    ...(patch.fontWeight !== undefined ? { fontWeight: Math.round(clampRange(patch.fontWeight, 100, 950)) } : {}),
    ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
    ...(patch.textOpacity !== undefined ? { textOpacity: clampRange(patch.textOpacity, 0, 100) } : {})
  };
}

export function applyCardTypographyToolbarPatch(
  typography: CardTypographyOverride,
  patch: CardTypographyToolbarPatch
): CardTypographyOverride {
  const color = patch.color === undefined ? undefined : normalizeHexColor(patch.color);
  return {
    ...typography,
    ...(color ? { color } : {}),
    ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
    ...(patch.scope ? { scope: patch.scope } : {}),
    ...(patch.sizeScale !== undefined ? { sizeScale: clampRange(patch.sizeScale, 0.65, 1.35) } : {}),
    ...(patch.weight !== undefined ? { weight: Math.round(clampRange(patch.weight, 100, 950)) } : {}),
    ...(patch.textOpacity !== undefined ? { textOpacity: clampRange(patch.textOpacity, 0, 100) } : {})
  };
}

export function applyBodyNumberToolbarPatch(
  style: BodyNumberStyle,
  patch: BodyNumberToolbarPatch
): BodyNumberStyle {
  const color = patch.color === undefined ? undefined : normalizeHexColor(patch.color);
  const fontFamily = patch.fontFamily?.trim();
  return {
    ...style,
    ...(color ? { color } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(patch.fontSize !== undefined ? { fontSize: Math.round(clampRange(patch.fontSize, 8, 220)) } : {}),
    ...(patch.fontWeight !== undefined ? { fontWeight: Math.round(clampRange(patch.fontWeight, 100, 950)) } : {}),
    ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
    ...(patch.lineHeight !== undefined ? { lineHeight: clampRange(patch.lineHeight, 0.7, 3) } : {}),
    ...(patch.letterSpacing !== undefined
      ? { letterSpacing: clampRange(patch.letterSpacing, -0.2, 1) }
      : {}),
    ...(patch.textAlign ? { textAlign: patch.textAlign } : {}),
    ...(patch.textOpacity !== undefined ? { textOpacity: clampRange(patch.textOpacity, 0, 100) } : {}),
    ...(patch.zIndex !== undefined ? { zIndex: Math.round(clampRange(patch.zIndex, 0, 20)) } : {})
  };
}

function clampRange(value: number, minimum: number, maximum: number): number {
  if (Number.isNaN(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}
