import AdmZip from "adm-zip";
import { nativeImage } from "electron";
import path from "node:path";
import { normalizeChromeConfig } from "../src/domain/chromeConfig.js";
import {
  maxTemplatePackImagePixels,
  maxTemplatePackImageSide,
  parseTemplatePackManifest,
  templatePackManifestPath,
  validateTemplatePackArchiveEntries,
  type NormalizedTemplatePackCard,
  type NormalizedTemplatePackLayer,
  type NormalizedTemplatePackManifest
} from "../src/domain/templatePack.js";
import type {
  CardLayer,
  CardnewsError,
  CardnewsResult,
  DeckPreset,
  TemplatePackImportResult,
  WorkspaceState
} from "../src/domain/types.js";
import { validateStylePresetSafety } from "../src/render-engine/styleSafety.js";
import { defaultStyleId } from "../src/render-engine/stylePresets.js";
import {
  createTemplatePackImportStorageSnapshot,
  restoreTemplatePackImportStorageSnapshot,
  saveBackgroundBufferToLibrary,
  saveCustomStyle,
  saveDeckPresetToStore,
  saveImageBufferToLibrary,
  saveWorkspaceState
} from "../src/storage/deckStore.js";

const templatePackAttribution = "__cardnews_template_pack__";

type DecodedTemplateImage = {
  readonly path: string;
  readonly displayName: string;
  readonly pngBytes: Buffer;
};

export type TemplatePackImportHooks = {
  readonly afterBackgroundsSaved?: () => void | Promise<void>;
};

export async function importTemplatePackArchive(
  storageRoot: string,
  sourcePath: string,
  hooks: TemplatePackImportHooks = {}
): Promise<CardnewsResult<TemplatePackImportResult>> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(sourcePath);
  } catch {
    return invalidInput("템플릿팩 ZIP 파일을 열 수 없습니다.");
  }

  const archiveSummary = validateTemplatePackArchiveEntries(
    zip.getEntries().map((entry) => ({
      path: entry.entryName,
      uncompressedSize: Number((entry.header as { readonly size?: number }).size ?? 0),
      isDirectory: entry.isDirectory
    }))
  );
  if (isCardnewsError(archiveSummary)) {
    return archiveSummary;
  }

  const manifestEntry = zip.getEntry(templatePackManifestPath);
  if (!manifestEntry) {
    return invalidInput("템플릿팩에는 루트의 template.json이 필요합니다.");
  }
  const manifest = parseTemplatePackManifest(manifestEntry.getData().toString("utf8"), {
    availableAssetPaths: new Set(archiveSummary.assetPaths)
  });
  if (isCardnewsError(manifest)) {
    return manifest;
  }

  const referencedAssetPaths = new Set(manifest.referencedAssetPaths);
  const decodedImages = new Map<string, DecodedTemplateImage>();
  for (const assetPath of referencedAssetPaths) {
    const decoded = decodeImageEntry(zip, assetPath);
    if (isCardnewsError(decoded)) {
      return decoded;
    }
    decodedImages.set(assetPath, decoded);
  }

  if (manifest.style) {
    const styleSafetyError = validateStylePresetSafety(manifest.style);
    if (styleSafetyError) {
      return invalidInput(`템플릿팩 스타일이 안전하지 않습니다: ${styleSafetyError}`);
    }
  }

  const snapshot = await createTemplatePackImportStorageSnapshot(storageRoot);
  try {
    const imported = await persistTemplatePackImport(storageRoot, manifest, decodedImages, hooks);
    if (isCardnewsError(imported)) {
      const rollbackError = await rollbackTemplatePackImport(storageRoot, snapshot);
      return rollbackError ? withRollbackMessage(imported, rollbackError) : imported;
    }
    return imported;
  } catch (error) {
    const rollbackError = await rollbackTemplatePackImport(storageRoot, snapshot);
    const message = error instanceof Error ? error.message : "알 수 없는 저장 오류";
    const baseError = invalidInput(`템플릿팩 가져오기 저장 중 오류가 발생했습니다: ${message}`);
    return rollbackError ? withRollbackMessage(baseError, rollbackError) : baseError;
  }
}

