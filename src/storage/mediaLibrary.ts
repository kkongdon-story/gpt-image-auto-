import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type MediaKind = "image" | "video";

export type MediaLibraryErrorCode =
  | "invalid_input"
  | "unsupported_media"
  | "corrupt_media"
  | "media_too_large"
  | "storage_failed"
  | "not_found"
  | "asset_in_use";

export type MediaLibraryError = {
  readonly ok: false;
  readonly code: MediaLibraryErrorCode;
  readonly message: string;
};

export type MediaLibraryResult<T> = T | MediaLibraryError;

export type MediaAssetRef = {
  readonly id: string;
  readonly kind: MediaKind;
  readonly displayName: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
  readonly hasAudio?: boolean;
  readonly videoCodec?: string;
  readonly audioCodec?: string | null;
  readonly frameRate?: number;
  readonly pixelFormat?: string;
  readonly posterRelativePath?: string;
  readonly importedAt: string;
};

export type MediaProbeInput = {
  readonly sourcePath: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type VideoMetadataProbe = (
  input: MediaProbeInput
) => Promise<{
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly hasAudio: boolean;
  readonly videoCodec?: string;
  readonly audioCodec?: string | null;
  readonly frameRate?: number;
  readonly pixelFormat?: string;
  readonly posterBytes?: Uint8Array;
  readonly posterExtension?: "jpg" | "jpeg" | "png" | "webp";
}>;

export type ImportMediaAssetOptions = {
  readonly expectedKind?: MediaKind;
  readonly videoProbe?: VideoMetadataProbe;
  readonly now?: () => Date;
};

export type MediaLibraryUsageRef = {
  readonly workspaceId?: string;
  readonly cardIndex?: number;
  readonly layerId?: string;
  readonly role: "global-background" | "card-background" | "image-layer" | "video-layer" | "archive-draft";
};

export type DeleteMediaAssetInput = {
  readonly id: string;
  readonly usages?: readonly MediaLibraryUsageRef[];
};

export type DeleteMediaAssetResult = {
  readonly ok: true;
  readonly deleted: boolean;
  readonly id: string;
  readonly usages: readonly MediaLibraryUsageRef[];
  readonly removedPaths: readonly string[];
};

export type ResolvedMediaAsset = MediaAssetRef & {
  readonly absolutePath: string;
  readonly posterAbsolutePath?: string;
  readonly missing: boolean;
};

type MediaIndex = {
  readonly version: 1;
  readonly assets: readonly MediaAssetRef[];
};

type SignatureMatch = {
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly extension: string;
};

export const MEDIA_LIBRARY_LIMITS = {
  maxImageBytes: 25 * 1024 * 1024,
  maxVideoBytes: 300 * 1024 * 1024,
  maxVideoDurationMs: 180_000,
  minVideoSidePx: 320,
  maxVideoSidePx: 3840,
  maxVideoPixels: 8_294_400,
  maxVideoFrameRate: 60,
  maxProjectBytes: 2 * 1024 * 1024 * 1024
} as const;

const mediaRootName = "media";
const mediaIndexFileName = "media-index.json";
const safeNameMaxLength = 80;

export function getManagedMediaRoot(storageRoot: string): string {
  return path.join(storageRoot, mediaRootName);
}

export function getManagedMediaIndexPath(storageRoot: string): string {
  return path.join(getManagedMediaRoot(storageRoot), mediaIndexFileName);
}

export async function importMediaAsset(
  storageRoot: string,
  sourcePath: string,
  options: ImportMediaAssetOptions = {}
): Promise<MediaLibraryResult<MediaAssetRef>> {
  try {
    const source = await validateSourceFile(sourcePath);
    if (isMediaLibraryError(source)) {
      return source;
    }

    if (source.stat.size > MEDIA_LIBRARY_LIMITS.maxVideoBytes) {
      return {
        ok: false,
        code: "media_too_large",
        message: "영상 파일은 300MiB 이하만 가져올 수 있습니다."
      };
    }

    const signature = detectMediaSignature(source.bytes);
    if (!signature) {
      return unsupported("지원하지 않는 이미지/영상 파일입니다.");
    }

    if (options.expectedKind && signature.kind !== options.expectedKind) {
      return unsupported("선택한 파일 종류와 실제 파일 형식이 다릅니다.");
    }

    if (source.stat.size > limitForKind(signature.kind)) {
      return {
        ok: false,
        code: "media_too_large",
        message: "미디어 파일 크기가 허용 한도를 초과했습니다."
      };
    }

    const sourceExtension = path.extname(source.realPath).replace(".", "").toLowerCase();
    if (sourceExtension !== signature.extension && !isAliasExtension(sourceExtension, signature.extension)) {
      return unsupported("파일 확장자와 실제 파일 형식이 일치하지 않습니다.");
    }

    const existingIndex = await readMediaIndex(storageRoot);
    if (projectBytes(existingIndex.assets) + source.stat.size > MEDIA_LIBRARY_LIMITS.maxProjectBytes) {
      return {
        ok: false,
        code: "media_too_large",
        message: "프로젝트 미디어 보관함은 2GiB를 초과할 수 없습니다."
      };
    }

    const metadata = await readMetadata(signature, source.realPath, source.bytes, options.videoProbe);
    if (isMediaLibraryError(metadata)) {
      return metadata;
    }

    const sha256 = await hashFile(source.realPath);
    const duplicate = existingIndex.assets.find((asset) => asset.sha256 === sha256);
    if (duplicate) {
      const resolved = await getMediaAsset(storageRoot, duplicate.id);
      if (!isMediaLibraryError(resolved) && !resolved.missing) {
        return duplicate;
      }
    }

    const id = createMediaAssetId(signature.kind, sha256);
    const displayName = path.basename(source.realPath);
    const safeFileName = `${safeBaseName(displayName)}.${signature.extension}`;
    const assetDirectory = resolveManagedPath(storageRoot, id);
    if (isMediaLibraryError(assetDirectory)) {
      return assetDirectory;
    }
    const assetPath = resolveManagedPath(storageRoot, id, safeFileName);
    if (isMediaLibraryError(assetPath)) {
      return assetPath;
    }

    let posterRelativePath: string | undefined;
    try {
      await fs.mkdir(assetDirectory.path, { recursive: true });
      await copyFileStreaming(source.realPath, assetPath.path);

      if (signature.kind === "video" && metadata.posterBytes && metadata.posterExtension) {
        const posterFileName = `poster.${metadata.posterExtension}`;
        const posterPath = resolveManagedPath(storageRoot, id, posterFileName);
        if (isMediaLibraryError(posterPath)) {
          return posterPath;
        }
        await fs.writeFile(posterPath.path, metadata.posterBytes);
        posterRelativePath = toManagedRelativePath(storageRoot, posterPath.path);
      }
    } catch (error) {
      await fs.rm(assetDirectory.path, { force: true, recursive: true }).catch(() => undefined);
      return storageFailed(error, "미디어를 가져오지 못했습니다.");
    }

    const asset: MediaAssetRef = {
      id,
      kind: signature.kind,
      displayName,
      relativePath: toManagedRelativePath(storageRoot, assetPath.path),
      mimeType: signature.mimeType,
      bytes: source.stat.size,
      sha256,
      width: metadata.width,
      height: metadata.height,
      ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
      ...(metadata.hasAudio !== undefined ? { hasAudio: metadata.hasAudio } : {}),
      ...(metadata.videoCodec ? { videoCodec: metadata.videoCodec } : {}),
      ...(metadata.audioCodec !== undefined ? { audioCodec: metadata.audioCodec } : {}),
      ...(metadata.frameRate !== undefined ? { frameRate: metadata.frameRate } : {}),
      ...(metadata.pixelFormat ? { pixelFormat: metadata.pixelFormat } : {}),
      ...(posterRelativePath ? { posterRelativePath } : {}),
      importedAt: (options.now ?? (() => new Date()))().toISOString()
    };

    await writeMediaIndex(storageRoot, {
      version: 1,
      assets: [...existingIndex.assets.filter((entry) => entry.id !== asset.id), asset]
    });

    return asset;
  } catch (error) {
    return storageFailed(error, "미디어를 가져오지 못했습니다.");
  }
}

export async function listMediaAssets(storageRoot: string): Promise<MediaLibraryResult<readonly MediaAssetRef[]>> {
  const index = await readMediaIndex(storageRoot);
  return [...index.assets].sort((left, right) => left.importedAt.localeCompare(right.importedAt));
}

export async function getMediaAsset(
  storageRoot: string,
  id: string
): Promise<MediaLibraryResult<ResolvedMediaAsset>> {
  const idCheck = validateMediaAssetId(id);
  if (isMediaLibraryError(idCheck)) {
    return idCheck;
  }

  const index = await readMediaIndex(storageRoot);
  const asset = index.assets.find((entry) => entry.id === id);
  if (!asset) {
    return { ok: false, code: "not_found", message: "미디어를 찾을 수 없습니다." };
  }

  const absolutePath = resolveManagedRelativePath(storageRoot, asset.relativePath);
  if (isMediaLibraryError(absolutePath)) {
    return absolutePath;
  }

  let posterAbsolutePath: string | undefined;
  if (asset.posterRelativePath) {
    const resolvedPoster = resolveManagedRelativePath(storageRoot, asset.posterRelativePath);
    if (isMediaLibraryError(resolvedPoster)) {
      return resolvedPoster;
    }
    posterAbsolutePath = resolvedPoster.path;
  }

  const missing = !(await pathExists(absolutePath.path));
  const posterExists = posterAbsolutePath ? await pathExists(posterAbsolutePath) : false;

  return {
    ...asset,
    absolutePath: absolutePath.path,
    ...(posterAbsolutePath && posterExists ? { posterAbsolutePath } : {}),
    missing
  };
}

export async function deleteMediaAsset(
  storageRoot: string,
  input: DeleteMediaAssetInput
): Promise<MediaLibraryResult<DeleteMediaAssetResult>> {
  const usages = input.usages ?? [];
  if (usages.length > 0) {
    return {
      ok: false,
      code: "asset_in_use",
      message: "사용 중인 미디어는 삭제할 수 없습니다."
    };
  }

  const idCheck = validateMediaAssetId(input.id);
  if (isMediaLibraryError(idCheck)) {
    return idCheck;
  }

  const index = await readMediaIndex(storageRoot);
  const asset = index.assets.find((entry) => entry.id === input.id);
  if (!asset) {
    return { ok: false, code: "not_found", message: "미디어를 찾을 수 없습니다." };
  }

  const removedPaths: string[] = [];
  const mediaPath = resolveManagedRelativePath(storageRoot, asset.relativePath);
  if (isMediaLibraryError(mediaPath)) {
    return mediaPath;
  }
  await fs.rm(mediaPath.path, { force: true });
  removedPaths.push(mediaPath.path);

  if (asset.posterRelativePath) {
    const posterPath = resolveManagedRelativePath(storageRoot, asset.posterRelativePath);
    if (isMediaLibraryError(posterPath)) {
      return posterPath;
    }
    await fs.rm(posterPath.path, { force: true });
    removedPaths.push(posterPath.path);
  }

  const assetDirectory = resolveManagedPath(storageRoot, asset.id);
  if (isMediaLibraryError(assetDirectory)) {
    return assetDirectory;
  }
  await fs.rm(assetDirectory.path, { force: true, recursive: true });

  await writeMediaIndex(storageRoot, {
    version: 1,
    assets: index.assets.filter((entry) => entry.id !== asset.id)
  });

  return {
    ok: true,
    deleted: true,
    id: asset.id,
    usages,
    removedPaths
  };
}

function createMediaAssetId(kind: MediaKind, sha256: string): string {
  return `${kind}-${sha256.slice(0, 20)}-${randomUUID().slice(0, 8)}`;
}

async function validateSourceFile(
  sourcePath: string
): Promise<MediaLibraryResult<{ readonly realPath: string; readonly stat: { readonly size: number }; readonly bytes: Buffer }>> {
  if (!path.isAbsolute(sourcePath)) {
    return invalidInput("미디어 원본 경로는 절대 경로여야 합니다.");
  }

  let lstat;
  try {
    lstat = await fs.lstat(sourcePath);
  } catch (error) {
    return storageFailed(error, "미디어 원본을 읽을 수 없습니다.");
  }

  if (lstat.isSymbolicLink()) {
    return invalidInput("심볼릭 링크 미디어는 가져올 수 없습니다.");
  }

  if (!lstat.isFile()) {
    return invalidInput("미디어 원본은 파일이어야 합니다.");
  }

  if (lstat.size <= 0) {
    return unsupported("빈 파일은 가져올 수 없습니다.");
  }

  const realPath = await fs.realpath(sourcePath);
  const bytes = await readFileHead(realPath, 4096);

  return {
    realPath,
    stat: { size: lstat.size },
    bytes
  };
}

async function readMetadata(
  signature: SignatureMatch,
  sourcePath: string,
  bytes: Uint8Array,
  videoProbe: VideoMetadataProbe | undefined
): Promise<
  MediaLibraryResult<{
    readonly width: number;
    readonly height: number;
    readonly durationMs?: number;
    readonly hasAudio?: boolean;
    readonly videoCodec?: string;
    readonly audioCodec?: string | null;
    readonly frameRate?: number;
    readonly pixelFormat?: string;
    readonly posterBytes?: Uint8Array;
    readonly posterExtension?: "jpg" | "jpeg" | "png" | "webp";
  }>
> {
  if (signature.kind === "image") {
    const image = readImageDimensions(signature.mimeType, bytes);
    if (!image) {
      return corrupt("이미지 크기를 읽을 수 없습니다.");
    }
    return image;
  }

  if (!videoProbe) {
    return corrupt("영상 메타데이터 어댑터가 필요합니다.");
  }

  const metadata = await videoProbe({ sourcePath, bytes, mimeType: signature.mimeType });
  if (
    !isPositiveFinite(metadata.width) ||
    !isPositiveFinite(metadata.height) ||
    !isPositiveFinite(metadata.durationMs)
  ) {
    return corrupt("영상 메타데이터가 올바르지 않습니다.");
  }

  const policyError = validateVideoPolicy(metadata);
  if (policyError) {
    return policyError;
  }

  return {
    width: Math.round(metadata.width),
    height: Math.round(metadata.height),
    durationMs: Math.round(metadata.durationMs),
    hasAudio: metadata.hasAudio,
    ...(metadata.videoCodec ? { videoCodec: metadata.videoCodec } : {}),
    ...(metadata.audioCodec !== undefined ? { audioCodec: metadata.audioCodec } : {}),
    ...(metadata.frameRate !== undefined ? { frameRate: metadata.frameRate } : {}),
    ...(metadata.pixelFormat ? { pixelFormat: metadata.pixelFormat } : {}),
    ...(metadata.posterBytes ? { posterBytes: metadata.posterBytes } : {}),
    ...(metadata.posterExtension ? { posterExtension: metadata.posterExtension } : {})
  };
}

function validateVideoPolicy(metadata: Awaited<ReturnType<VideoMetadataProbe>>): MediaLibraryError | undefined {
  if (metadata.durationMs > MEDIA_LIBRARY_LIMITS.maxVideoDurationMs) {
    return unsupported("영상 길이는 180초 이하만 가져올 수 있습니다.");
  }
  if (
    metadata.width < MEDIA_LIBRARY_LIMITS.minVideoSidePx ||
    metadata.height < MEDIA_LIBRARY_LIMITS.minVideoSidePx ||
    metadata.width > MEDIA_LIBRARY_LIMITS.maxVideoSidePx ||
    metadata.height > MEDIA_LIBRARY_LIMITS.maxVideoSidePx ||
    metadata.width * metadata.height > MEDIA_LIBRARY_LIMITS.maxVideoPixels
  ) {
    return unsupported("영상 해상도는 320x320 이상, 4K 픽셀 영역 이하만 지원합니다.");
  }
  if (metadata.frameRate === undefined || metadata.frameRate <= 0 || metadata.frameRate > MEDIA_LIBRARY_LIMITS.maxVideoFrameRate) {
    return unsupported("영상 프레임레이트는 1~60fps만 지원합니다.");
  }
  if (!metadata.videoCodec || !["h264", "avc1"].includes(metadata.videoCodec.toLowerCase())) {
    return unsupported("영상 코덱은 H.264/AVC만 지원합니다.");
  }
  if (metadata.audioCodec && metadata.audioCodec.toLowerCase() !== "aac") {
    return unsupported("오디오는 AAC 또는 오디오 없음만 지원합니다.");
  }
  if (!metadata.pixelFormat || !["yuv420p", "nv12"].includes(metadata.pixelFormat.toLowerCase())) {
    return unsupported("영상 픽셀 형식은 yuv420p 또는 NV12 경로만 지원합니다.");
  }
  return undefined;
}

function detectMediaSignature(bytes: Uint8Array): SignatureMatch | undefined {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    (bytes.length < 8 ||
      (bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a))
  ) {
    return { kind: "image", mimeType: "image/png", extension: "png" };
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg", extension: "jpg" };
  }

  if (
    bytes.length >= 12 &&
    asciiAt(bytes, 0, 4) === "RIFF" &&
    asciiAt(bytes, 8, 4) === "WEBP"
  ) {
    return { kind: "image", mimeType: "image/webp", extension: "webp" };
  }

  if (bytes.length >= 12 && asciiAt(bytes, 4, 4) === "ftyp") {
    return { kind: "video", mimeType: "video/mp4", extension: "mp4" };
  }

  return undefined;
}

