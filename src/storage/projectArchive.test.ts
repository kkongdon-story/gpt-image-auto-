import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card, DeckPreset, MediaAssetRef, StylePresetRecord, WorkspaceState } from "../domain/types.js";
import { normalizeSemanticIdentity } from "../domain/m23Semantic.js";
import {
  collectProjectReferences,
  exportProjectArchive,
  importProjectArchive,
  validateProjectDescriptor
} from "./projectArchive.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

const workspace: WorkspaceState = {
  headerLabel: "MONEY NOTE",
  footerAccount: "@kkongdon_story",
  styleId: "minimal",
  backgroundId: "bg-main",
  fontId: "font-main",
  overrides: {
    "1": {
      backgroundId: "bg-override",
      layers: [
        {
          id: "layer-image",
          kind: "image",
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          backgroundId: "bg-layer"
        }
      ]
    },
    "2": {
      backgroundId: null
    }
  },
  cards: ["유형: 표지\n제목: 프로젝트 테스트"]
};

const preset: DeckPreset = {
  name: "preset with assets",
  headerLabel: "MONEY NOTE",
  footerAccount: "@kkongdon_story",
  styleId: "minimal",
  backgroundId: "bg-preset",
  fontId: "font-preset",
  cards: ["유형: 본문\n제목: 프리셋"]
};

const style: StylePresetRecord = {
  id: "custom-style",
  name: "Custom Style",
  usesPhoto: false,
  pageBackground: "#ffffff",
  textBackdrop: "rgba(255,255,255,0.8)",
  chromeBackdrop: "rgba(255,255,255,0.9)",
  ink: "#111111",
  inkSub: "#333333",
  inkMuted: "#777777",
  accentDefault: "#6c5ce7",
  badgeBackground: "#111111",
  badgeInk: "#ffffff",
  fontTitle: "Pretendard",
  fontBody: "Pretendard",
  usesSurface: true,
  defaultDim: 0.32
};

