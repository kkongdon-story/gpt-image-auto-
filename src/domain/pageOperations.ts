import type {
  BulkBinding,
  BulkBindingMetadata,
  BulkBindingTarget,
  Card,
  CardLayer,
  CardOverride,
  CardOverrideMap
} from "./types.js";

export type PageIdFactory = (sourceId: string) => string;

export type BindingKeyFactory = (
  sourceKey: string,
  context: {
    readonly existingKeys: ReadonlySet<string>;
    readonly sourceCardNumber: number;
    readonly targetCardNumber: number;
  }
) => string;

export type PageOperationInput = {
  readonly cards: readonly Card[];
  readonly overrides?: CardOverrideMap;
  readonly bulkBindings?: BulkBindingMetadata;
  readonly selectedIndex?: number;
  readonly idFactory: PageIdFactory;
  readonly bindingKeyFactory: BindingKeyFactory;
};

export type PageOperationResult = {
  readonly cards: readonly Card[];
  readonly overrides?: CardOverrideMap;
  readonly bulkBindings?: BulkBindingMetadata;
  readonly selectedIndex: number;
  readonly warnings: readonly string[];
};

type PageOperation = "insert-before" | "insert-after" | "duplicate" | "delete";

const LAST_PAGE_DELETE_WARNING = "Cannot delete the last remaining page.";

export function insertPageBefore(input: PageOperationInput, index: number): PageOperationResult {
  return applyPageOperation(input, "insert-before", index);
}

export function insertPageAfter(input: PageOperationInput, index: number): PageOperationResult {
  return applyPageOperation(input, "insert-after", index);
}

export function duplicatePage(input: PageOperationInput, index: number): PageOperationResult {
  return applyPageOperation(input, "duplicate", index);
}

export function deletePage(input: PageOperationInput, index: number): PageOperationResult {
  return applyPageOperation(input, "delete", index);
}

function applyPageOperation(
  input: PageOperationInput,
  operation: PageOperation,
  index: number
): PageOperationResult {
  assertPageIndex(input.cards, index);

  if (operation === "delete" && input.cards.length === 1) {
    return {
      cards: input.cards,
      ...(input.overrides ? { overrides: input.overrides } : {}),
      ...(input.bulkBindings ? { bulkBindings: input.bulkBindings } : {}),
      selectedIndex: 0,
      warnings: [LAST_PAGE_DELETE_WARNING]
    };
  }

  const cards = remapCards(input.cards, operation, index);
  const duplicateContext =
    operation === "duplicate" ? createDuplicateContext(input.overrides?.[String(index + 1)], input.idFactory) : undefined;

  const nextOverrides = remapOverrides(input.overrides, operation, index, duplicateContext);
  const nextBulkBindings = remapBulkBindings(input.bulkBindings, operation, index, input.bindingKeyFactory, duplicateContext);
  return {
    cards,
    ...(nextOverrides ? { overrides: nextOverrides } : {}),
    ...(nextBulkBindings ? { bulkBindings: nextBulkBindings } : {}),
    selectedIndex: getSelectedIndex(operation, index, cards.length),
    warnings: []
  };
}

function assertPageIndex(cards: readonly Card[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= cards.length) {
    throw new RangeError(`Page index ${index} is outside the current page range.`);
  }
}

function remapCards(cards: readonly Card[], operation: PageOperation, index: number): readonly Card[] {
  if (operation === "insert-before") {
    return reindexCards([...cards.slice(0, index), createBlankCard(index), ...cards.slice(index)]);
  }

  if (operation === "insert-after") {
    return reindexCards([...cards.slice(0, index + 1), createBlankCard(index + 1), ...cards.slice(index + 1)]);
  }

  if (operation === "duplicate") {
    return reindexCards([...cards.slice(0, index + 1), cloneCard(cards[index]!), ...cards.slice(index + 1)]);
  }

  return reindexCards([...cards.slice(0, index), ...cards.slice(index + 1)]);
}

function createBlankCard(index: number): Card {
  return {
    index,
    type: "body",
    title: "새 페이지",
    paragraphs: ["내용을 입력하세요."],
    bullets: []
  };
}

function cloneCard(card: Card): Card {
  return {
    ...card,
    paragraphs: [...card.paragraphs],
    bullets: [...card.bullets]
  };
}

function reindexCards(cards: readonly Card[]): readonly Card[] {
  return cards.map((card, index) => ({ ...card, index: index + 1 }));
}

type DuplicateContext = {
  readonly sourceCardNumber: number;
  readonly targetCardNumber: number;
  readonly layerIdMap: ReadonlyMap<string, string>;
  readonly override?: CardOverride;
};

