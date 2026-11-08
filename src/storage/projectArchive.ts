import AdmZip from "adm-zip";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CardLayer,
  CardOverride,
  CardOverrideMap,
  CardnewsError,
  CardnewsResult,
  DeckPreset,
  MediaAssetRef,
  ProjectArchiveResult,
  ProjectImportResult,
  StylePresetRecord,
  WorkspaceState
} from "../domain/types.js";
import { isSafeStylePresetRecord } from "../render-engine/styleSafety.js";
import { isDeckPreset, isWorkspaceState } from "./deckStore.js";

export type ProjectBackgroundAsset = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: string;
  readonly attribution?: string;
};

export type ProjectFontAsset = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: "ttf" | "otf" | "woff2";
};

export type ProjectMediaAsset = MediaAssetRef & {
  readonly filePath: string;
  readonly posterPath?: string;
  readonly importedAt?: string;
};

export type ProjectManifestV1 = {
  readonly version: 1;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly backgrounds: readonly ProjectBackgroundAsset[];
  readonly fonts: readonly ProjectFontAsset[];
};

export type ProjectManifestV2 = {
  readonly version: 2;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly backgrounds: readonly ProjectBackgroundAsset[];
  readonly fonts: readonly ProjectFontAsset[];
  readonly media: readonly ProjectMediaAsset[];
};

export type ProjectManifest = ProjectManifestV1 | ProjectManifestV2;

export type ProjectArchiveDescriptor = {
  readonly manifest: ProjectManifest;
  readonly workspace: WorkspaceState;
  readonly presets: readonly DeckPreset[];
  readonly styles: readonly StylePresetRecord[];
};

type ProjectReferences = {
  readonly backgroundIds: readonly string[];
  readonly fontIds: readonly string[];
  readonly mediaIds: readonly string[];
};

type StoredBackgroundEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: string;
  readonly attribution?: string;
};

type StoredFontEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly extension: "ttf" | "otf" | "woff2";
};

type StoredMediaIndex = {
  readonly version: 1;
  readonly assets: readonly StoredMediaEntry[];
};

type StoredMediaEntry = MediaAssetRef & {
  readonly importedAt: string;
};

type PreparedZipAsset = {
  readonly entry: AdmZip.IZipEntry;
  readonly data: Buffer;
};

type PlannedFileWrite = {
  readonly targetPath: string;
  readonly data: Buffer;
};

type StateFileSnapshot =
  | {
      readonly kind: "missing";
      readonly filePath: string;
    }
  | {
      readonly kind: "file";
      readonly filePath: string;
      readonly data: Buffer;
    }
  | {
      readonly kind: "other";
      readonly filePath: string;
    };

const MAX_PROJECT_MEDIA_ASSETS = 200;
const MAX_PROJECT_MEDIA_BY_KIND: Record<"image" | "video", number> = {
  image: 150,
  video: 50
};
const MAX_PROJECT_MEDIA_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PROJECT_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROJECT_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_PROJECT_POSTER_BYTES = 10 * 1024 * 1024;
const MAX_PROJECT_MANIFEST_BYTES = 2 * 1024 * 1024;

export function collectProjectReferences(
  workspace: WorkspaceState,
  presets: readonly DeckPreset[] = []
): ProjectReferences {
  const backgroundIds = new Set<string>();
  const fontIds = new Set<string>();
  const mediaIds = new Set<string>();

  const visit = (snapshot: {
    readonly backgroundId?: string;
    readonly backgroundMedia?: unknown;
    readonly fontId?: string;
    readonly mediaAssets?: readonly MediaAssetRef[];
    readonly sceneDefaults?: unknown;
    readonly overrides?: CardOverrideMap;
  }): void => {
    if (snapshot.backgroundId) {
      backgroundIds.add(snapshot.backgroundId);
    }
    collectMediaSelectionReference(snapshot.backgroundMedia, mediaIds);
    for (const asset of snapshot.mediaAssets ?? []) {
      mediaIds.add(asset.id);
    }
    collectSceneReference(snapshot.sceneDefaults, mediaIds);
    if (snapshot.fontId) {
      fontIds.add(snapshot.fontId);
    }
    for (const override of Object.values(snapshot.overrides ?? {})) {
      if (typeof override.backgroundId === "string" && override.backgroundId.length > 0) {
        backgroundIds.add(override.backgroundId);
      }
      collectMediaSelectionReference(override.backgroundMedia, mediaIds);
      collectSceneReference(override.scene, mediaIds);
      for (const layer of override.layers ?? []) {
        if (layer.kind === "image" && layer.backgroundId.length > 0) {
          backgroundIds.add(layer.backgroundId);
        }
        collectLayerMediaReference(layer, mediaIds);
      }
    }
  };

  visit(workspace);
  for (const preset of presets) {
    visit(preset);
  }

  return {
    backgroundIds: [...backgroundIds].sort(),
    fontIds: [...fontIds].sort(),
    mediaIds: [...mediaIds].sort()
  };
}

export function validateProjectDescriptor(
  descriptor: ProjectArchiveDescriptor
): CardnewsResult<ProjectArchiveDescriptor> {
  if (!isProjectManifest(descriptor.manifest)) {
    return invalidInput("manifest.json 형식이 올바르지 않습니다.");
  }
  if (!isWorkspaceState(descriptor.workspace)) {
    return invalidInput("workspace.json 형식이 올바르지 않습니다.");
  }
  if (!descriptor.presets.every(isDeckPreset)) {
    return invalidInput("presets.json 형식이 올바르지 않습니다.");
  }
  if (!descriptor.styles.every(isStylePresetRecord)) {
    return invalidInput("styles.json 형식이 올바르지 않습니다.");
  }

  const refs = collectProjectReferences(descriptor.workspace, descriptor.presets);
  const backgroundIds = new Set(descriptor.manifest.backgrounds.map((entry) => entry.id));
  const fontIds = new Set(descriptor.manifest.fonts.map((entry) => entry.id));
  const mediaIds = new Set(isProjectManifestV2(descriptor.manifest) ? descriptor.manifest.media.map((entry) => entry.id) : []);

  for (const id of refs.backgroundIds) {
    if (!backgroundIds.has(id)) {
      return invalidInput(`프로젝트에 필요한 배경 파일이 없습니다: ${id}`);
    }
  }
  for (const id of refs.fontIds) {
    if (!fontIds.has(id)) {
      return invalidInput(`프로젝트에 필요한 폰트 파일이 없습니다: ${id}`);
    }
  }
  for (const id of refs.mediaIds) {
    if (!mediaIds.has(id)) {
      return invalidInput(`프로젝트에 필요한 미디어 파일이 없습니다: ${id}`);
    }
  }

  return descriptor;
}