function readImageDimensions(
  mimeType: string,
  bytes: Uint8Array
): { readonly width: number; readonly height: number } | undefined {
  if (mimeType === "image/png" && bytes.length >= 24) {
    return {
      width: readUInt32BE(bytes, 16),
      height: readUInt32BE(bytes, 20)
    };
  }

  if (mimeType === "image/jpeg") {
    return readJpegDimensions(bytes);
  }

  if (mimeType === "image/webp") {
    return readWebpDimensions(bytes);
  }

  return undefined;
}

function readJpegDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return undefined;
    }
    const marker = bytes[offset + 1];
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      return undefined;
    }
    if (marker !== undefined && marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: readUInt16BE(bytes, offset + 5),
        width: readUInt16BE(bytes, offset + 7)
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

function readWebpDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  const chunk = asciiAt(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27)
    };
  }

  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: readUInt16LE(bytes, 26) & 0x3fff,
      height: readUInt16LE(bytes, 28) & 0x3fff
    };
  }

  return undefined;
}

async function readMediaIndex(storageRoot: string): Promise<MediaIndex> {
  try {
    const text = await fs.readFile(getManagedMediaIndexPath(storageRoot), "utf8");
    const parsed = JSON.parse(text) as Partial<MediaIndex>;
    if (parsed.version !== 1 || !Array.isArray(parsed.assets)) {
      return { version: 1, assets: [] };
    }
    return {
      version: 1,
      assets: parsed.assets.filter(isMediaAssetRef)
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { version: 1, assets: [] };
    }
    throw error;
  }
}

