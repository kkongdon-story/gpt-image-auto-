import type { CardOverrideMap } from "./types.js";

export type BackgroundLibraryUsageSource = "global" | "card" | "imageLayer";

export type BackgroundLibraryUsage = {
  readonly backgroundId: string;
  readonly label: string;
  readonly source: BackgroundLibraryUsageSource;
  readonly cardIndex?: number;
  readonly layerId?: string;
};

export type BackgroundLibraryUsageState = {
  readonly backgroundId?: string | null;
  readonly overrides?: CardOverrideMap;
};

export function findBackgroundLibraryUsage(
  backgroundId: string,
  state: BackgroundLibraryUsageState
): readonly BackgroundLibraryUsage[] {
  const usages: BackgroundLibraryUsage[] = [];

  if (state.backgroundId === backgroundId) {
    usages.push({ backgroundId, label: "전역 배경", source: "global" });
  }

  for (const [key, override] of Object.entries(state.overrides ?? {})) {
    const cardIndex = Number.parseInt(key, 10);
    const labelCardIndex = Number.isFinite(cardIndex) ? cardIndex : key;
    if (override.backgroundId === backgroundId) {
      usages.push({
        backgroundId,
        label: `카드 ${labelCardIndex} 배경`,
        source: "card",
        ...(Number.isFinite(cardIndex) ? { cardIndex } : {})
      });
    }

    for (const layer of override.layers ?? []) {
      if (layer.kind === "image" && layer.backgroundId === backgroundId) {
        usages.push({
          backgroundId,
          label: `카드 ${labelCardIndex} 이미지 레이어 ${layer.id}`,
          source: "imageLayer",
          ...(Number.isFinite(cardIndex) ? { cardIndex } : {}),
          layerId: layer.id
        });
      }
    }
  }

  return usages;
}

export function isBackgroundSafeToDelete(
  backgroundId: string,
  state: BackgroundLibraryUsageState
): boolean {
  return findBackgroundLibraryUsage(backgroundId, state).length === 0;
}