export async function exportProjectArchive(
  storageRoot: string,
  targetPath: string,
  appVersion: string
): Promise<CardnewsResult<ProjectArchiveResult>> {
  const workspace = await readWorkspace(storageRoot);
  if (!workspace) {
    return invalidInput("저장할 작업 상태가 없습니다.");
  }

  const presets = await readPresets(storageRoot);
  const styles = await readCustomStyles(storageRoot);
  const refs = collectProjectReferences(workspace, presets);
  const backgrounds = await readBackgroundIndex(storageRoot);
  const fonts = await readFontIndex(storageRoot);
  const media = await readMediaIndex(storageRoot);
  const zip = new AdmZip();
  const manifestBackgrounds: ProjectBackgroundAsset[] = [];
  const manifestFonts: ProjectFontAsset[] = [];
  const manifestMedia: ProjectMediaAsset[] = [];

  for (const id of refs.backgroundIds) {
    const entry = backgrounds.find((candidate) => candidate.id === id);
    if (!entry) {
      return invalidInput(`라이브러리에서 배경 이미지를 찾지 못했습니다: ${id}`);
    }
    const sourcePath = path.join(getBackgroundLibraryDirectory(storageRoot), `${entry.id}.${entry.extension}`);
    if (!(await pathExists(sourcePath))) {
      return invalidInput(`배경 파일이 없습니다: ${id}`);
    }
    manifestBackgrounds.push({
      id: entry.id,
      displayName: entry.displayName,
      extension: entry.extension,
      ...(entry.attribution ? { attribution: entry.attribution } : {})
    });
    zip.addFile(`backgrounds/${entry.id}.${entry.extension}`, await fs.readFile(sourcePath));
  }

  for (const id of refs.fontIds) {
    const entry = fonts.find((candidate) => candidate.id === id);
    if (!entry) {
      return invalidInput(`라이브러리에서 폰트를 찾지 못했습니다: ${id}`);
    }
    const sourcePath = path.join(getFontLibraryDirectory(storageRoot), `${entry.id}.${entry.extension}`);
    if (!(await pathExists(sourcePath))) {
      return invalidInput(`폰트 파일이 없습니다: ${id}`);
    }
    manifestFonts.push(entry);
    zip.addFile(`fonts/${entry.id}.${entry.extension}`, await fs.readFile(sourcePath));
  }

  for (const id of refs.mediaIds) {
    const entry = media.assets.find((candidate) => candidate.id === id);
    if (!entry) {
      return invalidInput(`라이브러리에서 미디어를 찾지 못했습니다: ${id}`);
    }
    const mediaLimit = validateMediaDeclaredSize(entry);
    if (isCardnewsError(mediaLimit)) {
      return mediaLimit;
    }
    const filePath = createMediaZipPath(entry.id, entry.relativePath);
    const sourcePath = resolveManagedMediaRelativePath(storageRoot, entry.relativePath);
    if (isCardnewsError(sourcePath)) {
      return sourcePath;
    }
    if (!(await pathExists(sourcePath))) {
      return invalidInput(`미디어 파일이 없습니다: ${id}`);
    }

    const fileData = await fs.readFile(sourcePath);
    const fileIntegrity = validateMediaPayloadIntegrity(entry, fileData);
    if (isCardnewsError(fileIntegrity)) {
      return fileIntegrity;
    }

    let posterPath: string | undefined;
    if (entry.posterRelativePath) {
      posterPath = createMediaZipPath(entry.id, entry.posterRelativePath, "posters");
      const sourcePosterPath = resolveManagedMediaRelativePath(storageRoot, entry.posterRelativePath);
      if (isCardnewsError(sourcePosterPath)) {
        return sourcePosterPath;
      }
      if (await pathExists(sourcePosterPath)) {
        const posterData = await fs.readFile(sourcePosterPath);
        if (posterData.byteLength > MAX_PROJECT_POSTER_BYTES) {
          return invalidInput(`미디어 포스터 파일이 너무 큽니다: ${entry.id}`);
        }
        zip.addFile(posterPath, posterData);
      } else {
        posterPath = undefined;
      }
    }

    manifestMedia.push({
      ...entry,
      filePath,
      ...(posterPath ? { posterPath } : {})
    });
    zip.addFile(filePath, fileData);
  }

  const mediaManifestIntegrity = validateProjectMediaManifest(manifestMedia);
  if (isCardnewsError(mediaManifestIntegrity)) {
    return mediaManifestIntegrity;
  }

  const manifest: ProjectManifestV2 = {
    version: 2,
    createdAt: new Date().toISOString(),
    appVersion,
    backgrounds: manifestBackgrounds,
    fonts: manifestFonts,
    media: manifestMedia
  };

  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  zip.addFile("workspace.json", Buffer.from(JSON.stringify(workspace, null, 2), "utf8"));
  zip.addFile("presets.json", Buffer.from(JSON.stringify(presets, null, 2), "utf8"));
  zip.addFile("styles.json", Buffer.from(JSON.stringify(styles, null, 2), "utf8"));

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  zip.writeZip(targetPath);

  return {
    filePath: targetPath,
    backgroundCount: manifestBackgrounds.length,
    mediaCount: manifestMedia.length,
    fontCount: manifestFonts.length,
    presetCount: presets.length,
    styleCount: styles.length
  };
}