describe("projectArchive reference integrity", () => {
  it("collects asset references from workspace, overrides, image layers, and presets", () => {
    expect(collectProjectReferences(workspace, [preset])).toEqual({
      backgroundIds: ["bg-layer", "bg-main", "bg-override", "bg-preset"],
      fontIds: ["font-main", "font-preset"],
      mediaIds: []
    });
  });

  it("collects media references from global and card background media, media assets, video layers, scenes, and presets", () => {
    const mediaWorkspace: WorkspaceState = {
      ...workspace,
      backgroundMedia: { mode: "asset", mediaId: "image-aaaaaaaaaaaaaaaaaaaa-main1111" },
      mediaAssets: [mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-main1111")],
      sceneDefaults: {
        durationMs: 5000,
        transition: "fade",
        transitionMs: 500,
        primaryAudioSourceId: "video-bbbbbbbbbbbbbbbbbbbb-audio111"
      },
      overrides: {
        "1": {
          backgroundMedia: { mode: "asset", mediaId: "video-bbbbbbbbbbbbbbbbbbbb-card1111" },
          scene: {
            durationMs: 5000,
            transition: "none",
            transitionMs: 0,
            primaryAudioSourceId: "video-bbbbbbbbbbbbbbbbbbbb-audio222"
          },
          layers: [
            {
              id: "video-layer",
              kind: "video",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              mediaId: "video-bbbbbbbbbbbbbbbbbbbb-layer111",
              objectFit: "cover",
              clipStartMs: 0,
              clipEndMs: null,
              volume: 1
            }
          ]
        }
      }
    };

    const mediaPreset: DeckPreset = {
      ...preset,
      backgroundMedia: { mode: "asset", mediaId: "image-cccccccccccccccccccc-preset11" },
      mediaAssets: [mediaAsset("image-cccccccccccccccccccc-preset11")]
    };

    expect(collectProjectReferences(mediaWorkspace, [mediaPreset]).mediaIds).toEqual([
      "image-aaaaaaaaaaaaaaaaaaaa-main1111",
      "image-cccccccccccccccccccc-preset11",
      "video-bbbbbbbbbbbbbbbbbbbb-audio111",
      "video-bbbbbbbbbbbbbbbbbbbb-audio222",
      "video-bbbbbbbbbbbbbbbbbbbb-card1111",
      "video-bbbbbbbbbbbbbbbbbbbb-layer111"
    ]);
  });

  it("accepts a descriptor whose manifest contains every referenced asset", () => {
    const result = validateProjectDescriptor({
      manifest: {
        version: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
        appVersion: "1.0.0",
        backgrounds: [
          { id: "bg-layer", displayName: "Layer", extension: "png" },
          { id: "bg-main", displayName: "Main", extension: "jpg" },
          { id: "bg-override", displayName: "Override", extension: "webp" },
          { id: "bg-preset", displayName: "Preset", extension: "jpeg" }
        ],
        fonts: [
          { id: "font-main", displayName: "Main Font", extension: "ttf" },
          { id: "font-preset", displayName: "Preset Font", extension: "woff2" }
        ]
      },
      workspace,
      presets: [preset],
      styles: [style]
    });

    expect("ok" in result).toBe(false);
  });

  it("rejects a descriptor when a referenced background is missing from the manifest", () => {
    const result = validateProjectDescriptor({
      manifest: {
        version: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
        appVersion: "1.0.0",
        backgrounds: [
          { id: "bg-main", displayName: "Main", extension: "png" },
          { id: "bg-override", displayName: "Override", extension: "png" },
          { id: "bg-preset", displayName: "Preset", extension: "png" }
        ],
        fonts: [
          { id: "font-main", displayName: "Main Font", extension: "ttf" },
          { id: "font-preset", displayName: "Preset Font", extension: "otf" }
        ]
      },
      workspace,
      presets: [preset],
      styles: []
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_input",
      message: "프로젝트에 필요한 배경 파일이 없습니다: bg-layer"
    });
  });

  it("rejects a descriptor when a referenced font is missing from the manifest", () => {
    const result = validateProjectDescriptor({
      manifest: {
        version: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
        appVersion: "1.0.0",
        backgrounds: [
          { id: "bg-layer", displayName: "Layer", extension: "png" },
          { id: "bg-main", displayName: "Main", extension: "png" },
          { id: "bg-override", displayName: "Override", extension: "png" },
          { id: "bg-preset", displayName: "Preset", extension: "png" }
        ],
        fonts: [{ id: "font-main", displayName: "Main Font", extension: "ttf" }]
      },
      workspace,
      presets: [preset],
      styles: []
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_input",
      message: "프로젝트에 필요한 폰트 파일이 없습니다: font-preset"
    });
  });

  it.each([
    ["background", "bg-../../outside", "font-main"],
    ["font", "bg-main", "font-..\\..\\outside"]
  ] as const)("rejects traversal-shaped %s asset ids", (_kind, backgroundId, fontId) => {
    const result = validateProjectDescriptor({
      manifest: {
        version: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
        appVersion: "1.0.0",
        backgrounds: [{ id: backgroundId, displayName: "Unsafe background", extension: "png" }],
        fonts: [{ id: fontId, displayName: "Unsafe font", extension: "ttf" }]
      },
      workspace: {
        ...workspace,
        backgroundId,
        fontId,
        overrides: {}
      },
      presets: [],
      styles: []
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_input",
      message: "manifest.json 형식이 올바르지 않습니다."
    });
  });
});

describe("projectArchive v2 media import/export", () => {
  it("round-trips M23 semantic content keys and item placements without storage-specific migration", async () => {
    const sourceRoot = await createTempRoot();
    const targetRoot = await createTempRoot();
    const semanticCard: Card = {
      index: 1,
      type: "body",
      title: "의미 ID 테스트",
      paragraphs: ["첫 문단", "둘째 문단"],
      bullets: ["첫 불릿", "둘째 불릿"]
    };
    const semanticOverride = normalizeSemanticIdentity({
      card: semanticCard,
      override: {
        semanticSlots: {
          body: { mode: "card", x: 10, y: 50, width: 80, height: 24, anchor: "top-left" }
        }
      }
    });
    const { backgroundId: _backgroundId, fontId: _fontId, ...workspaceWithoutAssets } = workspace;
    const semanticWorkspace: WorkspaceState = {
      ...workspaceWithoutAssets,
      overrides: { "1": semanticOverride },
      cards: ["유형: 본문\n제목: 의미 ID 테스트\n본문: 첫 문단\n둘째 문단\n- 첫 불릿\n- 둘째 불릿"]
    };
    await writeWorkspace(sourceRoot, semanticWorkspace);

    const archivePath = path.join(sourceRoot, "semantic.zip");
    await exportProjectArchive(sourceRoot, archivePath, "2.0.0");
    const imported = await importProjectArchive(targetRoot, archivePath);

    expect("ok" in imported).toBe(false);
    if ("ok" in imported) return;
    expect(imported.workspace.overrides?.["1"]?.semanticSlots).toEqual(semanticOverride.semanticSlots);
    expect(imported.workspace.overrides?.["1"]?.semanticContentKeys).toEqual(semanticOverride.semanticContentKeys);
    expect(imported.workspace.overrides?.["1"]?.semanticItemPlacements).toEqual(semanticOverride.semanticItemPlacements);
  });

  it("exports media files/posters and imports them with fresh IDs remapped across workspace references", async () => {
    const sourceRoot = await createTempRoot();
    const targetRoot = await createTempRoot();
    const imageBytes = Buffer.from("image-bytes");
    const videoBytes = Buffer.from("video-bytes");
    const posterBytes = Buffer.from("poster-bytes");
    const image = mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-source11", {
      relativePath: "image-aaaaaaaaaaaaaaaaaaaa-source11/photo.png",
      bytes: imageBytes.byteLength,
      sha256: sha256(imageBytes)
    });
    const video = mediaAsset("video-bbbbbbbbbbbbbbbbbbbb-source22", {
      kind: "video",
      relativePath: "video-bbbbbbbbbbbbbbbbbbbb-source22/clip.mp4",
      mimeType: "video/mp4",
      bytes: videoBytes.byteLength,
      sha256: sha256(videoBytes),
      durationMs: 3000,
      hasAudio: true,
      posterRelativePath: "video-bbbbbbbbbbbbbbbbbbbb-source22/poster.png"
    });
    await writeWorkspace(sourceRoot, mediaWorkspaceState(image, video));
    await writeMediaIndex(sourceRoot, [image, video]);
    await writeFile(path.join(sourceRoot, "media", image.relativePath), imageBytes);
    await writeFile(path.join(sourceRoot, "media", video.relativePath), videoBytes);
    await writeFile(path.join(sourceRoot, "media", video.posterRelativePath as string), posterBytes);

    const archivePath = path.join(sourceRoot, "archive.zip");
    const exported = await exportProjectArchive(sourceRoot, archivePath, "2.0.0");

    expect(exported).toMatchObject({ filePath: archivePath, mediaCount: 2 });
    const manifest = JSON.parse(new AdmZip(archivePath).readAsText("manifest.json")) as { version: number; media: unknown[] };
    expect(manifest.version).toBe(2);
    expect(manifest.media).toHaveLength(2);

    const imported = await importProjectArchive(targetRoot, archivePath);

    expect("ok" in imported).toBe(false);
    if ("ok" in imported) return;
    expect(imported.mediaCount).toBe(2);
    const importedMedia = await readMediaIndex(targetRoot);
    expect(importedMedia).toHaveLength(2);
    expect(importedMedia.map((asset) => asset.id).sort()).not.toEqual([image.id, video.id].sort());

    const remappedImage = importedMedia.find((asset) => asset.kind === "image");
    const remappedVideo = importedMedia.find((asset) => asset.kind === "video");
    expect(remappedImage).toBeDefined();
    expect(remappedVideo).toBeDefined();
    if (!remappedImage || !remappedVideo) return;
    expect(imported.workspace.backgroundMedia).toEqual({ mode: "asset", mediaId: remappedImage.id });
    expect(imported.workspace.mediaAssets?.map((asset) => asset.id).sort()).toEqual(
      [remappedImage.id, remappedVideo.id].sort()
    );
    expect(imported.workspace.sceneDefaults?.primaryAudioSourceId).toBe(remappedVideo.id);
    expect(imported.workspace.overrides?.["1"]?.backgroundMedia).toEqual({
      mode: "asset",
      mediaId: remappedVideo.id
    });
    expect(imported.workspace.overrides?.["1"]?.scene?.primaryAudioSourceId).toBe(remappedVideo.id);
    expect(imported.workspace.overrides?.["1"]?.layers?.[0]).toMatchObject({
      kind: "video",
      mediaId: remappedVideo.id
    });
    await expect(fs.readFile(path.join(targetRoot, "media", remappedImage.relativePath), "utf8")).resolves.toBe(
      "image-bytes"
    );
    await expect(fs.readFile(path.join(targetRoot, "media", remappedVideo.posterRelativePath as string), "utf8")).resolves.toBe(
      "poster-bytes"
    );
  });

  it("rejects missing required media without mutating the target workspace", async () => {
    const root = await createTempRoot();
    await writeWorkspace(root, { ...workspace, cards: ["유형: 표지\n제목: 기존"] });
    const archivePath = path.join(root, "missing-media.zip");
    const asset = mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-missing1");
    writeArchive(archivePath, {
      manifest: manifestV2([asset]),
      workspace: mediaWorkspaceState(asset),
      omitMediaFile: true
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: `프로젝트 파일에 media/files/${asset.id}/asset.png 항목이 없습니다.`
    });
    const kept = JSON.parse(await fs.readFile(path.join(root, "workspace.json"), "utf8")) as WorkspaceState;
    expect(kept.cards).toEqual(["유형: 표지\n제목: 기존"]);
  });

  it("imports when an optional poster payload is missing and omits poster metadata", async () => {
    const sourceRoot = await createTempRoot();
    const targetRoot = await createTempRoot();
    const archivePath = path.join(sourceRoot, "missing-poster.zip");
    const video = videoAsset("video-aaaaaaaaaaaaaaaaaaaa-poster11", {
      posterRelativePath: "video-aaaaaaaaaaaaaaaaaaaa-poster11/poster.png"
    });
    writeArchive(archivePath, {
      manifest: manifestV2([video]),
      workspace: mediaWorkspaceState(video),
      omitPosterFile: true
    });

    const result = await importProjectArchive(targetRoot, archivePath);

    expect("ok" in result).toBe(false);
    if ("ok" in result) return;
    const importedMedia = await readMediaIndex(targetRoot);
    expect(importedMedia).toHaveLength(1);
    const importedAsset = importedMedia[0];
    expect(importedAsset).toBeDefined();
    if (!importedAsset) return;
    expect(importedAsset.posterRelativePath).toBeUndefined();
    expect(result.workspace.mediaAssets?.[0]?.posterRelativePath).toBeUndefined();
    expect(result.workspace.backgroundMedia).toEqual({ mode: "asset", mediaId: importedAsset.id });
  });

  it("rolls back created payload files and state files when commit fails after file writes", async () => {
    const sourceRoot = await createTempRoot();
    const targetRoot = await createTempRoot();
    const archivePath = path.join(sourceRoot, "rollback.zip");
    const asset = mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-rollbck1");
    await writeWorkspace(targetRoot, { ...workspace, cards: ["유형: 표지\n제목: 기존"] });
    await fs.mkdir(path.join(targetRoot, "media", "media-index.json"), { recursive: true });
    writeArchive(archivePath, {
      manifest: manifestV2([asset]),
      workspace: mediaWorkspaceState(asset)
    });

    const result = await importProjectArchive(targetRoot, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "프로젝트 가져오기를 완료하지 못했습니다."
    });
    await expect(fs.readFile(path.join(targetRoot, "workspace.json"), "utf8")).resolves.toContain("기존");
    await expect(pathExists(path.join(targetRoot, "media", asset.id, "asset.png"))).resolves.toBe(false);
    await expect(pathExists(path.join(targetRoot, "media", asset.id))).resolves.toBe(false);
    await expect(pathExists(path.join(targetRoot, "library", "backgrounds.json"))).resolves.toBe(false);
  });

  it.each([
    ["tampered SHA", { sha256: "b".repeat(64) }, "미디어 파일 해시가 메타데이터와 일치하지 않습니다"],
    ["wrong size", { bytes: 999 }, "미디어 파일 크기가 메타데이터와 일치하지 않습니다"]
  ] as const)("rejects %s before mutating the target workspace", async (_label, overrides, message) => {
    const root = await createTempRoot();
    const archivePath = path.join(root, "tampered-media.zip");
    const existingWorkspace = { ...workspace, cards: ["유형: 표지\n제목: 기존"] };
    await writeWorkspace(root, existingWorkspace);
    const asset = mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-tamper11", overrides);
    writeArchive(archivePath, {
      manifest: manifestV2([asset]),
      workspace: mediaWorkspaceState(asset)
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: `${message}: ${asset.id}`
    });
    await expect(fs.readFile(path.join(root, "workspace.json"), "utf8")).resolves.toContain("기존");
    await expect(pathExists(path.join(root, "media", asset.id))).resolves.toBe(false);
  });

  it("rejects duplicate media IDs in the v2 media manifest", async () => {
    const root = await createTempRoot();
    const archivePath = path.join(root, "duplicate-id.zip");
    const first = mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-dupe111");
    const manifest = {
      ...manifestV2([]),
      media: [toManifestMedia(first), toManifestMedia(first)]
    };
    writeArchive(archivePath, {
      manifest,
      workspace: mediaWorkspaceState(first)
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "manifest.json 형식이 올바르지 않습니다."
    });
    await expect(pathExists(path.join(root, "media", "media-index.json"))).resolves.toBe(false);
  });

  it("rejects duplicate media file paths in the v2 media manifest", async () => {
    const root = await createTempRoot();
    const archivePath = path.join(root, "duplicate-path.zip");
    const first = mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-duppath");
    const second = mediaAsset("image-bbbbbbbbbbbbbbbbbbbb-duppath", {
      relativePath: "image-bbbbbbbbbbbbbbbbbbbb-duppath/other.png"
    });
    const duplicatePath = `media/files/${first.id}/asset.png`;
    const manifest = {
      ...manifestV2([]),
      media: [
        toManifestMedia(first, { filePath: duplicatePath }),
        toManifestMedia(second, { filePath: duplicatePath })
      ]
    };
    writeArchive(archivePath, {
      manifest,
      workspace: mediaWorkspaceState(first)
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "manifest.json 형식이 올바르지 않습니다."
    });
    await expect(pathExists(path.join(root, "media", "media-index.json"))).resolves.toBe(false);
  });

  it("rejects duplicate media poster paths in the v2 media manifest", async () => {
    const root = await createTempRoot();
    const archivePath = path.join(root, "duplicate-poster-path.zip");
    const first = videoAsset("video-aaaaaaaaaaaaaaaaaaaa-duppostr", {
      posterRelativePath: "video-aaaaaaaaaaaaaaaaaaaa-duppostr/poster.png"
    });
    const second = videoAsset("video-bbbbbbbbbbbbbbbbbbbb-duppostr", {
      posterRelativePath: "video-bbbbbbbbbbbbbbbbbbbb-duppostr/poster.png"
    });
    const duplicatePosterPath = `media/posters/${first.id}/poster.png`;
    const manifest = {
      ...manifestV2([]),
      media: [
        toManifestMedia(first, { posterPath: duplicatePosterPath }),
        toManifestMedia(second, { posterPath: duplicatePosterPath })
      ]
    };
    writeArchive(archivePath, {
      manifest,
      workspace: mediaWorkspaceState(first)
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "manifest.json 형식이 올바르지 않습니다."
    });
    await expect(pathExists(path.join(root, "media", "media-index.json"))).resolves.toBe(false);
  });

  it.each([
    [
      "total declared archive bytes",
      [
        mediaAsset("video-aaaaaaaaaaaaaaaaaaaa-total111", {
          kind: "video",
          mimeType: "video/mp4",
          bytes: 500 * 1024 * 1024,
          relativePath: "video-aaaaaaaaaaaaaaaaaaaa-total111/clip.mp4"
        }),
        mediaAsset("video-bbbbbbbbbbbbbbbbbbbb-total222", {
          kind: "video",
          mimeType: "video/mp4",
          bytes: 500 * 1024 * 1024,
          relativePath: "video-bbbbbbbbbbbbbbbbbbbb-total222/clip.mp4"
        }),
        mediaAsset("video-cccccccccccccccccccc-total333", {
          kind: "video",
          mimeType: "video/mp4",
          bytes: 500 * 1024 * 1024,
          relativePath: "video-cccccccccccccccccccc-total333/clip.mp4"
        }),
        mediaAsset("video-dddddddddddddddddddd-total444", {
          kind: "video",
          mimeType: "video/mp4",
          bytes: 500 * 1024 * 1024,
          relativePath: "video-dddddddddddddddddddd-total444/clip.mp4"
        }),
        mediaAsset("video-eeeeeeeeeeeeeeeeeeee-total555", {
          kind: "video",
          mimeType: "video/mp4",
          bytes: 500 * 1024 * 1024,
          relativePath: "video-eeeeeeeeeeeeeeeeeeee-total555/clip.mp4"
        })
      ],
      "manifest.json 형식이 올바르지 않습니다."
    ],
    [
      "per-kind image count",
      Array.from({ length: 151 }, (_, index) =>
        mediaAsset(`image-${index.toString(16).padStart(20, "0")}-kind${index.toString().padStart(4, "0")}`)
      ),
      "manifest.json 형식이 올바르지 않습니다."
    ]
  ] as const)("rejects oversized %s before writing", async (_label, media, message) => {
    const root = await createTempRoot();
    const archivePath = path.join(root, "oversized-media.zip");
    writeArchive(archivePath, {
      manifest: manifestV2(media),
      workspace: mediaWorkspaceState(media[0])
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message
    });
    await expect(pathExists(path.join(root, "media", "media-index.json"))).resolves.toBe(false);
  });

  it.each([
    ["traversal", "../escape.png"],
    ["absolute", "/tmp/escape.png"],
    ["drive", "C:/tmp/escape.png"]
  ])("rejects unsafe %s media archive paths", async (_kind, filePath) => {
    const root = await createTempRoot();
    const archivePath = path.join(root, "unsafe.zip");
    const asset = { ...mediaAsset("image-aaaaaaaaaaaaaaaaaaaa-unsafe1"), filePath };
    writeArchive(archivePath, {
      manifest: { ...manifestV2([asset]), media: [asset] },
      workspace: mediaWorkspaceState(asset)
    });

    const result = await importProjectArchive(root, archivePath);

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "manifest.json 형식이 올바르지 않습니다."
    });
  });

  it("imports v1 archives without media metadata for backward compatibility", async () => {
    const sourceRoot = await createTempRoot();
    const targetRoot = await createTempRoot();
    const archivePath = path.join(sourceRoot, "v1.zip");
    writeArchive(archivePath, {
      manifest: {
        version: 1,
        createdAt: "2026-07-16T00:00:00.000Z",
        appVersion: "1.0.0",
        backgrounds: [],
        fonts: []
      },
      workspace: legacyWorkspaceWithoutAssets()
    });

    const result = await importProjectArchive(targetRoot, archivePath);

    expect("ok" in result).toBe(false);
    if ("ok" in result) return;
    expect(result.mediaCount).toBe(0);
    expect(result.workspace.cards).toEqual(workspace.cards);
    await expect(fs.readFile(path.join(targetRoot, "workspace.json"), "utf8")).resolves.toContain("프로젝트 테스트");
  });
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-archive-"));
  tempRoots.push(root);
  return root;
}

