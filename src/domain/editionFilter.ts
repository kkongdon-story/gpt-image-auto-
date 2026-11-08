import type { Deck, DeckDraft, DeckPreset, WorkspaceState } from "./types.js";

export function stripProDeckDraft(input: DeckDraft): DeckDraft {
  return {
    headerLabel: input.headerLabel,
    footerAccount: input.footerAccount,
    cards: input.cards,
    ...(input.styleId ? { styleId: input.styleId } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.backgroundDim !== undefined ? { backgroundDim: input.backgroundDim } : {}),
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.backgroundId ? { backgroundId: input.backgroundId } : {}),
    ...(input.backgroundMedia ? { backgroundMedia: input.backgroundMedia } : {}),
    ...(input.mediaAssets ? { mediaAssets: input.mediaAssets } : {}),
    ...(input.videoProjectMode ? { videoProjectMode: input.videoProjectMode } : {}),
    ...(input.sceneDefaults ? { sceneDefaults: input.sceneDefaults } : {}),
    ...(input.bodyNumberDefault ? { bodyNumberDefault: input.bodyNumberDefault } : {}),
    ...(input.fontId ? { fontId: input.fontId } : {}),
    ...(input.chrome ? { chrome: input.chrome } : {}),
    ...(input.nextHint ? { nextHint: input.nextHint } : {}),
    ...(input.overrides ? { overrides: input.overrides } : {})
  };
}

export function stripProDeck(input: Deck): Deck {
  return {
    id: input.id,
    headerLabel: input.headerLabel,
    footerAccount: input.footerAccount,
    cards: input.cards,
    ...(input.backgroundImage ? { backgroundImage: input.backgroundImage } : {}),
    ...(input.styleProfile ? { styleProfile: input.styleProfile } : {}),
    ...(input.styleId ? { styleId: input.styleId } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.backgroundDim !== undefined ? { backgroundDim: input.backgroundDim } : {}),
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.backgroundId ? { backgroundId: input.backgroundId } : {}),
    ...(input.backgroundMedia ? { backgroundMedia: input.backgroundMedia } : {}),
    ...(input.mediaAssets ? { mediaAssets: input.mediaAssets } : {}),
    ...(input.videoProjectMode ? { videoProjectMode: input.videoProjectMode } : {}),
    ...(input.sceneDefaults ? { sceneDefaults: input.sceneDefaults } : {}),
    ...(input.bodyNumberDefault ? { bodyNumberDefault: input.bodyNumberDefault } : {}),
    ...(input.fontId ? { fontId: input.fontId } : {}),
    ...(input.chrome ? { chrome: input.chrome } : {}),
    ...(input.nextHint ? { nextHint: input.nextHint } : {}),
    ...(input.overrides ? { overrides: input.overrides } : {})
  };
}

export function stripProWorkspaceState(input: WorkspaceState): WorkspaceState {
  return {
    headerLabel: input.headerLabel,
    footerAccount: input.footerAccount,
    styleId: input.styleId,
    cards: input.cards,
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.backgroundDim !== undefined ? { backgroundDim: input.backgroundDim } : {}),
    ...(input.backgroundId ? { backgroundId: input.backgroundId } : {}),
    ...(input.backgroundMedia ? { backgroundMedia: input.backgroundMedia } : {}),
    ...(input.mediaAssets ? { mediaAssets: input.mediaAssets } : {}),
    ...(input.videoProjectMode ? { videoProjectMode: input.videoProjectMode } : {}),
    ...(input.sceneDefaults ? { sceneDefaults: input.sceneDefaults } : {}),
    ...(input.bodyNumberDefault ? { bodyNumberDefault: input.bodyNumberDefault } : {}),
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.fontId ? { fontId: input.fontId } : {}),
    ...(input.chrome ? { chrome: input.chrome } : {}),
    ...(input.nextHint ? { nextHint: input.nextHint } : {}),
    ...(input.overrides ? { overrides: input.overrides } : {}),
    ...(input.bulkBindings ? { bulkBindings: input.bulkBindings } : {}),
    ...(input.railWidth !== undefined ? { railWidth: input.railWidth } : {}),
    ...(input.selectedIndex !== undefined ? { selectedIndex: input.selectedIndex } : {})
  };
}

export function stripProDeckPreset(input: DeckPreset): DeckPreset {
  return {
    name: input.name,
    headerLabel: input.headerLabel,
    footerAccount: input.footerAccount,
    styleId: input.styleId,
    cards: input.cards,
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.backgroundDim !== undefined ? { backgroundDim: input.backgroundDim } : {}),
    ...(input.backgroundId ? { backgroundId: input.backgroundId } : {}),
    ...(input.backgroundMedia ? { backgroundMedia: input.backgroundMedia } : {}),
    ...(input.mediaAssets ? { mediaAssets: input.mediaAssets } : {}),
    ...(input.videoProjectMode ? { videoProjectMode: input.videoProjectMode } : {}),
    ...(input.sceneDefaults ? { sceneDefaults: input.sceneDefaults } : {}),
    ...(input.bodyNumberDefault ? { bodyNumberDefault: input.bodyNumberDefault } : {}),
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.fontId ? { fontId: input.fontId } : {}),
    ...(input.chrome ? { chrome: input.chrome } : {}),
    ...(input.nextHint ? { nextHint: input.nextHint } : {}),
    ...(input.overrides ? { overrides: input.overrides } : {}),
    ...(input.bulkBindings ? { bulkBindings: input.bulkBindings } : {})
  };
}