export async function importProjectArchive(
  storageRoot: string,
  sourcePath: string
): Promise<CardnewsResult<ProjectImportResult>> {
  const zip = new AdmZip(sourcePath);
  const descriptor = readProjectDescriptor(zip);
  if (isCardnewsError(descriptor)) {
    return descriptor;
  }
  const validated = validateProjectDescriptor(descriptor);
  if (isCardnewsError(validated)) {
    return validated;
  }

  const existingBackgrounds = await readBackgroundIndex(storageRoot);
  const existingFonts = await readFontIndex(storageRoot);
  const existingMedia = await readMediaIndex(storageRoot);
  const backgroundIdMap = new Map<string, string>();
  const fontIdMap = new Map<string, string>();
  const mediaIdMap = new Map<string, string>();
  const nextBackgrounds = [...existingBackgrounds];
  const nextFonts = [...existingFonts];
  const nextMedia: StoredMediaEntry[] = [...existingMedia.assets];
  const usedBackgroundIds = new Set(existingBackgrounds.map((entry) => entry.id));
  const usedFontIds = new Set(existingFonts.map((entry) => entry.id));
  const usedMediaIds = new Set(existingMedia.assets.map((entry) => entry.id));

  const preparedBackgrounds = new Map<string, PreparedZipAsset>();
  const preparedFonts = new Map<string, PreparedZipAsset>();
  const preparedMedia = new Map<string, PreparedZipAsset>();
  const preparedPosters = new Map<string, PreparedZipAsset>();
  const plannedFileWrites: PlannedFileWrite[] = [];
  const importedMediaByOldId = new Map<string, MediaAssetRef>();

  for (const entry of validated.manifest.backgrounds) {
    const zipEntry = prepareRequiredZipAsset(zip, `backgrounds/${entry.id}.${entry.extension}`);
    if (isCardnewsError(zipEntry)) {
      return zipEntry;
    }
    preparedBackgrounds.set(entry.id, zipEntry);
  }

  for (const entry of validated.manifest.fonts) {
    const zipEntry = prepareRequiredZipAsset(zip, `fonts/${entry.id}.${entry.extension}`);
    if (isCardnewsError(zipEntry)) {
      return zipEntry;
    }
    preparedFonts.set(entry.id, zipEntry);
  }

  if (isProjectManifestV2(validated.manifest)) {
    const prepared = prepareProjectMediaAssets(zip, validated.manifest.media);
    if (isCardnewsError(prepared)) {
      return prepared;
    }
    for (const [id, entry] of prepared.files) {
      preparedMedia.set(id, entry);
    }
    for (const [id, entry] of prepared.posters) {
      preparedPosters.set(id, entry);
    }
  }

  for (const entry of validated.manifest.backgrounds) {
    const nextId = makeUniqueId(entry.id, "bg", usedBackgroundIds);
    const zipEntry = preparedBackgrounds.get(entry.id);
    if (!zipEntry) return invalidInput(`프로젝트 파일에 backgrounds/${entry.id}.${entry.extension} 항목이 없습니다.`);
    const targetPath = resolveLibraryAssetPath(
      getBackgroundLibraryDirectory(storageRoot),
      `${nextId}.${entry.extension}`
    );
    if (isCardnewsError(targetPath)) {
      return targetPath;
    }
    plannedFileWrites.push({ targetPath, data: zipEntry.data });
    nextBackgrounds.push({
      id: nextId,
      displayName: entry.displayName,
      extension: entry.extension,
      ...(entry.attribution ? { attribution: entry.attribution } : {})
    });
    backgroundIdMap.set(entry.id, nextId);
  }

  for (const entry of validated.manifest.fonts) {
    const nextId = makeUniqueId(entry.id, "font", usedFontIds);
    const zipEntry = preparedFonts.get(entry.id);
    if (!zipEntry) return invalidInput(`프로젝트 파일에 fonts/${entry.id}.${entry.extension} 항목이 없습니다.`);
    const targetPath = resolveLibraryAssetPath(
      getFontLibraryDirectory(storageRoot),
      `${nextId}.${entry.extension}`
    );
    if (isCardnewsError(targetPath)) {
      return targetPath;
    }
    plannedFileWrites.push({ targetPath, data: zipEntry.data });
    nextFonts.push({
      id: nextId,
      displayName: entry.displayName,
      extension: entry.extension
    });
    fontIdMap.set(entry.id, nextId);
  }

  if (isProjectManifestV2(validated.manifest)) {
    for (const entry of validated.manifest.media) {
      const file = preparedMedia.get(entry.id);
      if (!file) return invalidInput(`프로젝트 파일에 ${entry.filePath} 항목이 없습니다.`);
      const nextId = makeUniqueMediaId(entry.kind, entry.sha256, entry.id, usedMediaIds);
      const targetRelativePath = rewriteMediaRelativePath(entry.relativePath, entry.id, nextId);
      const targetPath = resolveManagedMediaRelativePath(storageRoot, targetRelativePath);
      if (isCardnewsError(targetPath)) {
        return targetPath;
      }
      plannedFileWrites.push({ targetPath, data: file.data });

      let posterRelativePath: string | undefined;
      const poster = preparedPosters.get(entry.id);
      if (poster && entry.posterRelativePath) {
        posterRelativePath = rewriteMediaRelativePath(entry.posterRelativePath, entry.id, nextId);
        const targetPosterPath = resolveManagedMediaRelativePath(storageRoot, posterRelativePath);
        if (isCardnewsError(targetPosterPath)) {
          return targetPosterPath;
        }
        plannedFileWrites.push({ targetPath: targetPosterPath, data: poster.data });
      }

      const importedMedia: StoredMediaEntry = {
        id: nextId,
        kind: entry.kind,
        displayName: entry.displayName,
        relativePath: targetRelativePath,
        mimeType: entry.mimeType,
        bytes: entry.bytes,
        sha256: entry.sha256,
        width: entry.width,
        height: entry.height,
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
        ...(entry.hasAudio !== undefined ? { hasAudio: entry.hasAudio } : {}),
        ...(posterRelativePath ? { posterRelativePath } : {}),
        importedAt: new Date().toISOString()
      };
      nextMedia.push(importedMedia);
      importedMediaByOldId.set(entry.id, toMediaAssetRef(importedMedia));
      mediaIdMap.set(entry.id, nextId);
    }
  }

  const workspace = rewriteWorkspaceReferences(
    validated.workspace,
    backgroundIdMap,
    fontIdMap,
    mediaIdMap,
    importedMediaByOldId
  );
  const presets = validated.presets.map((preset) =>
    rewritePresetReferences(preset, backgroundIdMap, fontIdMap, mediaIdMap, importedMediaByOldId)
  );
  const styles = mergeById(await readCustomStyles(storageRoot), validated.styles);
  const mergedPresets = mergeByName(await readPresets(storageRoot), presets);

  const committed = await commitProjectImport(storageRoot, plannedFileWrites, {
    backgrounds: nextBackgrounds,
    fonts: nextFonts,
    media: { version: 1, assets: nextMedia },
    styles,
    presets: mergedPresets,
    workspace
  });
  if (isCardnewsError(committed)) {
    return committed;
  }

  return {
    filePath: sourcePath,
    workspace,
    backgroundCount: validated.manifest.backgrounds.length,
    mediaCount: isProjectManifestV2(validated.manifest) ? validated.manifest.media.length : 0,
    fontCount: validated.manifest.fonts.length,
    presetCount: presets.length,
    styleCount: validated.styles.length
  };
}

