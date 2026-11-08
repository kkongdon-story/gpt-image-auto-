export type SemanticPlacementRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type SemanticPlacementStyle = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export function resolveSemanticPlacementStyle(input: {
  readonly cardRect: SemanticPlacementRect;
  readonly parentRect: SemanticPlacementRect;
  readonly parentOffsetWidth: number;
  readonly parentOffsetHeight: number;
  readonly parentClientLeft: number;
  readonly parentClientTop: number;
  readonly parentScrollLeft: number;
  readonly parentScrollTop: number;
  readonly leftPercent: number;
  readonly topPercent: number;
  readonly widthPercent: number;
  readonly heightPercent: number;
}): SemanticPlacementStyle | undefined {
  const {
    cardRect,
    parentRect,
    parentOffsetWidth,
    parentOffsetHeight,
    parentClientLeft,
    parentClientTop,
    parentScrollLeft,
    parentScrollTop,
    leftPercent,
    topPercent,
    widthPercent,
    heightPercent
  } = input;
  if (
    cardRect.width <= 0 ||
    cardRect.height <= 0 ||
    ![
      parentRect.left,
      parentRect.top,
      parentRect.width,
      parentRect.height,
      leftPercent,
      topPercent,
      widthPercent,
      heightPercent
    ].every(Number.isFinite)
  ) {
    return undefined;
  }

  const scaleX = parentOffsetWidth > 0 ? parentRect.width / parentOffsetWidth : 1;
  const scaleY = parentOffsetHeight > 0 ? parentRect.height / parentOffsetHeight : 1;
  const safeScaleX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  const parentPaddingLeft =
    parentRect.left + (parentClientLeft - parentScrollLeft) * safeScaleX;
  const parentPaddingTop =
    parentRect.top + (parentClientTop - parentScrollTop) * safeScaleY;
  const targetLeft = cardRect.left + (leftPercent / 100) * cardRect.width;
  const targetTop = cardRect.top + (topPercent / 100) * cardRect.height;

  return {
    left: (targetLeft - parentPaddingLeft) / safeScaleX,
    top: (targetTop - parentPaddingTop) / safeScaleY,
    width: ((widthPercent / 100) * cardRect.width) / safeScaleX,
    height: ((heightPercent / 100) * cardRect.height) / safeScaleY
  };
}

export function syncSemanticItemPlacements(root: Document): void {
  const view = root.defaultView;
  if (!view) return;
  const card = root.querySelector(".card");
  if (!(card instanceof view.HTMLElement)) return;
  const cardRect = card.getBoundingClientRect();
  if (cardRect.width <= 0 || cardRect.height <= 0) return;

  for (const candidate of root.querySelectorAll("[data-semantic-item-id]")) {
    if (!(candidate instanceof view.HTMLElement)) continue;
    const element = candidate as HTMLElement;
    const computed = view.getComputedStyle(element);
    const rawLeft = computed.getPropertyValue("--editor-card-left").trim();
    if (rawLeft.length === 0) continue;

    const leftPercent = Number.parseFloat(rawLeft);
    const topPercent = Number.parseFloat(computed.getPropertyValue("--editor-card-top"));
    const widthPercent = Number.parseFloat(computed.getPropertyValue("--editor-card-width"));
    const heightPercent = Number.parseFloat(computed.getPropertyValue("--editor-card-height"));
    if (![leftPercent, topPercent, widthPercent, heightPercent].every(Number.isFinite)) continue;

    const offsetParent =
      element.offsetParent instanceof view.HTMLElement
        ? (element.offsetParent as HTMLElement)
        : (card as HTMLElement);
    const placement = resolveSemanticPlacementStyle({
      cardRect,
      parentRect: offsetParent.getBoundingClientRect(),
      parentOffsetWidth: offsetParent.offsetWidth,
      parentOffsetHeight: offsetParent.offsetHeight,
      parentClientLeft: offsetParent.clientLeft,
      parentClientTop: offsetParent.clientTop,
      parentScrollLeft: offsetParent.scrollLeft,
      parentScrollTop: offsetParent.scrollTop,
      leftPercent,
      topPercent,
      widthPercent,
      heightPercent
    });
    if (!placement) continue;

    element.style.setProperty("left", `${placement.left}px`, "important");
    element.style.setProperty("top", `${placement.top}px`, "important");
    element.style.setProperty("width", `${placement.width}px`, "important");
    element.style.setProperty("height", `${placement.height}px`, "important");
  }
}

async function waitForSemanticPlacementImages(root: Document): Promise<void> {
  const images = Array.from(root.images);
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
            resolve();
          };
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          if (image.complete) finish();
        });
      }
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }
    })
  );
}

async function waitForSemanticPlacementFrame(root: Document): Promise<void> {
  const requestFrame = root.defaultView?.requestAnimationFrame.bind(root.defaultView);
  if (!requestFrame) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve) => requestFrame(() => resolve()));
}

export async function prepareSemanticItemPlacements(root: Document): Promise<void> {
  syncSemanticItemPlacements(root);
  await root.fonts?.ready.catch(() => undefined);
  await waitForSemanticPlacementImages(root);
  syncSemanticItemPlacements(root);
  await waitForSemanticPlacementFrame(root);
  syncSemanticItemPlacements(root);
}

export function buildSemanticPlacementRuntimeScript(): string {
  return `
      {
        const resolveSemanticPlacementStyle = ${resolveSemanticPlacementStyle.toString()};
        const syncSemanticItemPlacements = ${syncSemanticItemPlacements.toString()};
        const waitForSemanticPlacementImages = ${waitForSemanticPlacementImages.toString()};
        const waitForSemanticPlacementFrame = ${waitForSemanticPlacementFrame.toString()};
        const prepareSemanticItemPlacements = ${prepareSemanticItemPlacements.toString()};
        window.__CARDNEWS_SYNC_SEMANTIC_PLACEMENTS__ = function () {
          return prepareSemanticItemPlacements(document);
        };
        void window.__CARDNEWS_SYNC_SEMANTIC_PLACEMENTS__();
        window.addEventListener("load", () => {
          void window.__CARDNEWS_SYNC_SEMANTIC_PLACEMENTS__();
        }, { once: true });
      }
  `;
}
