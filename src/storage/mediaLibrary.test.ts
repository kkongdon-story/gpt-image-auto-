import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteMediaAsset,
  getManagedMediaRoot,
  getMediaAsset,
  importMediaAsset,
  listMediaAssets,
  MEDIA_LIBRARY_LIMITS,
  type VideoMetadataProbe
} from "./mediaLibrary.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

describe("mediaLibrary secure managed catalog", () => {
  it("imports images into the managed root with stable catalog metadata and non-absolute refs", async () => {
    const root = await createTempRoot();
    const source = path.join(root, "source", "한글 파일 (1).png");
    await writeFile(source, pngBytes(320, 240));

    const imported = await importMediaAsset(root, source, { now: fixedNow });

    expect("ok" in imported).toBe(false);
    if ("ok" in imported) {
      return;
    }
    expect(imported.kind).toBe("image");
    expect(imported.displayName).toBe("한글 파일 (1).png");
    expect(imported.width).toBe(320);
    expect(imported.height).toBe(240);
    expect(imported.relativePath).not.toContain(path.parse(root).root);
    expect(imported.relativePath).toMatch(/^image-[a-f0-9]{20}-[A-Za-z0-9-]{8}\//);

    const resolved = await getMediaAsset(root, imported.id);
    expect("ok" in resolved).toBe(false);
    if ("ok" in resolved) {
      return;
    }
    expect(resolved.absolutePath.startsWith(getManagedMediaRoot(root))).toBe(true);
    expect(resolved.missing).toBe(false);
    await expect(fs.access(resolved.absolutePath)).resolves.toBeUndefined();
  });

  it("dedupes identical binaries by sha256 while allowing same names with different hashes", async () => {
    const root = await createTempRoot();
    const first = path.join(root, "source", "same.png");
    const duplicate = path.join(root, "source", "copy.png");
    const different = path.join(root, "other", "same.png");
    await writeFile(first, pngBytes(100, 100));
    await writeFile(duplicate, pngBytes(100, 100));
    await writeFile(different, pngBytes(101, 100));

    const firstAsset = await importMediaAsset(root, first, { now: fixedNow });
    const duplicateAsset = await importMediaAsset(root, duplicate, { now: fixedNow });
    const differentAsset = await importMediaAsset(root, different, { now: fixedNow });

    expect("ok" in firstAsset).toBe(false);
    expect("ok" in duplicateAsset).toBe(false);
    expect("ok" in differentAsset).toBe(false);
    if ("ok" in firstAsset || "ok" in duplicateAsset || "ok" in differentAsset) {
      return;
    }
    expect(duplicateAsset.id).toBe(firstAsset.id);
    expect(differentAsset.id).not.toBe(firstAsset.id);

    const list = await listMediaAssets(root);
    expect("ok" in list).toBe(false);
    if ("ok" in list) {
      return;
    }
    expect(list.map((asset) => asset.id)).toEqual([firstAsset.id, differentAsset.id]);
  });

  it("imports videos using an optional metadata probe and stores generated poster metadata", async () => {
    const root = await createTempRoot();
    const video = path.join(root, "source", "clip.mp4");
    await writeFile(video, mp4Bytes());
    const probe: VideoMetadataProbe = async ({ sourcePath, mimeType }) => {
      expect(sourcePath).toBe(video);
      expect(mimeType).toBe("video/mp4");
      return {
        width: 1080,
        height: 1920,
        durationMs: 3000,
        hasAudio: true,
        videoCodec: "h264",
        audioCodec: "aac",
        frameRate: 30,
        pixelFormat: "yuv420p",
        posterBytes: pngBytes(16, 16),
        posterExtension: "png"
      };
    };

    const imported = await importMediaAsset(root, video, { expectedKind: "video", videoProbe: probe, now: fixedNow });

    expect("ok" in imported).toBe(false);
    if ("ok" in imported) {
      return;
    }
    expect(imported).toMatchObject({
      kind: "video",
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationMs: 3000,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      pixelFormat: "yuv420p"
    });
    expect(imported.posterRelativePath).toMatch(/poster\.png$/);

    const resolved = await getMediaAsset(root, imported.id);
    expect("ok" in resolved).toBe(false);
    if ("ok" in resolved) {
      return;
    }
    expect(resolved.posterAbsolutePath).toBeDefined();
    await expect(fs.access(resolved.posterAbsolutePath as string)).resolves.toBeUndefined();
  });

  it("rejects corrupt, disguised, zero-byte, symlink, and oversized inputs", async () => {
    const root = await createTempRoot();
    const corrupt = path.join(root, "source", "corrupt.png");
    const disguised = path.join(root, "source", "disguised.jpg");
    const empty = path.join(root, "source", "empty.png");
    const oversized = path.join(root, "source", "huge.mp4");
    const target = path.join(root, "source", "target.png");
    const link = path.join(root, "source", "link.png");
    await writeFile(corrupt, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(disguised, pngBytes(10, 10));
    await writeFile(empty, Buffer.alloc(0));
    await writeFile(target, pngBytes(10, 10));
    await writeSparseFile(oversized, MEDIA_LIBRARY_LIMITS.maxVideoBytes + 1);
    await fs.symlink(target, link);

    await expect(importMediaAsset(root, corrupt)).resolves.toMatchObject({ ok: false, code: "corrupt_media" });
    await expect(importMediaAsset(root, disguised)).resolves.toMatchObject({ ok: false, code: "unsupported_media" });
    await expect(importMediaAsset(root, empty)).resolves.toMatchObject({ ok: false, code: "unsupported_media" });
    await expect(importMediaAsset(root, oversized)).resolves.toMatchObject({ ok: false, code: "media_too_large" });
    await expect(importMediaAsset(root, link)).resolves.toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("enforces M23 video import policy before registering or copying invalid media", async () => {
    const root = await createTempRoot();
    const unsupportedCodec = path.join(root, "source", "unsupported.mp4");
    await writeFile(unsupportedCodec, mp4Bytes());

    await expect(
      importMediaAsset(root, unsupportedCodec, {
        expectedKind: "video",
        videoProbe: async () => ({
          width: 1080,
          height: 1920,
          durationMs: 3000,
          hasAudio: true,
          videoCodec: "hevc",
          audioCodec: "aac",
          frameRate: 30,
          pixelFormat: "yuv420p"
        })
      })
    ).resolves.toMatchObject({
      ok: false,
      code: "unsupported_media",
      message: "영상 코덱은 H.264/AVC만 지원합니다."
    });

    await expect(listMediaAssets(root)).resolves.toEqual([]);
  });

  it("rejects videos over 300MiB before probing metadata", async () => {
    const root = await createTempRoot();
    const oversized = path.join(root, "source", "over-300mib.mp4");
    await writeSparseFile(oversized, MEDIA_LIBRARY_LIMITS.maxVideoBytes + 1);
    let probed = false;

    await expect(
      importMediaAsset(root, oversized, {
        expectedKind: "video",
        videoProbe: async () => {
          probed = true;
          throw new Error("unexpected probe");
        }
      })
    ).resolves.toMatchObject({ ok: false, code: "media_too_large" });
    expect(probed).toBe(false);
  });

  it("blocks used asset deletion with usage details and removes unused asset files atomically", async () => {
    const root = await createTempRoot();
    const source = path.join(root, "source", "asset.png");
    await writeFile(source, pngBytes(200, 100));
    const imported = await importMediaAsset(root, source, { now: fixedNow });
    expect("ok" in imported).toBe(false);
    if ("ok" in imported) {
      return;
    }

    const blocked = await deleteMediaAsset(root, {
      id: imported.id,
      usages: [{ workspaceId: "current", cardIndex: 1, role: "card-background" }]
    });

    expect(blocked).toMatchObject({ ok: false, code: "asset_in_use" });
    const stillThere = await getMediaAsset(root, imported.id);
    expect("ok" in stillThere).toBe(false);

    const deleted = await deleteMediaAsset(root, { id: imported.id });
    expect(deleted).toMatchObject({ ok: true, deleted: true, id: imported.id, usages: [] });
    if (!("ok" in deleted) || !deleted.ok) {
      return;
    }
    for (const removedPath of deleted.removedPaths) {
      await expect(fs.access(removedPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(getMediaAsset(root, imported.id)).resolves.toMatchObject({ ok: false, code: "not_found" });
  });

  it("rejects managed relative paths that escape the catalog root", async () => {
    const root = await createTempRoot();
    const index = path.join(getManagedMediaRoot(root), "media-index.json");
    await writeFile(
      index,
      JSON.stringify({
        version: 1,
        assets: [
          {
            id: `image-${"a".repeat(20)}-badpath1`,
            kind: "image",
            displayName: "bad.png",
            relativePath: "../escape.png",
            mimeType: "image/png",
            bytes: 10,
            sha256: "a".repeat(64),
            width: 1,
            height: 1,
            importedAt: fixedNow().toISOString()
          }
        ]
      })
    );

    await expect(getMediaAsset(root, `image-${"a".repeat(20)}-badpath1`)).resolves.toMatchObject({
      ok: false,
      code: "invalid_input"
    });
  });
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-media-"));
  tempRoots.push(root);
  return root;
}

async function writeFile(filePath: string, bytes: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

async function writeSparseFile(filePath: string, size: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, "w");
  try {
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
}

function fixedNow(): Date {
  return new Date("2026-07-16T00:00:00.000Z");
}

function pngBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

function mp4Bytes(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  bytes.writeUInt32BE(1, 12);
  bytes.write("isomiso2mp41", 16, "ascii");
  bytes.write(randomUUID().slice(0, 8), 24, "ascii");
  return bytes;
}