async function persistTemplatePackImport(
  storageRoot: string,
  manifest: NormalizedTemplatePackManifest,
  decodedImages: ReadonlyMap<string, DecodedTemplateImage>,
  hooks: TemplatePackImportHooks
): Promise<CardnewsResult<TemplatePackImportResult>> {
  const backgroundIdByPath = new Map<string, string>();
  const imageIdByPath = new Map<string, string>();

  for (const card of manifest.cards) {
    if (!card.backgroundImage || backgroundIdByPath.has(card.backgroundImage)) {
      continue;
    }
    const decoded = decodedImages.get(card.backgroundImage);
    if (!decoded) {
      return invalidInput(`템플릿팩에 없는 배경 이미지입니다: ${card.backgroundImage}`);
    }
    const saved = await saveBackgroundBufferToLibrary(
      storageRoot,
      decoded.pngBytes,
      decoded.displayName,
      templatePackAttribution
    );
    if (isCardnewsError(saved)) {
      return saved;
    }
    backgroundIdByPath.set(card.backgroundImage, saved.id);
  }
  await hooks.afterBackgroundsSaved?.();

  for (const card of manifest.cards) {
    for (const layer of card.layers) {
      if (layer.kind !== "image" || imageIdByPath.has(layer.imagePath)) {
        continue;
      }
      const decoded = decodedImages.get(layer.imagePath);
      if (!decoded) {
        return invalidInput(`템플릿팩에 없는 이미지 에셋입니다: ${layer.imagePath}`);
      }
      const saved = await saveImageBufferToLibrary(
        storageRoot,
        decoded.pngBytes,
        decoded.displayName,
        templatePackAttribution
      );
      if (isCardnewsError(saved)) {
        return saved;
      }
      imageIdByPath.set(layer.imagePath, saved.id);
    }
  }

  if (manifest.style) {
    const styles = await saveCustomStyle(storageRoot, manifest.style);
    if (!styles.some((style) => style.id === manifest.style?.id)) {
      return invalidInput("템플릿팩 스타일을 저장하지 못했습니다.");
    }
  }

  const styleId = manifest.style?.id ?? defaultStyleId;
  const workspace = buildWorkspaceState(manifest, styleId, backgroundIdByPath, imageIdByPath);
  const preset: DeckPreset = {
    name: manifest.name,
    headerLabel: workspace.headerLabel,
    footerAccount: workspace.footerAccount,
    styleId: workspace.styleId,
    ...(workspace.chrome ? { chrome: workspace.chrome } : {}),
    ...(workspace.backgroundDim !== undefined ? { backgroundDim: workspace.backgroundDim } : {}),
    ...(workspace.aspectRatio ? { aspectRatio: workspace.aspectRatio } : {}),
    ...(workspace.nextHint ? { nextHint: workspace.nextHint } : {}),
    ...(workspace.overrides ? { overrides: workspace.overrides } : {}),
    cards: workspace.cards
  };

  await saveDeckPresetToStore(storageRoot, preset);
  await saveWorkspaceState(storageRoot, workspace);

  return {
    workspace,
    presetName: preset.name,
    ...(manifest.style ? { styleId: manifest.style.id } : {}),
    backgroundCount: backgroundIdByPath.size,
    assetCount: imageIdByPath.size,
    cardCount: manifest.cards.length,
    warnings: manifest.warnings
  };
}

async function rollbackTemplatePackImport(
  storageRoot: string,
  snapshot: Awaited<ReturnType<typeof createTemplatePackImportStorageSnapshot>>
): Promise<string | undefined> {
  try {
    await restoreTemplatePackImportStorageSnapshot(storageRoot, snapshot);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "알 수 없는 rollback 오류";
  }
}

function withRollbackMessage(error: CardnewsError, rollbackError: string): CardnewsError {
  return {
    ...error,
    message: `${error.message} (rollback 실패: ${rollbackError})`
  };
}

function buildWorkspaceState(
  manifest: NormalizedTemplatePackManifest,
  styleId: string,
  backgroundIdByPath: ReadonlyMap<string, string>,
  imageIdByPath: ReadonlyMap<string, string>
): WorkspaceState {
  const overrideEntries = manifest.cards
    .map((card, index) => {
      const backgroundId = card.backgroundImage ? backgroundIdByPath.get(card.backgroundImage) : undefined;
      const layers = card.layers.map((layer) => internalizeLayer(layer, imageIdByPath)).filter(Boolean) as CardLayer[];
      return [
        String(index + 1),
        {
          ...(backgroundId ? { backgroundId } : {}),
          ...(layers.length > 0 ? { layers } : {})
        }
      ] as const;
    })
    .filter(([, override]) => Object.keys(override).length > 0);
  const overrides = Object.fromEntries(overrideEntries) as NonNullable<WorkspaceState["overrides"]>;

  const chromeConfig = normalizeChromeConfig(
    manifest.chrome?.config ??
      (manifest.chrome?.pageFormat ? { pageNumber: { template: manifest.chrome.pageFormat } } : undefined)
  );

  return {
    headerLabel: manifest.chrome?.header ?? "MONEY NOTE",
    footerAccount: manifest.chrome?.footer ?? "kkongdon_story",
    chrome: chromeConfig,
    styleId,
    ...(manifest.style?.defaultDim !== undefined ? { backgroundDim: manifest.style.defaultDim } : {}),
    cards: manifest.cards.map(serializeTemplatePackCard),
    selectedIndex: 0,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {})
  };
}