async function writeFile(filePath: string, bytes: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

async function writeWorkspace(root: string, state: WorkspaceState): Promise<void> {
  await writeFile(path.join(root, "workspace.json"), JSON.stringify(state, null, 2));
}

async function writeMediaIndex(root: string, assets: readonly (MediaAssetRef & { readonly importedAt?: string })[]): Promise<void> {
  await writeFile(
    path.join(root, "media", "media-index.json"),
    JSON.stringify({
      version: 1,
      assets: assets.map((asset) => ({ importedAt: "2026-07-16T00:00:00.000Z", ...asset }))
    })
  );
}

async function readMediaIndex(root: string): Promise<readonly (MediaAssetRef & { readonly importedAt: string })[]> {
  const parsed = JSON.parse(await fs.readFile(path.join(root, "media", "media-index.json"), "utf8")) as {
    assets: readonly (MediaAssetRef & { readonly importedAt: string })[];
  };
  return parsed.assets;
}

function writeArchive(
  archivePath: string,
  input: {
    readonly manifest: unknown;
    readonly workspace: WorkspaceState;
    readonly omitMediaFile?: boolean;
    readonly omitPosterFile?: boolean;
  }
): void {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(input.manifest, null, 2), "utf8"));
  zip.addFile("workspace.json", Buffer.from(JSON.stringify(input.workspace, null, 2), "utf8"));
  zip.addFile("presets.json", Buffer.from("[]", "utf8"));
  zip.addFile("styles.json", Buffer.from("[]", "utf8"));
  const manifest = input.manifest as { readonly media?: readonly ProjectManifestMedia[] };
  for (const asset of manifest.media ?? []) {
    if (!input.omitMediaFile) {
      zip.addFile(asset.filePath, Buffer.from("media-bytes"));
    }
    if (asset.posterPath && !input.omitPosterFile) {
      zip.addFile(asset.posterPath, Buffer.from("poster-bytes"));
    }
  }
  zip.writeZip(archivePath);
}