function readProjectDescriptor(zip: AdmZip): CardnewsResult<ProjectArchiveDescriptor> {
  const manifest = readZipJson(zip, "manifest.json");
  if (isCardnewsError(manifest)) {
    return manifest;
  }
  const workspace = readZipJson(zip, "workspace.json");
  if (isCardnewsError(workspace)) {
    return workspace;
  }
  const presets = readOptionalZipJson(zip, "presets.json", []);
  if (isCardnewsError(presets)) {
    return presets;
  }
  const styles = readOptionalZipJson(zip, "styles.json", []);
  if (isCardnewsError(styles)) {
    return styles;
  }

  if (!Array.isArray(presets) || !Array.isArray(styles)) {
    return invalidInput("프로젝트 배열 파일 형식이 올바르지 않습니다.");
  }

  return {
    manifest: manifest as ProjectManifest,
    workspace: workspace as WorkspaceState,
    presets: presets as readonly DeckPreset[],
    styles: styles as readonly StylePresetRecord[]
  };
}

function readZipJson(zip: AdmZip, entryName: string): CardnewsResult<unknown> {
  const entry = getRequiredZipEntry(zip, entryName);
  if (isCardnewsError(entry)) {
    return entry;
  }

  try {
    const data = entry.getData();
    if (entryName === "manifest.json" && data.byteLength > MAX_PROJECT_MANIFEST_BYTES) {
      return invalidInput("manifest.json 파일이 너무 큽니다.");
    }
    return JSON.parse(data.toString("utf8")) as unknown;
  } catch {
    return invalidInput(`${entryName} JSON을 읽지 못했습니다.`);
  }
}

function readOptionalZipJson(zip: AdmZip, entryName: string, fallback: unknown): CardnewsResult<unknown> {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    return fallback;
  }

  try {
    return JSON.parse(entry.getData().toString("utf8")) as unknown;
  } catch {
    return invalidInput(`${entryName} JSON을 읽지 못했습니다.`);
  }
}

function prepareRequiredZipAsset(zip: AdmZip, entryName: string): PreparedZipAsset | CardnewsError {
  const safePath = normalizeArchiveEntryPath(entryName);
  if (isCardnewsError(safePath)) {
    return safePath;
  }
  const entry = getRequiredZipEntry(zip, safePath);
  if (isCardnewsError(entry)) {
    return entry;
  }
  if (entry.isDirectory) {
    return invalidInput(`프로젝트 파일에 ${safePath} 항목이 없습니다.`);
  }
  return { entry, data: entry.getData() };
}

function prepareProjectMediaAssets(
  zip: AdmZip,
  media: readonly ProjectMediaAsset[]
): CardnewsResult<{
  readonly files: ReadonlyMap<string, PreparedZipAsset>;
  readonly posters: ReadonlyMap<string, PreparedZipAsset>;
}> {
  const manifestIntegrity = validateProjectMediaManifest(media);
  if (isCardnewsError(manifestIntegrity)) {
    return manifestIntegrity;
  }

  const files = new Map<string, PreparedZipAsset>();
  const posters = new Map<string, PreparedZipAsset>();
  let totalPayloadBytes = 0;

  for (const entry of media) {
    const file = prepareRequiredZipAsset(zip, entry.filePath);
    if (isCardnewsError(file)) {
      return file;
    }
    const fileIntegrity = validateMediaPayloadIntegrity(entry, file.data);
    if (isCardnewsError(fileIntegrity)) {
      return fileIntegrity;
    }
    totalPayloadBytes += file.data.byteLength;
    if (totalPayloadBytes > MAX_PROJECT_MEDIA_TOTAL_BYTES) {
      return invalidInput("프로젝트 미디어 총 용량이 너무 큽니다.");
    }
    files.set(entry.id, file);

    if (entry.posterPath) {
      const poster = prepareOptionalZipAsset(zip, entry.posterPath);
      if (poster) {
        if (isCardnewsError(poster)) {
          return poster;
        }
        if (poster.data.byteLength > MAX_PROJECT_POSTER_BYTES) {
          return invalidInput(`미디어 포스터 파일이 너무 큽니다: ${entry.id}`);
        }
        totalPayloadBytes += poster.data.byteLength;
        if (totalPayloadBytes > MAX_PROJECT_MEDIA_TOTAL_BYTES) {
          return invalidInput("프로젝트 미디어 총 용량이 너무 큽니다.");
        }
        posters.set(entry.id, poster);
      }
    }
  }

  return { files, posters };
}

function prepareOptionalZipAsset(zip: AdmZip, entryName: string): PreparedZipAsset | CardnewsError | null {
  const safePath = normalizeArchiveEntryPath(entryName);
  if (isCardnewsError(safePath)) {
    return safePath;
  }
  const entry = zip.getEntry(safePath);
  if (!entry) {
    return null;
  }
  if (entry.isDirectory) {
    return invalidInput(`프로젝트 파일에 ${safePath} 항목이 없습니다.`);
  }
  return { entry, data: entry.getData() };
}

