import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CardLayer,
  CardOverride,
  CardOverrideMap,
  CardnewsError,
  CardnewsResult,
  DeckPreset,
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

export type ProjectManifest = {
  readonly version: 1;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly backgrounds: readonly ProjectBackgroundAsset[];
  readonly fonts: readonly ProjectFontAsset[];
};

export type ProjectArchiveDescriptor = {
  readonly manifest: ProjectManifest;
  readonly workspace: WorkspaceState;
  readonly presets: readonly DeckPreset[];
  readonly styles: readonly StylePresetRecord[];
};

type ProjectReferences = {
  readonly backgroundIds: readonly string[];
  readonly fontIds: readonly string[];
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

export function collectProjectReferences(
  workspace: WorkspaceState,
  presets: readonly DeckPreset[] = []
): ProjectReferences {
  const backgroundIds = new Set<string>();
  const fontIds = new Set<string>();

  const visit = (snapshot: {
    readonly backgroundId?: string;
    readonly fontId?: string;
    readonly overrides?: CardOverrideMap;
  }): void => {
    if (snapshot.backgroundId) {
      backgroundIds.add(snapshot.backgroundId);
    }
    if (snapshot.fontId) {
      fontIds.add(snapshot.fontId);
    }
    for (const override of Object.values(snapshot.overrides ?? {})) {
      if (typeof override.backgroundId === "string" && override.backgroundId.length > 0) {
        backgroundIds.add(override.backgroundId);
      }
      for (const layer of override.layers ?? []) {
        if (layer.kind === "image" && layer.backgroundId.length > 0) {
          backgroundIds.add(layer.backgroundId);
        }
      }
    }
  };

  visit(workspace);
  for (const preset of presets) {
    visit(preset);
  }

  return {
    backgroundIds: [...backgroundIds].sort(),
    fontIds: [...fontIds].sort()
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
  const zip = new AdmZip();
  const manifestBackgrounds: ProjectBackgroundAsset[] = [];
  const manifestFonts: ProjectFontAsset[] = [];

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

  const manifest: ProjectManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion,
    backgrounds: manifestBackgrounds,
    fonts: manifestFonts
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
  const backgroundIdMap = new Map<string, string>();
  const fontIdMap = new Map<string, string>();
  const nextBackgrounds = [...existingBackgrounds];
  const nextFonts = [...existingFonts];
  const usedBackgroundIds = new Set(existingBackgrounds.map((entry) => entry.id));
  const usedFontIds = new Set(existingFonts.map((entry) => entry.id));

  await fs.mkdir(getBackgroundLibraryDirectory(storageRoot), { recursive: true });
  await fs.mkdir(getFontLibraryDirectory(storageRoot), { recursive: true });

  for (const entry of validated.manifest.backgrounds) {
    const nextId = makeUniqueId(entry.id, "bg", usedBackgroundIds);
    const zipEntry = getRequiredZipEntry(zip, `backgrounds/${entry.id}.${entry.extension}`);
    if (isCardnewsError(zipEntry)) {
      return zipEntry;
    }
    await fs.writeFile(
      path.join(getBackgroundLibraryDirectory(storageRoot), `${nextId}.${entry.extension}`),
      zipEntry.getData()
    );
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
    const zipEntry = getRequiredZipEntry(zip, `fonts/${entry.id}.${entry.extension}`);
    if (isCardnewsError(zipEntry)) {
      return zipEntry;
    }
    await fs.writeFile(path.join(getFontLibraryDirectory(storageRoot), `${nextId}.${entry.extension}`), zipEntry.getData());
    nextFonts.push({
      id: nextId,
      displayName: entry.displayName,
      extension: entry.extension
    });
    fontIdMap.set(entry.id, nextId);
  }

  const workspace = rewriteWorkspaceReferences(validated.workspace, backgroundIdMap, fontIdMap);
  const presets = validated.presets.map((preset) => rewritePresetReferences(preset, backgroundIdMap, fontIdMap));
  const styles = mergeById(await readCustomStyles(storageRoot), validated.styles);
  const mergedPresets = mergeByName(await readPresets(storageRoot), presets);

  await writeBackgroundIndex(storageRoot, nextBackgrounds);
  await writeFontIndex(storageRoot, nextFonts);
  await writeCustomStyles(storageRoot, styles);
  await writePresets(storageRoot, mergedPresets);
  await writeWorkspace(storageRoot, workspace);

  return {
    filePath: sourcePath,
    workspace,
    backgroundCount: validated.manifest.backgrounds.length,
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
    return JSON.parse(entry.getData().toString("utf8")) as unknown;
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

function getRequiredZipEntry(zip: AdmZip, entryName: string): AdmZip.IZipEntry | CardnewsError {
  const entry = zip.getEntry(entryName);
  return entry ?? invalidInput(`프로젝트 파일에 ${entryName} 항목이 없습니다.`);
}

function rewriteWorkspaceReferences(
  workspace: WorkspaceState,
  backgroundIdMap: ReadonlyMap<string, string>,
  fontIdMap: ReadonlyMap<string, string>
): WorkspaceState {
  return {
    ...workspace,
    ...(workspace.backgroundId ? { backgroundId: mapId(workspace.backgroundId, backgroundIdMap) } : {}),
    ...(workspace.fontId ? { fontId: mapId(workspace.fontId, fontIdMap) } : {}),
    ...(workspace.overrides ? { overrides: rewriteOverrides(workspace.overrides, backgroundIdMap) } : {})
  };
}

function rewritePresetReferences(
  preset: DeckPreset,
  backgroundIdMap: ReadonlyMap<string, string>,
  fontIdMap: ReadonlyMap<string, string>
): DeckPreset {
  return {
    ...preset,
    ...(preset.backgroundId ? { backgroundId: mapId(preset.backgroundId, backgroundIdMap) } : {}),
    ...(preset.fontId ? { fontId: mapId(preset.fontId, fontIdMap) } : {}),
    ...(preset.overrides ? { overrides: rewriteOverrides(preset.overrides, backgroundIdMap) } : {})
  };
}

function rewriteOverrides(
  overrides: CardOverrideMap,
  backgroundIdMap: ReadonlyMap<string, string>
): CardOverrideMap {
  const next: Record<string, CardOverride> = {};
  for (const [key, override] of Object.entries(overrides)) {
    let rewritten: CardOverride = { ...override };
    if (typeof override.backgroundId === "string") {
      rewritten = { ...rewritten, backgroundId: mapId(override.backgroundId, backgroundIdMap) };
    }
    if (override.layers) {
      rewritten = { ...rewritten, layers: override.layers.map((layer) => rewriteLayer(layer, backgroundIdMap)) };
    }
    next[key] = rewritten;
  }
  return next;
}

function rewriteLayer(layer: CardLayer, backgroundIdMap: ReadonlyMap<string, string>): CardLayer {
  return layer.kind === "image" ? { ...layer, backgroundId: mapId(layer.backgroundId, backgroundIdMap) } : layer;
}

function mapId(id: string, idMap: ReadonlyMap<string, string>): string {
  return idMap.get(id) ?? id;
}

function makeUniqueId(originalId: string, prefix: "bg" | "font", usedIds: Set<string>): string {
  if (originalId.startsWith(`${prefix}-`) && !usedIds.has(originalId)) {
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

function isProjectManifest(candidate: unknown): candidate is ProjectManifest {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return (
    record["version"] === 1 &&
    typeof record["createdAt"] === "string" &&
    typeof record["appVersion"] === "string" &&
    Array.isArray(record["backgrounds"]) &&
    record["backgrounds"].every(isProjectBackgroundAsset) &&
    Array.isArray(record["fonts"]) &&
    record["fonts"].every(isProjectFontAsset)
  );
}

function isProjectBackgroundAsset(candidate: unknown): candidate is ProjectBackgroundAsset {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    record["id"].startsWith("bg-") &&
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
    record["id"].startsWith("font-") &&
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

function isStylePresetRecord(candidate: unknown): candidate is StylePresetRecord {
  return isSafeStylePresetRecord(candidate);
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