async function writeMediaIndex(storageRoot: string, index: MediaIndex): Promise<void> {
  await fs.mkdir(getManagedMediaRoot(storageRoot), { recursive: true });
  await fs.writeFile(getManagedMediaIndexPath(storageRoot), JSON.stringify(index, null, 2), "utf8");
}

function resolveManagedPath(
  storageRoot: string,
  ...segments: readonly string[]
): { readonly ok: true; readonly path: string } | MediaLibraryError {
  const root = path.resolve(getManagedMediaRoot(storageRoot));
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
    return invalidInput("관리 미디어 저장소 밖의 경로는 사용할 수 없습니다.");
  }
  return { ok: true, path: target };
}

function resolveManagedRelativePath(
  storageRoot: string,
  relativePath: string
): { readonly ok: true; readonly path: string } | MediaLibraryError {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    return invalidInput("관리 미디어 상대 경로가 올바르지 않습니다.");
  }
  return resolveManagedPath(storageRoot, relativePath);
}

function toManagedRelativePath(storageRoot: string, absolutePath: string): string {
  return path.relative(getManagedMediaRoot(storageRoot), absolutePath).split(path.sep).join("/");
}

function safeBaseName(fileName: string): string {
  const parsed = path.parse(fileName);
  const normalized = parsed.name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "media");
  const base = normalized.length > 0 ? normalized : "media";
  return base.slice(0, safeNameMaxLength);
}