function validateProjectMediaManifest(media: readonly ProjectMediaAsset[]): true | CardnewsError {
  if (media.length > MAX_PROJECT_MEDIA_ASSETS) {
    return invalidInput("프로젝트 미디어 개수가 너무 많습니다.");
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  const posterPaths = new Set<string>();
  const relativePaths = new Set<string>();
  const posterRelativePaths = new Set<string>();
  const perKind = { image: 0, video: 0 };
  let totalBytes = 0;

  for (const entry of media) {
    if (ids.has(entry.id)) {
      return invalidInput(`중복된 미디어 ID가 있습니다: ${entry.id}`);
    }
    ids.add(entry.id);

    perKind[entry.kind] += 1;
    if (perKind[entry.kind] > MAX_PROJECT_MEDIA_BY_KIND[entry.kind]) {
      return invalidInput(`프로젝트 ${entry.kind === "image" ? "이미지" : "영상"} 미디어 개수가 너무 많습니다.`);
    }

    const sizeCheck = validateMediaDeclaredSize(entry);
    if (isCardnewsError(sizeCheck)) {
      return sizeCheck;
    }
    totalBytes += entry.bytes;
    if (totalBytes > MAX_PROJECT_MEDIA_TOTAL_BYTES) {
      return invalidInput("프로젝트 미디어 총 용량이 너무 큽니다.");
    }

    const filePath = normalizeArchiveEntryPath(entry.filePath);
    if (isCardnewsError(filePath)) {
      return filePath;
    }
    if (paths.has(filePath)) {
      return invalidInput(`중복된 미디어 파일 경로가 있습니다: ${filePath}`);
    }
    paths.add(filePath);

    const relativePath = path.posix.normalize(entry.relativePath);
    if (relativePaths.has(relativePath)) {
      return invalidInput(`중복된 미디어 상대 경로가 있습니다: ${relativePath}`);
    }
    relativePaths.add(relativePath);

    if (entry.posterPath) {
      const posterPath = normalizeArchiveEntryPath(entry.posterPath);
      if (isCardnewsError(posterPath)) {
        return posterPath;
      }
      if (posterPaths.has(posterPath)) {
        return invalidInput(`중복된 미디어 포스터 경로가 있습니다: ${posterPath}`);
      }
      posterPaths.add(posterPath);
      if (entry.posterRelativePath && path.posix.basename(posterPath) !== path.posix.basename(entry.posterRelativePath)) {
        return invalidInput(`미디어 포스터 경로가 메타데이터와 일치하지 않습니다: ${entry.id}`);
      }
    }

    if (entry.posterRelativePath) {
      const posterRelativePath = path.posix.normalize(entry.posterRelativePath);
      if (posterRelativePaths.has(posterRelativePath)) {
        return invalidInput(`중복된 미디어 포스터 상대 경로가 있습니다: ${posterRelativePath}`);
      }
      posterRelativePaths.add(posterRelativePath);
    }
  }

  return true;
}

function validateMediaDeclaredSize(entry: Pick<ProjectMediaAsset, "bytes" | "id" | "kind">): true | CardnewsError {
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
    return invalidInput(`미디어 파일 크기가 올바르지 않습니다: ${entry.id}`);
  }
  const maxBytes = entry.kind === "image" ? MAX_PROJECT_IMAGE_BYTES : MAX_PROJECT_VIDEO_BYTES;
  if (entry.bytes > maxBytes) {
    return invalidInput(`미디어 파일이 너무 큽니다: ${entry.id}`);
  }
  return true;
}

function validateMediaPayloadIntegrity(
  entry: Pick<ProjectMediaAsset, "bytes" | "id" | "sha256">,
  data: Buffer
): true | CardnewsError {
  if (data.byteLength !== entry.bytes) {
    return invalidInput(`미디어 파일 크기가 메타데이터와 일치하지 않습니다: ${entry.id}`);
  }
  if (sha256(data) !== entry.sha256) {
    return invalidInput(`미디어 파일 해시가 메타데이터와 일치하지 않습니다: ${entry.id}`);
  }
  return true;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function getRequiredZipEntry(zip: AdmZip, entryName: string): AdmZip.IZipEntry | CardnewsError {
  const entry = zip.getEntry(entryName);
  return entry ?? invalidInput(`프로젝트 파일에 ${entryName} 항목이 없습니다.`);
}

function normalizeArchiveEntryPath(entryName: string): string | CardnewsError {
  if (
    entryName.length === 0 ||
    entryName.includes("\0") ||
    entryName.includes("\\") ||
    path.isAbsolute(entryName) ||
    /^[A-Za-z]:/.test(entryName) ||
    entryName.startsWith("/") ||
    entryName.startsWith("//")
  ) {
    return invalidInput("프로젝트 ZIP 경로가 올바르지 않습니다.");
  }

  const normalized = path.posix.normalize(entryName);
  if (normalized === "." || normalized.startsWith("../") || normalized === ".." || /^[A-Za-z]:/.test(normalized)) {
    return invalidInput("프로젝트 ZIP 경로가 올바르지 않습니다.");
  }
  return normalized;
}

function rewriteWorkspaceReferences(
  workspace: WorkspaceState,
  backgroundIdMap: ReadonlyMap<string, string>,
  fontIdMap: ReadonlyMap<string, string>,
  mediaIdMap: ReadonlyMap<string, string>,
  importedMediaByOldId: ReadonlyMap<string, MediaAssetRef>
): WorkspaceState {
  return {
    ...workspace,
    ...(workspace.backgroundId ? { backgroundId: mapId(workspace.backgroundId, backgroundIdMap) } : {}),
    ...(workspace.backgroundMedia ? { backgroundMedia: rewriteBackgroundMedia(workspace.backgroundMedia, mediaIdMap) } : {}),
    ...(workspace.mediaAssets ? { mediaAssets: rewriteMediaAssets(workspace.mediaAssets, mediaIdMap, importedMediaByOldId) } : {}),
    ...(workspace.sceneDefaults ? { sceneDefaults: rewriteScene(workspace.sceneDefaults, mediaIdMap) } : {}),
    ...(workspace.fontId ? { fontId: mapId(workspace.fontId, fontIdMap) } : {}),
    ...(workspace.overrides ? { overrides: rewriteOverrides(workspace.overrides, backgroundIdMap, mediaIdMap) } : {})
  };
}

function rewritePresetReferences(
  preset: DeckPreset,
  backgroundIdMap: ReadonlyMap<string, string>,
  fontIdMap: ReadonlyMap<string, string>,
  mediaIdMap: ReadonlyMap<string, string>,
  importedMediaByOldId: ReadonlyMap<string, MediaAssetRef>
): DeckPreset {
  return {
    ...preset,
    ...(preset.backgroundId ? { backgroundId: mapId(preset.backgroundId, backgroundIdMap) } : {}),
    ...(preset.backgroundMedia ? { backgroundMedia: rewriteBackgroundMedia(preset.backgroundMedia, mediaIdMap) } : {}),
    ...(preset.mediaAssets ? { mediaAssets: rewriteMediaAssets(preset.mediaAssets, mediaIdMap, importedMediaByOldId) } : {}),
    ...(preset.sceneDefaults ? { sceneDefaults: rewriteScene(preset.sceneDefaults, mediaIdMap) } : {}),
    ...(preset.fontId ? { fontId: mapId(preset.fontId, fontIdMap) } : {}),
    ...(preset.overrides ? { overrides: rewriteOverrides(preset.overrides, backgroundIdMap, mediaIdMap) } : {})
  };
}

function rewriteOverrides(
  overrides: CardOverrideMap,
  backgroundIdMap: ReadonlyMap<string, string>,
  mediaIdMap: ReadonlyMap<string, string>
): CardOverrideMap {
  const next: Record<string, CardOverride> = {};
  for (const [key, override] of Object.entries(overrides)) {
    let rewritten: CardOverride = { ...override };
    if (typeof override.backgroundId === "string") {
      rewritten = { ...rewritten, backgroundId: mapId(override.backgroundId, backgroundIdMap) };
    }
    if (override.backgroundMedia) {
      rewritten = { ...rewritten, backgroundMedia: rewriteBackgroundMedia(override.backgroundMedia, mediaIdMap) };
    }
    if (override.scene) {
      rewritten = { ...rewritten, scene: rewriteScene(override.scene, mediaIdMap) };
    }
    if (override.layers) {
      rewritten = {
        ...rewritten,
        layers: override.layers.map((layer) => rewriteLayer(layer, backgroundIdMap, mediaIdMap))
      };
    }
    next[key] = rewritten;
  }
  return next;
}

function rewriteLayer(
  layer: CardLayer,
  backgroundIdMap: ReadonlyMap<string, string>,
  mediaIdMap: ReadonlyMap<string, string>
): CardLayer {
  if (layer.kind === "image") {
    return { ...layer, backgroundId: mapId(layer.backgroundId, backgroundIdMap) };
  }
  if (layer.kind === "video") {
    return { ...layer, mediaId: mapId(layer.mediaId, mediaIdMap) };
  }
  return layer;
}

function rewriteBackgroundMedia<T extends { readonly mode: string; readonly mediaId?: string }>(
  selection: T,
  mediaIdMap: ReadonlyMap<string, string>
): T {
  return selection.mode === "asset" && selection.mediaId
    ? ({ ...selection, mediaId: mapId(selection.mediaId, mediaIdMap) } as T)
    : selection;
}

function rewriteScene<T extends { readonly primaryAudioSourceId: string | null }>(
  scene: T,
  mediaIdMap: ReadonlyMap<string, string>
): T {
  return scene.primaryAudioSourceId
    ? ({ ...scene, primaryAudioSourceId: mapId(scene.primaryAudioSourceId, mediaIdMap) } as T)
    : scene;
}

function rewriteMediaAssets(
  assets: readonly MediaAssetRef[],
  mediaIdMap: ReadonlyMap<string, string>,
  importedMediaByOldId: ReadonlyMap<string, MediaAssetRef>
): readonly MediaAssetRef[] {
  return assets.map((asset) => {
    const importedAsset = importedMediaByOldId.get(asset.id);
    if (importedAsset) {
      return importedAsset;
    }
    const nextId = mapId(asset.id, mediaIdMap);
    return {
      ...asset,
      id: nextId,
      relativePath: rewriteMediaRelativePath(asset.relativePath, asset.id, nextId),
      ...(asset.posterRelativePath
        ? { posterRelativePath: rewriteMediaRelativePath(asset.posterRelativePath, asset.id, nextId) }
        : {})
    };
  });
}

function mapId(id: string, idMap: ReadonlyMap<string, string>): string {
  return idMap.get(id) ?? id;
}

function toMediaAssetRef(entry: StoredMediaEntry): MediaAssetRef {
  return {
    id: entry.id,
    kind: entry.kind,
    displayName: entry.displayName,
    relativePath: entry.relativePath,
    mimeType: entry.mimeType,
    bytes: entry.bytes,
    sha256: entry.sha256,
    width: entry.width,
    height: entry.height,
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.hasAudio !== undefined ? { hasAudio: entry.hasAudio } : {}),
    ...(entry.posterRelativePath ? { posterRelativePath: entry.posterRelativePath } : {})
  };
}

