import { normalizeSemanticItemPlacement, normalizeSemanticSlotPlacement } from "./media.js";
import type {
  Card,
  CardOverride,
  SemanticContentKeys,
  SemanticItemId,
  SemanticItemKind,
  SemanticItemPlacement,
  SemanticSlotId,
  SemanticSlotPlacement,
  SemanticTextItemKeyRef
} from "./types.js";

export type SemanticItemManifestEntry = {
  readonly id: SemanticItemId;
  readonly kind: SemanticItemKind;
  readonly cardIndex: number;
  readonly label: string;
  readonly text: string;
  readonly contentKey?: string;
  readonly contentIndex?: number;
  readonly legacySlotId?: SemanticSlotId;
  readonly placement?: SemanticItemPlacement;
};

export type SemanticIdentityMigrationInput = {
  readonly card: Card;
  readonly cardIndex?: number;
  readonly footerAccount?: string;
  readonly override?: CardOverride;
  readonly previousCard?: Card;
};

const staticLegacySlots: Partial<Record<SemanticItemKind, SemanticSlotId>> = {
  title: "title",
  subtitle: "subtitle",
  "badge-text": "badge",
  "badge-image": "badge",
  footer: "footer"
};

export function createSemanticItemId(
  cardIndex: number,
  kind: SemanticItemKind,
  contentKey?: string
): SemanticItemId {
  const normalizedIndex = Number.isInteger(cardIndex) && cardIndex > 0 ? cardIndex : 1;
  return contentKey ? `card-${normalizedIndex}:${kind}:${contentKey}` : `card-${normalizedIndex}:${kind}`;
}

export function normalizeSemanticIdentity(input: SemanticIdentityMigrationInput): CardOverride {
  const cardIndex = input.cardIndex ?? input.card.index;
  const current = input.override ?? {};
  const previousContentKeys = current.semanticContentKeys;
  const semanticContentKeys: SemanticContentKeys = {
    paragraphs: reconcileTextKeyRefs("p", input.card.paragraphs, previousContentKeys?.paragraphs, input.previousCard?.paragraphs),
    bullets: reconcileTextKeyRefs("b", input.card.bullets, previousContentKeys?.bullets, input.previousCard?.bullets)
  };

  const semanticItemPlacements = normalizeSemanticItemPlacements({
    card: input.card,
    cardIndex,
    contentKeys: semanticContentKeys,
    ...(current.semanticSlots ? { legacySlots: current.semanticSlots } : {}),
    ...(current.semanticItemPlacements ? { placements: current.semanticItemPlacements } : {})
  });

  return {
    ...current,
    semanticContentKeys,
    ...(Object.keys(semanticItemPlacements).length > 0 ? { semanticItemPlacements } : {})
  };
}

export function buildSemanticItemManifest(input: {
  readonly card: Card;
  readonly cardIndex?: number;
  readonly footerAccount?: string;
  readonly override?: CardOverride;
}): readonly SemanticItemManifestEntry[] {
  const cardIndex = input.cardIndex ?? input.card.index;
  const normalizedOverride = normalizeSemanticIdentity({
    card: input.card,
    cardIndex,
    ...(input.footerAccount !== undefined ? { footerAccount: input.footerAccount } : {}),
    ...(input.override ? { override: input.override } : {})
  });
  const placements = normalizedOverride.semanticItemPlacements ?? {};
  const items: SemanticItemManifestEntry[] = [];
  const pushStatic = (kind: SemanticItemKind, text: string | undefined, label: string): void => {
    if (text === undefined || text.length === 0) return;
    const id = createSemanticItemId(cardIndex, kind);
    items.push({
      id,
      kind,
      cardIndex,
      label,
      text,
      ...(staticLegacySlots[kind] ? { legacySlotId: staticLegacySlots[kind] } : {}),
      ...(placements[id] ? { placement: placements[id] } : {})
    });
  };

  pushStatic("title", input.card.title, "title");
  pushStatic("subtitle", input.card.subtitle, "subtitle");
  pushStatic("badge-text", input.card.badge, "badge");
  pushStatic("emphasis", input.card.emphasis, "emphasis");
  pushStatic("source", input.card.source, "source");
  pushStatic("footer", input.footerAccount, "footer");

  for (const [index, paragraph] of input.card.paragraphs.entries()) {
    const ref = normalizedOverride.semanticContentKeys?.paragraphs?.[index];
    if (!ref) continue;
    const id = createSemanticItemId(cardIndex, "paragraph", ref.key);
    items.push({
      id,
      kind: "paragraph",
      cardIndex,
      label: `paragraph-${index + 1}`,
      text: paragraph,
      contentKey: ref.key,
      contentIndex: index,
      legacySlotId: "body",
      ...(placements[id] ? { placement: placements[id] } : {})
    });
  }

  for (const [index, bullet] of input.card.bullets.entries()) {
    const ref = normalizedOverride.semanticContentKeys?.bullets?.[index];
    if (!ref) continue;
    const id = createSemanticItemId(cardIndex, "bullet", ref.key);
    items.push({
      id,
      kind: "bullet",
      cardIndex,
      label: `bullet-${index + 1}`,
      text: bullet,
      contentKey: ref.key,
      contentIndex: index,
      legacySlotId: "body",
      ...(placements[id] ? { placement: placements[id] } : {})
    });
  }

  return items;
}

export function setSemanticItemPlacement(
  override: CardOverride,
  itemId: SemanticItemId,
  placement: SemanticItemPlacement
): CardOverride {
  return {
    ...override,
    semanticItemPlacements: {
      ...(override.semanticItemPlacements ?? {}),
      [itemId]: normalizeSemanticItemPlacement(placement)
    }
  };
}

