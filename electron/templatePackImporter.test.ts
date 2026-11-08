import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { templatePackSchema } from "../src/domain/templatePack.js";
import {
  listBackgroundLibrary,
  listCustomStyles,
  loadWorkspaceState,
  saveBackgroundBufferToLibrary
} from "../src/storage/deckStore.js";
import { importTemplatePackArchive } from "./templatePackImporter.js";

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

vi.mock("electron", () => ({
  nativeImage: {
    createFromBuffer(bytes: Buffer) {
      const isCorrupt = bytes.includes(Buffer.from("CORRUPT"));
      return {
        isEmpty: () => isCorrupt,
        getSize: () => ({ width: 24, height: 24 }),
        toPNG: () => Buffer.concat([pngMagic, Buffer.from("NORMALIZED")])
      };
    }
  }
}));

describe("importTemplatePackArchive", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-template-pack-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { force: true, recursive: true });
  });

  test("rolls back copied backgrounds when a later import step fails", async () => {
    const preexisting = await saveBackgroundBufferToLibrary(
      tempRoot,
      Buffer.from("preexisting background"),
      "preexisting.png",
      "test"
    );
    expect(preexisting).toMatchObject({ id: expect.stringMatching(/^bg-/) });

    const zipPath = await writeTemplatePack(tempRoot, validManifest(), {
      "backgrounds/card-01-clean.png": validPng("background")
    });

    const result = await importTemplatePackArchive(tempRoot, zipPath, {
      afterBackgroundsSaved: () => {
        throw new Error("forced failure after background save");
      }
    });

    expect(result).toMatchObject({ ok: false });
    const backgrounds = await listBackgroundLibrary(tempRoot);
    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0]?.id).toBe(preexisting.ok === false ? undefined : preexisting.id);

    const backgroundFiles = await listFiles(path.join(tempRoot, "library", "backgrounds"));
    expect(backgroundFiles).toHaveLength(1);
    expect(backgroundFiles[0]).toBe(preexisting.ok === false ? undefined : `${preexisting.id}.png`);
    expect(await loadWorkspaceState(tempRoot)).toBeNull();
  });

  test("rejects unsafe style before saving assets or workspace", async () => {
    const zipPath = await writeTemplatePack(
      tempRoot,
      validManifest({
        style: {
          name: "Unsafe Style",
          pageBackground: "url(https://example.com/bad.png)"
        }
      }),
      {
        "backgrounds/card-01-clean.png": validPng("background")
      }
    );

    const result = await importTemplatePackArchive(tempRoot, zipPath);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false ? result.message : "").toContain("스타일이 안전하지 않습니다");
    expect(await listBackgroundLibrary(tempRoot)).toHaveLength(0);
    expect(await listCustomStyles(tempRoot)).toHaveLength(0);
    expect(await loadWorkspaceState(tempRoot)).toBeNull();
  });

  test("rejects duplicate normalized asset paths", async () => {
    const zipPath = await writeTemplatePack(tempRoot, validManifest(), {
      "backgrounds/card-01-clean.png": validPng("background"),
      "backgrounds/CARD-01-CLEAN.png": validPng("duplicate")
    });

    const result = await importTemplatePackArchive(tempRoot, zipPath);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false ? result.message : "").toContain("중복된 파일 경로");
    expect(await listBackgroundLibrary(tempRoot)).toHaveLength(0);
  });

  test("rejects extension and content mismatches", async () => {
    const zipPath = await writeTemplatePack(
      tempRoot,
      validManifest({ backgroundImage: "backgrounds/card-01-clean.jpg" }),
      {
        "backgrounds/card-01-clean.jpg": validPng("background")
      }
    );

    const result = await importTemplatePackArchive(tempRoot, zipPath);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false ? result.message : "").toContain("확장자와 실제 파일 형식");
  });

  test("rejects images that fail decoding", async () => {
    const zipPath = await writeTemplatePack(tempRoot, validManifest(), {
      "backgrounds/card-01-clean.png": Buffer.concat([pngMagic, Buffer.from("CORRUPT")])
    });

    const result = await importTemplatePackArchive(tempRoot, zipPath);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false ? result.message : "").toContain("디코딩할 수 없습니다");
  });
});

function validManifest(
  overrides: {
    readonly backgroundImage?: string;
    readonly style?: Record<string, unknown>;
  } = {}
): Record<string, unknown> {
  const backgroundImage = overrides.backgroundImage ?? "backgrounds/card-01-clean.png";
  const style = {
    name: "M13 Import Test Style",
    pageBackground: "#111111",
    ink: "#ffffff",
    inkSub: "#f5f5f5",
    accentDefault: "#ffd23c",
    ...overrides.style
  };

  return {
    schema: templatePackSchema,
    name: "M13 Import Test Pack",
    style,
    chrome: {
      header: "M13 TEST",
      footer: "kkongdon_story",
      pageFormat: "{n} / {total}"
    },
    cards: [
      {
        type: "cover",
        backgroundImage,
        badge: "M13",
        title: "템플릿팩 테스트",
        subtitle: "rollback 검증"
      }
    ]
  };
}

async function writeTemplatePack(
  root: string,
  manifest: Record<string, unknown>,
  assets: Readonly<Record<string, Buffer>>
): Promise<string> {
  const zipPath = path.join(root, `pack-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const zip = new AdmZip();
  zip.addFile("template.json", Buffer.from(JSON.stringify(manifest), "utf8"));
  for (const [assetPath, bytes] of Object.entries(assets)) {
    zip.addFile(assetPath, bytes);
  }
  zip.writeZip(zipPath);
  return zipPath;
}

function validPng(label: string): Buffer {
  return Buffer.concat([pngMagic, Buffer.from(label)]);
}

async function listFiles(directory: string): Promise<readonly string[]> {
  try {
    return (await fs.readdir(directory)).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