function createDuplicateContext(sourceOverride: CardOverride | undefined, idFactory: PageIdFactory): DuplicateContext {
  const layerIdMap = new Map<string, string>();
  const clonedOverride = sourceOverride ? cloneOverrideForDuplicate(sourceOverride, idFactory, layerIdMap) : undefined;

  return {
    sourceCardNumber: 0,
    targetCardNumber: 0,
    layerIdMap,
    ...(clonedOverride ? { override: clonedOverride } : {})
  };
}

function withDuplicatePageNumbers(context: DuplicateContext | undefined, index: number): DuplicateContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    sourceCardNumber: index + 1,
    targetCardNumber: index + 2
  };
}

function cloneOverrideForDuplicate(
  override: CardOverride,
  idFactory: PageIdFactory,
  layerIdMap: Map<string, string>
): CardOverride {
  return {
    ...override,
    ...(override.adjust ? { adjust: { ...override.adjust } } : {}),
    ...(override.badge ? { badge: { ...override.badge } } : {}),
    ...(override.backgroundMedia ? { backgroundMedia: { ...override.backgroundMedia } } : {}),
    ...(override.layout ? { layout: cloneLayoutOverride(override.layout) } : {}),
    ...(override.typography ? { typography: { ...override.typography } } : {}),
    ...(override.scene ? { scene: { ...override.scene } } : {}),
    ...(override.semanticSlots
      ? {
          semanticSlots: Object.fromEntries(
            Object.entries(override.semanticSlots).map(([slotId, placement]) => [
              slotId,
              placement ? { ...placement } : placement
            ])
          )
        }
      : {}),
    ...(override.semanticContentKeys
      ? {
          semanticContentKeys: {
            ...(override.semanticContentKeys.paragraphs
              ? {
                  paragraphs: override.semanticContentKeys.paragraphs.map((item) => ({ ...item }))
                }
              : {}),
            ...(override.semanticContentKeys.bullets
              ? { bullets: override.semanticContentKeys.bullets.map((item) => ({ ...item })) }
              : {})
          }
        }
      : {}),
    ...(override.semanticItemPlacements
      ? {
          semanticItemPlacements: Object.fromEntries(
            Object.entries(override.semanticItemPlacements).map(([itemId, placement]) => [
              itemId,
              placement ? { ...placement } : placement
            ])
          )
        }
      : {}),
    ...(override.bodyNumberStyle ? { bodyNumberStyle: { ...override.bodyNumberStyle } } : {}),
    ...(override.layers ? { layers: override.layers.map((layer) => cloneLayerForDuplicate(layer, idFactory, layerIdMap)) } : {})
  };
}

function cloneLayoutOverride(layout: NonNullable<CardOverride["layout"]>): NonNullable<CardOverride["layout"]> {
  return {
    ...layout,
    ...(layout.titlePlacement ? { titlePlacement: { ...layout.titlePlacement } } : {})
  };
}

function cloneLayerForDuplicate(layer: CardLayer, idFactory: PageIdFactory, layerIdMap: Map<string, string>): CardLayer {
  const nextId = idFactory(layer.id);
  layerIdMap.set(layer.id, nextId);

  return {
    ...layer,
    id: nextId
  };
}