function collectMediaSelectionReference(selection: unknown, mediaIds: Set<string>): void {
  if (
    typeof selection === "object" &&
    selection !== null &&
    !Array.isArray(selection) &&
    (selection as { readonly mode?: unknown }).mode === "asset" &&
    typeof (selection as { readonly mediaId?: unknown }).mediaId === "string"
  ) {
    mediaIds.add((selection as { readonly mediaId: string }).mediaId);
  }
}

function collectSceneReference(scene: unknown, mediaIds: Set<string>): void {
  if (
    typeof scene === "object" &&
    scene !== null &&
    !Array.isArray(scene) &&
    typeof (scene as { readonly primaryAudioSourceId?: unknown }).primaryAudioSourceId === "string"
  ) {
    mediaIds.add((scene as { readonly primaryAudioSourceId: string }).primaryAudioSourceId);
  }
}

function collectLayerMediaReference(layer: CardLayer, mediaIds: Set<string>): void {
  if (layer.kind === "video" && layer.mediaId.length > 0) {
    mediaIds.add(layer.mediaId);
  }
}

function makeUniqueId(originalId: string, prefix: "bg" | "font", usedIds: Set<string>): string {
  if (isSafeProjectAssetId(originalId, prefix) && !usedIds.has(originalId)) {
    usedIds.add(originalId);
    return originalId;
  }

  let candidate = `${prefix}-${Date.now().toString(36)}`;
  let suffix = 1;
  while (usedIds.has(candidate)) {
    candidate = `${prefix}-${Date.now().toString(36)}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function makeUniqueMediaId(
  kind: "image" | "video",
  sha256: string,
  originalId: string,
  usedIds: Set<string>
): string {
  let candidate = `${kind}-${sha256.slice(0, 20)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  while (candidate === originalId || usedIds.has(candidate)) {
    candidate = `${kind}-${sha256.slice(0, 20)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function resolveLibraryAssetPath(directory: string, fileName: string): CardnewsResult<string> {
  const resolvedDirectory = path.resolve(directory);
  const resolvedTarget = path.resolve(resolvedDirectory, fileName);
  const relativeTarget = path.relative(resolvedDirectory, resolvedTarget);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    return invalidInput("프로젝트 자산 경로가 올바르지 않습니다.");
  }
  return resolvedTarget;
}

function resolveManagedMediaRelativePath(storageRoot: string, relativePath: string): CardnewsResult<string> {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    return invalidInput("관리 미디어 상대 경로가 올바르지 않습니다.");
  }

  const normalized = path.posix.normalize(relativePath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return invalidInput("관리 미디어 상대 경로가 올바르지 않습니다.");
  }

  const root = path.resolve(getManagedMediaRoot(storageRoot));
  const target = path.resolve(root, ...normalized.split("/"));
  const actualRelative = path.relative(root, target);
  if (actualRelative.length === 0 || actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
    return invalidInput("관리 미디어 상대 경로가 올바르지 않습니다.");
  }
  return target;
}

function createMediaZipPath(id: string, managedRelativePath: string, folder = "files"): string {
  const fileName = path.posix.basename(managedRelativePath);
  return `media/${folder}/${id}/${fileName}`;
}

function rewriteMediaRelativePath(relativePath: string, oldId: string, nextId: string): string {
  const normalized = path.posix.normalize(relativePath.split(path.sep).join("/"));
  const parts = normalized.split("/");
  return parts[0] === oldId ? [nextId, ...parts.slice(1)].join("/") : `${nextId}/${path.posix.basename(normalized)}`;
}

function isSafeProjectAssetId(id: string, prefix: "bg" | "font"): boolean {
  return new RegExp(`^${prefix}-[A-Za-z0-9_-]+$`).test(id);
}

function mergeById(
  existing: readonly StylePresetRecord[],
  incoming: readonly StylePresetRecord[]
): readonly StylePresetRecord[] {
  const byId = new Map(existing.map((style) => [style.id, style]));
  for (const style of incoming) {
    byId.set(style.id, style);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function mergeByName(existing: readonly DeckPreset[], incoming: readonly DeckPreset[]): readonly DeckPreset[] {
  const byName = new Map(existing.map((preset) => [preset.name, preset]));
  for (const preset of incoming) {
    byName.set(preset.name, preset);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

async function commitProjectImport(
  storageRoot: string,
  fileWrites: readonly PlannedFileWrite[],
  state: {
    readonly backgrounds: readonly StoredBackgroundEntry[];
    readonly fonts: readonly StoredFontEntry[];
    readonly media: StoredMediaIndex;
    readonly styles: readonly StylePresetRecord[];
    readonly presets: readonly DeckPreset[];
    readonly workspace: WorkspaceState;
  }
): Promise<true | CardnewsError> {
  const statePaths = [
    getBackgroundIndexPath(storageRoot),
    getFontIndexPath(storageRoot),
    getManagedMediaIndexPath(storageRoot),
    getCustomStylesPath(storageRoot),
    getPresetsPath(storageRoot),
    getWorkspacePath(storageRoot)
  ];
  const snapshots = await Promise.all(statePaths.map(snapshotStateFile));
  const createdFiles: string[] = [];

  try {
    for (const write of fileWrites) {
      if (await pathExists(write.targetPath)) {
        throw new Error(`target exists: ${write.targetPath}`);
      }
      await fs.mkdir(path.dirname(write.targetPath), { recursive: true });
      await fs.writeFile(write.targetPath, write.data);
      createdFiles.push(write.targetPath);
    }

    await writeBackgroundIndex(storageRoot, state.backgrounds);
    await writeFontIndex(storageRoot, state.fonts);
    await writeMediaIndex(storageRoot, state.media);
    await writeCustomStyles(storageRoot, state.styles);
    await writePresets(storageRoot, state.presets);
    await writeWorkspace(storageRoot, state.workspace);
    return true;
  } catch {
    await rollbackProjectImport(storageRoot, createdFiles, snapshots);
    return invalidInput("프로젝트 가져오기를 완료하지 못했습니다.");
  }
}

async function snapshotStateFile(filePath: string): Promise<StateFileSnapshot> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) {
      return { kind: "other", filePath };
    }
    return { kind: "file", filePath, data: await fs.readFile(filePath) };
  } catch {
    return { kind: "missing", filePath };
  }
}

async function rollbackProjectImport(
  storageRoot: string,
  createdFiles: readonly string[],
  snapshots: readonly StateFileSnapshot[]
): Promise<void> {
  await Promise.all(
    createdFiles.map(async (filePath) => {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      await removeEmptyParents(path.dirname(filePath), storageRoot);
    })
  );
  for (const snapshot of snapshots) {
    if (snapshot.kind === "file") {
      await fs.mkdir(path.dirname(snapshot.filePath), { recursive: true }).catch(() => undefined);
      await fs.writeFile(snapshot.filePath, snapshot.data).catch(() => undefined);
    } else if (snapshot.kind === "missing") {
      await fs.rm(snapshot.filePath, { force: true }).catch(() => undefined);
    }
  }
}

async function removeEmptyParents(startDirectory: string, stopDirectory: string): Promise<void> {
  const stop = path.resolve(stopDirectory);
  let current = path.resolve(startDirectory);
  while (current !== stop && current.startsWith(stop)) {
    try {
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

async function readWorkspace(storageRoot: string): Promise<WorkspaceState | null> {
  const parsed = await readJsonFile(getWorkspacePath(storageRoot));
  return isWorkspaceState(parsed) ? parsed : null;
}

async function writeWorkspace(storageRoot: string, workspace: WorkspaceState): Promise<void> {
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.writeFile(getWorkspacePath(storageRoot), JSON.stringify(workspace, null, 2), "utf8");
}

async function readPresets(storageRoot: string): Promise<readonly DeckPreset[]> {
  const parsed = await readJsonFile(getPresetsPath(storageRoot));
  return Array.isArray(parsed) ? parsed.filter(isDeckPreset) : [];
}

async function writePresets(storageRoot: string, presets: readonly DeckPreset[]): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getPresetsPath(storageRoot), JSON.stringify(presets, null, 2), "utf8");
}

async function readCustomStyles(storageRoot: string): Promise<readonly StylePresetRecord[]> {
  const parsed = await readJsonFile(getCustomStylesPath(storageRoot));
  return Array.isArray(parsed) ? parsed.filter(isStylePresetRecord) : [];
}

async function writeCustomStyles(storageRoot: string, styles: readonly StylePresetRecord[]): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getCustomStylesPath(storageRoot), JSON.stringify(styles, null, 2), "utf8");
}

async function readBackgroundIndex(storageRoot: string): Promise<readonly StoredBackgroundEntry[]> {
  const parsed = await readJsonFile(getBackgroundIndexPath(storageRoot));
  return Array.isArray(parsed) ? parsed.filter(isStoredBackgroundEntry) : [];
}

async function writeBackgroundIndex(storageRoot: string, entries: readonly StoredBackgroundEntry[]): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getBackgroundIndexPath(storageRoot), JSON.stringify(entries, null, 2), "utf8");
}

async function readFontIndex(storageRoot: string): Promise<readonly StoredFontEntry[]> {
  const parsed = await readJsonFile(getFontIndexPath(storageRoot));
  return Array.isArray(parsed) ? parsed.filter(isStoredFontEntry) : [];
}

async function writeFontIndex(storageRoot: string, entries: readonly StoredFontEntry[]): Promise<void> {
  await fs.mkdir(getLibraryDirectory(storageRoot), { recursive: true });
  await fs.writeFile(getFontIndexPath(storageRoot), JSON.stringify(entries, null, 2), "utf8");
}

async function readMediaIndex(storageRoot: string): Promise<StoredMediaIndex> {
  const parsed = await readJsonFile(getManagedMediaIndexPath(storageRoot));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { readonly version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { readonly assets?: unknown }).assets)
  ) {
    return { version: 1, assets: [] };
  }

  return {
    version: 1,
    assets: (parsed as { readonly assets: readonly unknown[] }).assets.filter(isStoredMediaEntry)
  };
}

async function writeMediaIndex(storageRoot: string, index: StoredMediaIndex): Promise<void> {
  await fs.mkdir(getManagedMediaRoot(storageRoot), { recursive: true });
  await fs.writeFile(getManagedMediaIndexPath(storageRoot), JSON.stringify(index, null, 2), "utf8");
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getLibraryDirectory(storageRoot: string): string {
  return path.join(storageRoot, "library");
}

function getBackgroundLibraryDirectory(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "backgrounds");
}

function getBackgroundIndexPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "backgrounds.json");
}

function getFontLibraryDirectory(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "fonts");
}

function getFontIndexPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "fonts.json");
}

function getCustomStylesPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "styles.json");
}

function getPresetsPath(storageRoot: string): string {
  return path.join(getLibraryDirectory(storageRoot), "presets.json");
}

function getWorkspacePath(storageRoot: string): string {
  return path.join(storageRoot, "workspace.json");
}

function getManagedMediaRoot(storageRoot: string): string {
  return path.join(storageRoot, "media");
}

function getManagedMediaIndexPath(storageRoot: string): string {
  return path.join(getManagedMediaRoot(storageRoot), "media-index.json");
}

function isProjectManifest(candidate: unknown): candidate is ProjectManifest {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    (record["version"] === 1 || record["version"] === 2) &&
    typeof record["createdAt"] === "string" &&
    typeof record["appVersion"] === "string" &&
    Array.isArray(record["backgrounds"]) &&
    record["backgrounds"].every(isProjectBackgroundAsset) &&
    Array.isArray(record["fonts"]) &&
    record["fonts"].every(isProjectFontAsset) &&
    (record["version"] === 1 ||
      (Array.isArray(record["media"]) &&
        record["media"].every(isProjectMediaAsset) &&
        validateProjectMediaManifest(record["media"]) === true))
  );
}

function isProjectManifestV2(manifest: ProjectManifest): manifest is ProjectManifestV2 {
  return manifest.version === 2;
}

function isProjectBackgroundAsset(candidate: unknown): candidate is ProjectBackgroundAsset {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    isSafeProjectAssetId(record["id"], "bg") &&
    typeof record["displayName"] === "string" &&
    typeof record["extension"] === "string" &&
    isImageExtension(record["extension"]) &&
    (record["attribution"] === undefined || typeof record["attribution"] === "string")
  );
}

function isProjectFontAsset(candidate: unknown): candidate is ProjectFontAsset {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    isSafeProjectAssetId(record["id"], "font") &&
    typeof record["displayName"] === "string" &&
    isFontExtension(record["extension"])
  );
}

function isStoredBackgroundEntry(candidate: unknown): candidate is StoredBackgroundEntry {
  return isProjectBackgroundAsset(candidate);
}

function isStoredFontEntry(candidate: unknown): candidate is StoredFontEntry {
  return isProjectFontAsset(candidate);
}

function isStoredMediaEntry(candidate: unknown): candidate is StoredMediaEntry {
  return isMediaAssetRef(candidate) && typeof (candidate as { readonly importedAt?: unknown }).importedAt === "string";
}

function isStylePresetRecord(candidate: unknown): candidate is StylePresetRecord {
  return isSafeStylePresetRecord(candidate);
}

function isProjectMediaAsset(candidate: unknown): candidate is ProjectMediaAsset {
  if (!isMediaAssetRef(candidate)) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record["filePath"] !== "string") {
    return false;
  }
  const filePath = normalizeArchiveEntryPath(record["filePath"]);
  if (isCardnewsError(filePath) || !filePath.startsWith(`media/files/${candidate.id}/`)) {
    return false;
  }
  if (record["posterPath"] !== undefined) {
    if (typeof record["posterPath"] !== "string") {
      return false;
    }
    const posterPath = normalizeArchiveEntryPath(record["posterPath"]);
    if (isCardnewsError(posterPath) || !posterPath.startsWith(`media/posters/${candidate.id}/`)) {
      return false;
    }
  }
  return (
    isSafeMediaAssetId(candidate.id, candidate.kind) &&
    isSafeManagedMediaRelativePath(candidate.relativePath, candidate.id) &&
    (candidate.posterRelativePath === undefined ||
      isSafeManagedMediaRelativePath(candidate.posterRelativePath, candidate.id)) &&
    (record["importedAt"] === undefined || typeof record["importedAt"] === "string")
  );
}

function isMediaAssetRef(candidate: unknown): candidate is MediaAssetRef {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    (record["kind"] === "image" || record["kind"] === "video") &&
    typeof record["displayName"] === "string" &&
    typeof record["relativePath"] === "string" &&
    typeof record["mimeType"] === "string" &&
    typeof record["bytes"] === "number" &&
    Number.isSafeInteger(record["bytes"]) &&
    record["bytes"] > 0 &&
    typeof record["sha256"] === "string" &&
    /^[a-f0-9]{64}$/.test(record["sha256"]) &&
    typeof record["width"] === "number" &&
    Number.isFinite(record["width"]) &&
    record["width"] > 0 &&
    typeof record["height"] === "number" &&
    Number.isFinite(record["height"]) &&
    record["height"] > 0 &&
    (record["durationMs"] === undefined ||
      (typeof record["durationMs"] === "number" && Number.isFinite(record["durationMs"]) && record["durationMs"] >= 0)) &&
    (record["hasAudio"] === undefined || typeof record["hasAudio"] === "boolean") &&
    (record["posterRelativePath"] === undefined || typeof record["posterRelativePath"] === "string")
  );
}

function isSafeMediaAssetId(id: string, kind: "image" | "video"): boolean {
  return new RegExp(`^${kind}-[a-f0-9]{20}-[A-Za-z0-9-]{8}$`).test(id);
}

function isSafeManagedMediaRelativePath(relativePath: string, id: string): boolean {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    return false;
  }
  const normalized = path.posix.normalize(relativePath);
  return normalized !== "." && normalized !== ".." && !normalized.startsWith("../") && normalized.startsWith(`${id}/`);
}

function isImageExtension(value: unknown): boolean {
  return value === "png" || value === "jpg" || value === "jpeg" || value === "webp";
}

function isFontExtension(value: unknown): value is "ttf" | "otf" | "woff2" {
  return value === "ttf" || value === "otf" || value === "woff2";
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