export function removeSemanticItemPlacement(override: CardOverride, itemId: SemanticItemId): CardOverride {
  const kept: Record<SemanticItemId, SemanticItemPlacement> = {};
  for (const [id, placement] of Object.entries(override.semanticItemPlacements ?? {})) {
    if (id !== itemId && placement) {
      kept[id] = placement;
    }
  }
  const { semanticItemPlacements: _placements, ...rest } = override;
  if (Object.keys(kept).length === 0) {
    return rest;
  }
  return {
    ...rest,
    semanticItemPlacements: kept
  };
}

export function semanticSlotPlacementToItemPlacement(input: SemanticSlotPlacement): SemanticItemPlacement {
  const placement = normalizeSemanticSlotPlacement(input);
  return {
    mode: placement.mode,
    x: placement.x,
    y: placement.y,
    width: placement.width ?? 1,
    height: placement.height ?? 1,
    anchor: placement.anchor
  };
}

function normalizeSemanticItemPlacements(input: {
  readonly card: Card;
  readonly cardIndex: number;
  readonly contentKeys: SemanticContentKeys;
  readonly legacySlots?: Partial<Record<SemanticSlotId, SemanticSlotPlacement>>;
  readonly placements?: Partial<Record<SemanticItemId, SemanticItemPlacement>>;
}): Partial<Record<SemanticItemId, SemanticItemPlacement>> {
  const next: Record<SemanticItemId, SemanticItemPlacement> = {};
  for (const [id, placement] of Object.entries(input.placements ?? {})) {
    next[id] = normalizeSemanticItemPlacement(placement);
  }

  const seedFromSlot = (id: SemanticItemId, slotId: SemanticSlotId): void => {
    if (next[id] || !input.legacySlots?.[slotId]) return;
    next[id] = semanticSlotPlacementToItemPlacement(input.legacySlots[slotId]);
  };

  seedFromSlot(createSemanticItemId(input.cardIndex, "title"), "title");
  seedFromSlot(createSemanticItemId(input.cardIndex, "subtitle"), "subtitle");
  seedFromSlot(createSemanticItemId(input.cardIndex, "badge-text"), "badge");
  seedFromSlot(createSemanticItemId(input.cardIndex, "badge-image"), "badge");
  seedFromSlot(createSemanticItemId(input.cardIndex, "footer"), "footer");

  for (const ref of input.contentKeys.paragraphs ?? []) {
    seedFromSlot(createSemanticItemId(input.cardIndex, "paragraph", ref.key), "body");
  }
  for (const ref of input.contentKeys.bullets ?? []) {
    seedFromSlot(createSemanticItemId(input.cardIndex, "bullet", ref.key), "body");
  }

  return next;
}

function reconcileTextKeyRefs(
  prefix: "p" | "b",
  texts: readonly string[],
  previousRefs: readonly SemanticTextItemKeyRef[] | undefined,
  previousTexts: readonly string[] | undefined
): readonly SemanticTextItemKeyRef[] {
  const usedKeys = new Set<string>();
  const previousByHash = new Map<string, SemanticTextItemKeyRef[]>();
  for (const ref of previousRefs ?? []) {
    const queue = previousByHash.get(ref.textHash) ?? [];
    queue.push(ref);
    previousByHash.set(ref.textHash, queue);
  }

  return texts.map((text, index) => {
    const textHash = semanticTextHash(text);
    const matchedByHash = previousByHash.get(textHash)?.find((ref) => !usedKeys.has(ref.key));
    if (matchedByHash) {
      usedKeys.add(matchedByHash.key);
      return matchedByHash;
    }

    const matchedBySimilarity = findSimilarPreviousRef(text, previousRefs, previousTexts, usedKeys);
    if (matchedBySimilarity) {
      usedKeys.add(matchedBySimilarity.key);
      return { key: matchedBySimilarity.key, textHash };
    }

    const sameIndexRef = previousRefs?.[index];
    if (
      previousTexts?.length === texts.length &&
      sameIndexRef &&
      !usedKeys.has(sameIndexRef.key) &&
      previousTexts[index] !== undefined
    ) {
      usedKeys.add(sameIndexRef.key);
      return { key: sameIndexRef.key, textHash };
    }

    const key = createUniqueContentKey(prefix, textHash, usedKeys);
    usedKeys.add(key);
    return { key, textHash };
  });
}

function findSimilarPreviousRef(
  text: string,
  previousRefs: readonly SemanticTextItemKeyRef[] | undefined,
  previousTexts: readonly string[] | undefined,
  usedKeys: ReadonlySet<string>
): SemanticTextItemKeyRef | undefined {
  if (!previousRefs || !previousTexts) {
    return undefined;
  }

  let best: { readonly ref: SemanticTextItemKeyRef; readonly score: number } | undefined;
  for (const [index, previousText] of previousTexts.entries()) {
    const ref = previousRefs[index];
    if (!ref || usedKeys.has(ref.key)) {
      continue;
    }
    const score = textSimilarity(text, previousText);
    if (score >= 0.58 && (!best || score > best.score)) {
      best = { ref, score };
    }
  }
  return best?.ref;
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeTextForCompare(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeTextForCompare(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function normalizeTextForCompare(text: string): string {
  return text.toLowerCase().replace(/\r\n/g, "\n").trim().replace(/[^\p{L}\p{N}]+/gu, " ");
}

function createUniqueContentKey(prefix: "p" | "b", textHash: string, usedKeys: ReadonlySet<string>): string {
  let candidate = `${prefix}-${textHash}`;
  let suffix = 2;
  while (usedKeys.has(candidate)) {
    candidate = `${prefix}-${textHash}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function semanticTextHash(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim().replace(/\s+/g, " ");
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
