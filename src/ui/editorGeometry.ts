export type EditorRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type RectLike = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export function domRectToEditorRect(elementRect: RectLike, cardRect: RectLike): EditorRect | undefined {
  if (cardRect.width <= 0 || cardRect.height <= 0 || elementRect.width <= 0 || elementRect.height <= 0) {
    return undefined;
  }

  return {
    x: ((elementRect.left - cardRect.left) / cardRect.width) * 100,
    y: ((elementRect.top - cardRect.top) / cardRect.height) * 100,
    width: (elementRect.width / cardRect.width) * 100,
    height: (elementRect.height / cardRect.height) * 100
  };
}

export function clientDeltaToEditorPercent(
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
  cardViewportRect: RectLike
): { readonly x: number; readonly y: number } | undefined {
  if (cardViewportRect.width <= 0 || cardViewportRect.height <= 0) {
    return undefined;
  }

  return {
    x: ((clientX - startClientX) / cardViewportRect.width) * 100,
    y: ((clientY - startClientY) / cardViewportRect.height) * 100
  };
}

export function clientPointToEditorPercent(
  clientX: number,
  clientY: number,
  cardViewportRect: RectLike
): { readonly x: number; readonly y: number } | undefined {
  if (cardViewportRect.width <= 0 || cardViewportRect.height <= 0) {
    return undefined;
  }

  return {
    x: ((clientX - cardViewportRect.left) / cardViewportRect.width) * 100,
    y: ((clientY - cardViewportRect.top) / cardViewportRect.height) * 100
  };
}