type ProjectManifestMedia = MediaAssetRef & {
  readonly filePath: string;
  readonly posterPath?: string;
};

function toManifestMedia(asset: MediaAssetRef, overrides: Partial<ProjectManifestMedia> = {}): ProjectManifestMedia {
  return {
    ...asset,
    filePath: `media/files/${asset.id}/${path.posix.basename(asset.relativePath)}`,
    ...(asset.posterRelativePath
      ? { posterPath: `media/posters/${asset.id}/${path.posix.basename(asset.posterRelativePath)}` }
      : {}),
    ...overrides
  };
}

function manifestV2(assets: readonly MediaAssetRef[]): {
  readonly version: 2;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly backgrounds: readonly [];
  readonly fonts: readonly [];
  readonly media: readonly ProjectManifestMedia[];
} {
  return {
    version: 2,
    createdAt: "2026-07-16T00:00:00.000Z",
    appVersion: "2.0.0",
    backgrounds: [],
    fonts: [],
    media: assets.map((asset) => toManifestMedia(asset))
  };
}

function mediaWorkspaceState(image: MediaAssetRef, video?: MediaAssetRef): WorkspaceState {
  return {
    headerLabel: "MONEY NOTE",
    footerAccount: "@kkongdon_story",
    styleId: "minimal",
    backgroundMedia: { mode: "asset", mediaId: image.id },
    mediaAssets: video ? [image, video] : [image],
    ...(video
      ? {
          sceneDefaults: {
            durationMs: 5000,
            transition: "none" as const,
            transitionMs: 0,
            primaryAudioSourceId: video.id
          },
          overrides: {
            "1": {
              backgroundMedia: { mode: "asset", mediaId: video.id },
              scene: {
                durationMs: 3000,
                transition: "fade",
                transitionMs: 300,
                primaryAudioSourceId: video.id
              },
              layers: [
                {
                  id: "video-layer",
                  kind: "video" as const,
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  mediaId: video.id,
                  objectFit: "cover" as const,
                  clipStartMs: 0,
                  clipEndMs: null,
                  volume: 1
                }
              ]
            }
          }
        }
      : {}),
    cards: ["유형: 표지\n제목: 미디어 프로젝트"]
  };
}

function legacyWorkspaceWithoutAssets(): WorkspaceState {
  return {
    headerLabel: workspace.headerLabel,
    footerAccount: workspace.footerAccount,
    styleId: workspace.styleId,
    cards: workspace.cards,
    overrides: {}
  };
}

function mediaAsset(
  id: string,
  overrides: Partial<MediaAssetRef> = {}
): MediaAssetRef {
  const bytes = Buffer.from("media-bytes");
  return {
    id,
    kind: "image",
    displayName: "asset.png",
    relativePath: `${id}/asset.png`,
    mimeType: "image/png",
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    width: 100,
    height: 100,
    ...overrides
  };
}

function videoAsset(id: string, overrides: Partial<MediaAssetRef> = {}): MediaAssetRef {
  return mediaAsset(id, {
    kind: "video",
    displayName: "clip.mp4",
    relativePath: `${id}/clip.mp4`,
    mimeType: "video/mp4",
    durationMs: 1000,
    hasAudio: true,
    ...overrides
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
