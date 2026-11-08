import { normalizeCardBackgroundMediaSelection, normalizeDeckBackgroundMediaSelection } from "./media.js";
import type { BackgroundMediaSelection, Card, CardOverride, Deck, MediaAssetRef } from "./types.js";

export type EffectiveBackgroundMedia =
  | {
      readonly status: "asset";
      readonly source: "card" | "deck";
      readonly asset: MediaAssetRef;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "none";
      readonly source: "card" | "deck";
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "missing";
      readonly source: "card" | "deck";
      readonly mediaId: string;
      readonly warnings: readonly string[];
    };

export type ResolveBackgroundInput = {
  readonly deckBackgroundMedia?: BackgroundMediaSelection | undefined;
  readonly deckBackgroundId?: string | null | undefined;
  readonly cardBackgroundMedia?: BackgroundMediaSelection | undefined;
  readonly cardBackgroundId?: string | null | undefined;
  readonly assets?: readonly MediaAssetRef[] | undefined;
};

export function resolveEffectiveBackgroundMedia(input: ResolveBackgroundInput): EffectiveBackgroundMedia {
  const assets = createAssetMap(input.assets ?? []);
  const deckSelection = normalizeDeckBackgroundMediaSelection(input.deckBackgroundMedia, input.deckBackgroundId);
  const cardSelection = normalizeCardBackgroundMediaSelection(input.cardBackgroundMedia, input.cardBackgroundId);

  if (cardSelection.mode === "asset") {
    return resolveAsset("card", cardSelection.mediaId, assets);
  }

  if (cardSelection.mode === "none") {
    return {
      status: "none",
      source: "card",
      warnings: []
    };
  }

  if (deckSelection.mode === "asset") {
    return resolveAsset("deck", deckSelection.mediaId, assets);
  }

  return {
    status: "none",
    source: "deck",
    warnings: []
  };
}

export function resolveEffectiveCardBackgroundMedia(
  deck: Pick<Deck, "backgroundId" | "backgroundMedia" | "mediaAssets">,
  card: Pick<Card, "backgroundId">,
  override?: Pick<CardOverride, "backgroundId" | "backgroundMedia">
): EffectiveBackgroundMedia {
  return resolveEffectiveBackgroundMedia({
    deckBackgroundMedia: deck.backgroundMedia,
    deckBackgroundId: deck.backgroundId,
    cardBackgroundMedia: override?.backgroundMedia,
    cardBackgroundId: override && "backgroundId" in override ? override.backgroundId : card.backgroundId,
    assets: deck.mediaAssets
  });
}

function resolveAsset(
  source: "card" | "deck",
  mediaId: string,
  assets: ReadonlyMap<string, MediaAssetRef>
): EffectiveBackgroundMedia {
  const asset = assets.get(mediaId);
  if (asset) {
    return {
      status: "asset",
      source,
      asset,
      warnings: []
    };
  }

  return {
    status: "missing",
    source,
    mediaId,
    warnings: [`Missing ${source} background media asset: ${mediaId}`]
  };
}

function createAssetMap(assets: readonly MediaAssetRef[]): ReadonlyMap<string, MediaAssetRef> {
  return new Map(assets.map((asset) => [asset.id, asset]));
}