function isMediaAssetRef(value: unknown): value is MediaAssetRef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MediaAssetRef>;
  return (
    typeof candidate.id === "string" &&
    (candidate.kind === "image" || candidate.kind === "video") &&
    typeof candidate.displayName === "string" &&
    typeof candidate.relativePath === "string" &&
    typeof candidate.mimeType === "string" &&
    typeof candidate.bytes === "number" &&
    typeof candidate.sha256 === "string" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.importedAt === "string"
  );
}

function projectBytes(assets: readonly MediaAssetRef[]): number {
  return assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

function isMediaLibraryError(value: unknown): value is MediaLibraryError {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { readonly ok?: unknown }).ok === false
  );
}

function validateMediaAssetId(id: string): { readonly ok: true } | MediaLibraryError {
  if (!/^(image|video)-[a-f0-9]{20}-[A-Za-z0-9-]{8}$/.test(id)) {
    return invalidInput("미디어 id 형식이 올바르지 않습니다.");
  }
  return { ok: true };
}

function limitForKind(kind: MediaKind): number {
  return kind === "image" ? MEDIA_LIBRARY_LIMITS.maxImageBytes : MEDIA_LIBRARY_LIMITS.maxVideoBytes;
}

function isAliasExtension(sourceExtension: string, detectedExtension: string): boolean {
  return detectedExtension === "jpg" && sourceExtension === "jpeg";
}

function unsupported(message: string): MediaLibraryError {
  return { ok: false, code: "unsupported_media", message };
}

function corrupt(message: string): MediaLibraryError {
  return { ok: false, code: "corrupt_media", message };
}

function invalidInput(message: string): MediaLibraryError {
  return { ok: false, code: "invalid_input", message };
}

function storageFailed(error: unknown, prefix: string): MediaLibraryError {
  const detail = error instanceof Error ? error.message : "알 수 없는 저장소 오류";
  return { ok: false, code: "storage_failed", message: `${prefix}: ${detail}` };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readFileHead(filePath: string, byteCount: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function copyFileStreaming(sourcePath: string, targetPath: string): Promise<void> {
  const partialPath = `${targetPath}.partial`;
  try {
    await pipeline(createReadStream(sourcePath), createWriteStream(partialPath, { flags: "wx" }));
    await fs.rename(partialPath, targetPath);
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) + (bytes[offset + 1] ?? 0);
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) << 8) + ((bytes[offset + 2] ?? 0) << 16);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
