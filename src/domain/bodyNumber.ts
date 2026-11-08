import { isBodyNumberVisible } from "./media.js";
import type { Card, CardOverride, Deck } from "./types.js";

export type BodyNumberState = "automatic" | "custom" | "deleted";

export type ResolvedBodyNumber = {
  readonly state: BodyNumberState;
  readonly text: string;
  readonly visible: boolean;
};

export function getAutomaticBodyNumberText(
  deck: Deck,
  card: Card
): string | undefined {
  if (card.type !== "body") {
    return undefined;
  }

  let count = 0;
  for (const candidate of deck.cards) {
    if (candidate.type === "body") {
      count += 1;
    }

    if (candidate.index === card.index) {
      return String(count).padStart(2, "0");
    }
  }

  return undefined;
}

export function resolveBodyNumber(
  deck: Deck,
  card: Card,
  override: CardOverride | undefined = deck.overrides?.[String(card.index)]
): ResolvedBodyNumber {
  const customText = override?.bodyNumberText;
  const state: BodyNumberState =
    override?.bodyNumberMode === "hide"
      ? "deleted"
      : customText !== undefined
        ? "custom"
        : "automatic";

  return {
    state,
    text: customText !== undefined ? customText : (getAutomaticBodyNumberText(deck, card) ?? ""),
    visible:
      card.type === "body" &&
      isBodyNumberVisible(deck.bodyNumberDefault, override?.bodyNumberMode)
  };
}

export function setBodyNumberText(
  override: CardOverride | undefined,
  text: string
): CardOverride {
  return {
    ...override,
    bodyNumberMode: "show",
    bodyNumberText: text
  };
}

export const setCustomBodyNumberText = setBodyNumberText;

export function deleteBodyNumber(override: CardOverride | undefined): CardOverride {
  return {
    ...override,
    bodyNumberMode: "hide"
  };
}

export function restoreAutomaticBodyNumber(
  override: CardOverride | undefined
): CardOverride {
  if (!override) {
    return {};
  }

  const {
    bodyNumberMode: _bodyNumberMode,
    bodyNumberText: _bodyNumberText,
    ...rest
  } = override;
  return rest;
}

export const resetBodyNumberToAutomatic = restoreAutomaticBodyNumber;

export function isBodyNumberSemanticItemId(
  itemId: string | null | undefined
): boolean {
  return itemId === "body-number" || itemId?.endsWith(":body-number") === true;
}