function internalizeLayer(
  layer: NormalizedTemplatePackLayer,
  imageIdByPath: ReadonlyMap<string, string>
): CardLayer | undefined {
  if (layer.kind !== "image") {
    return layer;
  }
  const imageId = imageIdByPath.get(layer.imagePath);
  if (!imageId) {
    return undefined;
  }
  const internalized: CardLayer = {
    id: layer.id,
    kind: "image",
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    backgroundId: imageId,
    ...(layer.objectFit ? { objectFit: layer.objectFit } : {}),
    ...(layer.zIndex !== undefined ? { zIndex: layer.zIndex } : {}),
    ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {})
  };
  return internalized;
}

function serializeTemplatePackCard(card: NormalizedTemplatePackCard): string {
  const lines = [`유형: ${cardTypeLabel(card.type)}`];
  if (card.badge) {
    lines.push(`배지: ${card.badge}`);
  }
  lines.push(`제목: ${card.title}`);
  if (card.subtitle) {
    lines.push(`소제목: ${card.subtitle}`);
  }
  if (card.body.length > 0 || card.bullets.length > 0) {
    if (card.body.length > 0) {
      lines.push(`본문: ${card.body[0]}`);
      lines.push(...card.body.slice(1));
    } else {
      lines.push("본문:");
    }
    lines.push(...card.bullets.map((bullet) => `- ${bullet}`));
  }
  if (card.source) {
    lines.push(`출처: ${card.source}`);
  }
  if (card.emphasis) {
    lines.push(`강조: ${card.emphasis}`);
  }
  return lines.join("\n");
}

function decodeImageEntry(zip: AdmZip, assetPath: string): CardnewsResult<DecodedTemplateImage> {
  const entry = zip.getEntry(assetPath);
  if (!entry) {
    return invalidInput(`템플릿팩에 이미지가 없습니다: ${assetPath}`);
  }

  let bytes: Buffer;
  try {
    bytes = entry.getData();
  } catch {
    return invalidInput(`이미지 파일을 읽을 수 없습니다: ${assetPath}`);
  }
  const magic = validateImageMagic(assetPath, bytes);
  if (isCardnewsError(magic)) {
    return magic;
  }

  const decoded = nativeImage.createFromBuffer(bytes);
  if (decoded.isEmpty()) {
    return invalidInput(`이미지를 디코딩할 수 없습니다: ${assetPath}`);
  }
  const size = decoded.getSize();
  if (size.width > maxTemplatePackImageSide || size.height > maxTemplatePackImageSide) {
    return invalidInput(`이미지 한 변은 ${maxTemplatePackImageSide}px 이하만 사용할 수 있습니다: ${assetPath}`);
  }
  if (size.width * size.height > maxTemplatePackImagePixels) {
    return invalidInput(`이미지 총 픽셀이 ${maxTemplatePackImagePixels} 제한을 넘었습니다: ${assetPath}`);
  }

  return {
    path: assetPath,
    displayName: path.basename(assetPath).replace(/\.(?:jpe?g|webp)$/i, ".png"),
    pngBytes: decoded.toPNG()
  };
}

function validateImageMagic(assetPath: string, bytes: Buffer): CardnewsResult<void> {
  const extension = path.extname(assetPath).toLowerCase();
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (
    (extension === ".png" && isPng) ||
    ((extension === ".jpg" || extension === ".jpeg") && isJpeg) ||
    (extension === ".webp" && isWebp)
  ) {
    return undefined;
  }

  return invalidInput(`이미지 확장자와 실제 파일 형식이 다릅니다: ${assetPath}`);
}

function cardTypeLabel(type: NormalizedTemplatePackCard["type"]): string {
  switch (type) {
    case "cover":
      return "표지";
    case "cta":
      return "마무리";
    case "body":
      return "본문";
  }
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}