function remapOverrides(
  overrides: CardOverrideMap | undefined,
  operation: PageOperation,
  index: number,
  duplicateContext: DuplicateContext | undefined
): CardOverrideMap | undefined {
  if (!overrides) {
    return undefined;
  }

  const sourceCardNumber = index + 1;
  const result: Record<string, CardOverride> = {};

  for (const [key, override] of Object.entries(overrides)) {
    const cardNumber = Number(key);
    if (!Number.isInteger(cardNumber) || cardNumber < 1) {
      result[key] = override;
      continue;
    }

    const nextCardNumber = mapExistingCardNumber(cardNumber, operation, sourceCardNumber);
    if (nextCardNumber !== undefined) {
      result[String(nextCardNumber)] = remapOverrideCardNumber(
        override,
        cardNumber,
        nextCardNumber
      );
    }
  }

  const numberedContext = withDuplicatePageNumbers(duplicateContext, index);
  if (numberedContext?.override) {
    result[String(numberedContext.targetCardNumber)] = remapOverrideCardNumber(
      numberedContext.override,
      numberedContext.sourceCardNumber,
      numberedContext.targetCardNumber
    );
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function remapOverrideCardNumber(
  override: CardOverride,
  sourceCardNumber: number,
  targetCardNumber: number
): CardOverride {
  if (sourceCardNumber === targetCardNumber) {
    return override;
  }

  const sourcePrefix = `card-${sourceCardNumber}:`;
  const targetPrefix = `card-${targetCardNumber}:`;
  return {
    ...override,
    ...(override.bodyNumberStyle ? { bodyNumberStyle: { ...override.bodyNumberStyle } } : {}),
    ...(override.semanticItemPlacements
      ? {
          semanticItemPlacements: Object.fromEntries(
            Object.entries(override.semanticItemPlacements).map(([itemId, placement]) => [
              itemId.startsWith(sourcePrefix)
                ? `${targetPrefix}${itemId.slice(sourcePrefix.length)}`
                : itemId,
              placement ? { ...placement } : placement
            ])
          )
        }
      : {})
  };
}

function mapExistingCardNumber(
  cardNumber: number,
  operation: PageOperation,
  sourceCardNumber: number
): number | undefined {
  if (operation === "insert-before") {
    return cardNumber >= sourceCardNumber ? cardNumber + 1 : cardNumber;
  }

  if (operation === "insert-after") {
    const insertedCardNumber = sourceCardNumber + 1;
    return cardNumber >= insertedCardNumber ? cardNumber + 1 : cardNumber;
  }

  if (operation === "duplicate") {
    return cardNumber > sourceCardNumber ? cardNumber + 1 : cardNumber;
  }

  if (cardNumber === sourceCardNumber) {
    return undefined;
  }

  return cardNumber > sourceCardNumber ? cardNumber - 1 : cardNumber;
}

function remapBulkBindings(
  bulkBindings: BulkBindingMetadata | undefined,
  operation: PageOperation,
  index: number,
  bindingKeyFactory: BindingKeyFactory,
  duplicateContext: DuplicateContext | undefined
): BulkBindingMetadata | undefined {
  if (!bulkBindings) {
    return undefined;
  }

  const sourceCardNumber = index + 1;
  const remappedBindings = bulkBindings.bindings
    .map((binding) => remapBindingTarget(binding, operation, sourceCardNumber))
    .filter((binding): binding is BulkBinding => binding !== undefined);

  const numberedContext = withDuplicatePageNumbers(duplicateContext, index);
  const duplicatedBindings =
    operation === "duplicate" && numberedContext
      ? duplicateBindingsForPage(bulkBindings.bindings, numberedContext, bindingKeyFactory, remappedBindings)
      : [];

  return {
    ...bulkBindings,
    bindings: [...remappedBindings, ...duplicatedBindings]
  };
}

function remapBindingTarget(
  binding: BulkBinding,
  operation: PageOperation,
  sourceCardNumber: number
): BulkBinding | undefined {
  if (!("cardNumber" in binding.target)) {
    return { ...binding, target: { ...binding.target } };
  }

  const nextCardNumber = mapExistingCardNumber(binding.target.cardNumber, operation, sourceCardNumber);
  if (nextCardNumber === undefined) {
    return undefined;
  }

  return {
    ...binding,
    target: {
      ...binding.target,
      cardNumber: nextCardNumber
    }
  };
}

function duplicateBindingsForPage(
  bindings: readonly BulkBinding[],
  context: DuplicateContext,
  bindingKeyFactory: BindingKeyFactory,
  existingBindings: readonly BulkBinding[]
): readonly BulkBinding[] {
  const usedKeys = new Set(existingBindings.map((binding) => binding.key));
  const clonedBindings: BulkBinding[] = [];

  for (const binding of bindings) {
    if (!("cardNumber" in binding.target) || binding.target.cardNumber !== context.sourceCardNumber) {
      continue;
    }

    const target = duplicateBindingTarget(binding.target, context);
    if (!target) {
      continue;
    }

    const key = createUniqueBindingKey(binding.key, bindingKeyFactory, usedKeys, context);
    const clonedBinding: BulkBinding = {
      ...binding,
      key,
      target
    };
    usedKeys.add(key);
    clonedBindings.push(clonedBinding);
  }

  return clonedBindings;
}

function duplicateBindingTarget(target: BulkBindingTarget, context: DuplicateContext): BulkBindingTarget | undefined {
  if (!("cardNumber" in target) || target.cardNumber !== context.sourceCardNumber) {
    return undefined;
  }

  if (target.kind === "layer-text") {
    const layerId = context.layerIdMap.get(target.layerId);
    if (!layerId) {
      return undefined;
    }

    return {
      ...target,
      cardNumber: context.targetCardNumber,
      layerId
    };
  }

  return {
    ...target,
    cardNumber: context.targetCardNumber
  };
}

function createUniqueBindingKey(
  sourceKey: string,
  bindingKeyFactory: BindingKeyFactory,
  usedKeys: Set<string>,
  context: DuplicateContext
): string {
  const candidate = bindingKeyFactory(sourceKey, {
    existingKeys: usedKeys,
    sourceCardNumber: context.sourceCardNumber,
    targetCardNumber: context.targetCardNumber
  });

  if (!usedKeys.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  let nextKey = `${candidate}_${suffix}`;
  while (usedKeys.has(nextKey)) {
    suffix += 1;
    nextKey = `${candidate}_${suffix}`;
  }

  return nextKey;
}

function getSelectedIndex(operation: PageOperation, index: number, nextLength: number): number {
  if (operation === "insert-before") {
    return index;
  }

  if (operation === "insert-after" || operation === "duplicate") {
    return index + 1;
  }

  return Math.min(index, nextLength - 1);
}
