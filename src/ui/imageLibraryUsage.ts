import type { CardOverrideMap, NextHintConfig } from "../domain/types.js";

export type ImageLibraryUsageSource = "badge" | "nextHint" | "imageLayer";

export type ImageLibraryUsage = {
  readonly imageId: string;
  readonly label: string;
  readonly source: ImageLibraryUsageSource;
  readonly cardIndex?: number;
  readonly layerId?: string;
};

export type ImageLibraryUsageState = {
  readonly nextHint: NextHintConfig;
  readonly overrides: CardOverrideMap;
};

export function findImageLibraryUsage(
  imageId: string,
  state: ImageLibraryUsageState
): readonly ImageLibraryUsage[] {
  const usages: ImageLibraryUsage[] = [];

  if (state.nextHint.kind === "image" && state.nextHint.imageId === imageId) {
    usages.push({
      imageId,
      label: "넘김 기호 이미지",
      source: "nextHint"
    });
  }

  for (const [key, override] of Object.entries(state.overrides)) {
    const cardIndex = Number.parseInt(key, 10);
    const labelCardIndex = Number.isFinite(cardIndex) ? cardIndex : key;
    if (override.badge?.imageId === imageId) {
      usages.push({
        imageId,
        label: `카드 ${labelCardIndex} 배지 이미지`,
        source: "badge",
        ...(Number.isFinite(cardIndex) ? { cardIndex } : {})
      });
    }

    for (const layer of override.layers ?? []) {
      if (layer.kind === "image" && layer.backgroundId === imageId) {
        usages.push({
          imageId,
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

export function isImageSafeToDelete(imageId: string, state: ImageLibraryUsageState): boolean {
  return findImageLibraryUsage(imageId, state).length === 0;
}
