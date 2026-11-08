import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CardnewsError, CardnewsResult, Deck } from "../domain/types.js";
import {
  buildDeckFromDraft,
  addBackgroundToLibrary,
  isDeckPreset,
  isWorkspaceState,
  listBackgroundLibrary,
  listImageLibrary,
  loadWorkspaceState,
  createTemplatePackImportStorageSnapshot,
  findLibraryFont,
  getRenderOutputDirectory,
  isRenderJobId,
  restoreTemplatePackImportStorageSnapshot,
  smokeFixtureImageAttribution,
  internalSmokeImageAttribution,
  removeBackgroundFromLibrary,
  removeImageFromLibrary,
  saveBackgroundBufferToLibrary,
  saveImageBufferToLibrary,
  saveWorkspaceState
} from "./deckStore.js";

function isCardnewsError<T extends object>(result: CardnewsResult<T>): result is CardnewsError {
  return "ok" in result && result.ok === false;
}

describe("deckStore migration guards", () => {
  it("accepts M21 title placement, text opacity, and inert bulk binding metadata", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "kkongdon_story",
        styleId: "newsprint",
        overrides: {
          "1": {
            layout: {
              align: "left",
              offsetY: 0,
              gapBadge: 1,
              gapSubtitle: 1,
              titlePlacement: { mode: "card-y", y: 5 }
            },
            typography: { textOpacity: 45 },
            layers: [
              {
                id: "text-1",
                kind: "text",
                x: 10,
                y: 20,
                width: 40,
                height: 10,
                text: "대량 생성 텍스트",
                textOpacity: 30
              }
            ]
          }
        },
        bulkBindings: {
          schemaVersion: 1,
          templateId: "template-m21",
          templateRevision: 1,
          bindings: [
            {
              key: "card_1_layer_text_1",
              label: "1페이지 텍스트",
              required: false,
              target: { kind: "layer-text", cardNumber: 1, layerId: "text-1", property: "text" }
            }
          ]
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);
  });
  it("accepts v3 workspace snapshots without v4 optional fields", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "newsprint",
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("accepts v4 workspace overrides and rail width", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "newsprint",
        aspectRatio: "16:9",
        backgroundId: "bg-test",
        railWidth: 220,
        overrides: {
          "1": {
            backgroundId: null,
            adjust: { brightness: 1.2, contrast: 0.9, saturation: 1.1 },
            layout: { align: "center", offsetY: -4, gapBadge: 1.2, gapSubtitle: 0.8 },
            dim: 0.4
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("accepts v4 preset overrides", () => {
    expect(
      isDeckPreset({
        name: "wide preset",
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        aspectRatio: "4:3",
        overrides: {
          "2": { backgroundId: "bg-test" }
        },
        cards: ["유형: 본문\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("rejects malformed badge text colors at the workspace boundary", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            badge: { textColor: "blue" }
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(false);

    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            badge: { textColor: "#112233" }
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);
  });

  it("accepts and preserves valid typography colors at the workspace boundary", async () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            typography: { color: "#aabbcc", scope: "all" }
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(true);

    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-typography-color-"));
    await fs.writeFile(
      path.join(storageRoot, "workspace.json"),
      JSON.stringify({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            typography: { color: "#aabbcc", scope: "title" }
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      }),
      "utf8"
    );

    const state = await loadWorkspaceState(storageRoot);

    expect(state?.overrides?.["1"]?.typography?.color).toBe("#AABBCC");
  });

  it("accepts body-number text only when it is a string", () => {
    const workspace = {
      headerLabel: "MONEY NOTE",
      footerAccount: "@kkongdon_story",
      styleId: "minimal",
      cards: ["유형: 본문\n제목: 테스트"]
    };

    expect(
      isWorkspaceState({
        ...workspace,
        overrides: {
          "1": { bodyNumberText: "" }
        }
      })
    ).toBe(true);
    expect(
      isWorkspaceState({
        ...workspace,
        overrides: {
          "1": { bodyNumberText: 99 }
        }
      })
    ).toBe(false);
  });

  it("retains custom, empty, deleted, and placement-only body-number overrides after loading", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-body-number-state-"));
    await fs.writeFile(
      path.join(storageRoot, "workspace.json"),
      JSON.stringify({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": { bodyNumberText: "첫 번째", bodyNumberMode: "show" },
          "2": { bodyNumberText: "" },
          "3": { bodyNumberMode: "hide" },
          "4": {
            semanticItemPlacements: {
              "card-4:body-number": {
                mode: "card",
                x: 10,
                y: 20,
                width: 30,
                height: 10,
                anchor: "top-left"
              }
            }
          }
        },
        cards: [
          "유형: 본문\n제목: 첫 장",
          "유형: 본문\n제목: 둘째 장",
          "유형: 본문\n제목: 셋째 장",
          "유형: 본문\n제목: 넷째 장"
        ]
      }),
      "utf8"
    );

    const state = await loadWorkspaceState(storageRoot);
    const loadedOverrides = state?.overrides as
      | Record<string, { readonly bodyNumberText?: string; readonly bodyNumberMode?: string; readonly semanticItemPlacements?: object }>
      | undefined;

    expect(loadedOverrides?.["1"]).toMatchObject({
      bodyNumberText: "첫 번째",
      bodyNumberMode: "show"
    });
    expect(loadedOverrides?.["2"]).toHaveProperty("bodyNumberText", "");
    expect(loadedOverrides?.["3"]).toEqual({ bodyNumberMode: "hide" });
    expect(loadedOverrides?.["4"]?.semanticItemPlacements).toHaveProperty("card-4:body-number");
  });

  it("rejects malformed typography colors before persistence", () => {
    expect(
      isWorkspaceState({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            typography: { color: "var(--unsafe)", scope: "all" }
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      })
    ).toBe(false);
  });

  it("migrates legacy rect/rotation line layers when loading a workspace", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-workspace-"));
    await fs.writeFile(
      path.join(storageRoot, "workspace.json"),
      JSON.stringify({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        overrides: {
          "1": {
            layers: [
              {
                id: "legacy-line",
                kind: "line",
                x: 40,
                y: 20,
                width: 30,
                height: 1,
                color: "#111111",
                strokeWidth: 5,
                rotation: 90
              }
            ]
          }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      }),
      "utf8"
    );

    const state = await loadWorkspaceState(storageRoot);
    const layer = state?.overrides?.["1"]?.layers?.[0];

    expect(state?.footerAccount).toBe("@kkongdon_story");
    expect(layer?.kind).toBe("line");
    if (layer?.kind !== "line") {
      throw new Error("expected migrated line layer");
    }
    expect(layer.x1).toBeCloseTo(55, 3);
    expect(layer.y1).toBeCloseTo(8.5, 3);
    expect(layer.x2).toBeCloseTo(55, 3);
    expect(layer.y2).toBeCloseTo(32.5, 3);
    expect(layer.thickness).toBe(5);
  });

  it("normalizes optional chrome settings when loading a workspace", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-workspace-chrome-"));
    await fs.writeFile(
      path.join(storageRoot, "workspace.json"),
      JSON.stringify({
        headerLabel: "MONEY NOTE",
        footerAccount: "@kkongdon_story",
        styleId: "minimal",
        chrome: {
          header: { color: "#123456", fontSize: 4, offsetX: 90 },
          footer: { visible: false },
          pageNumber: { template: "{n2}", color: "white", offsetY: -90 }
        },
        cards: ["유형: 표지\n제목: 테스트"]
      }),
      "utf8"
    );

    const state = await loadWorkspaceState(storageRoot);

    expect(state?.chrome?.header.color).toBe("#123456");
    expect(state?.chrome?.header.fontSize).toBe(18);
    expect(state?.chrome?.header.offsetX).toBe(40);
    expect(state?.chrome?.footer.visible).toBe(false);
    expect(state?.chrome?.pageNumber.template).toBe("{n2}");
    expect(state?.chrome?.pageNumber.color).toBe("#141414");
    expect(state?.chrome?.pageNumber.offsetY).toBe(-40);
  });

  it("preserves visible @ footer values at the deck boundary", () => {
    const cases: readonly [string, string][] = [
      ["", "kkongdon_story"],
      ["@", "kkongdon_story"],
      ["@kkongdon_story", "@kkongdon_story"],
      ["kkongdon_story", "kkongdon_story"]
    ];

    for (const [footerAccount, expectedFooter] of cases) {
      const deck = buildDeckFromDraft(
        "current",
        {
          headerLabel: "MONEY NOTE",
          footerAccount,
          cards: [{ index: 1, rawText: "유형: 표지\n제목: 테스트" }]
        },
        undefined
      );

      if (isCardnewsError(deck)) {
        throw new Error(deck.message);
      }
      expect(deck.footerAccount).toBe(expectedFooter);
    }
  });

  it("purges smoke image fixtures from the normal user image library", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-image-library-"));
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    await saveImageBufferToLibrary(storageRoot, pngBytes, "badge-smoke-source.png", internalSmokeImageAttribution);
    await saveImageBufferToLibrary(storageRoot, pngBytes, "qa-picker-visible.png", smokeFixtureImageAttribution);
    await saveImageBufferToLibrary(storageRoot, pngBytes, "user-upload.png");

    const images = await listImageLibrary(storageRoot);
    const persisted = JSON.parse(
      await fs.readFile(path.join(storageRoot, "library", "images.json"), "utf8")
    ) as Array<{ readonly displayName: string }>;

    expect(images.map((image) => image.displayName)).toEqual(["user-upload.png"]);
    expect(persisted.map((image) => image.displayName)).toEqual(["user-upload.png"]);
  });

  it("preserves user uploads whose names resemble smoke fixtures", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-image-library-user-smoke-name-"));
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    await saveImageBufferToLibrary(storageRoot, pngBytes, "qa-picker-visible.png");

    const images = await listImageLibrary(storageRoot);
    const persisted = JSON.parse(
      await fs.readFile(path.join(storageRoot, "library", "images.json"), "utf8")
    ) as Array<{ readonly displayName: string }>;

    expect(images.map((image) => image.displayName)).toEqual(["qa-picker-visible.png"]);
    expect(persisted.map((image) => image.displayName)).toEqual(["qa-picker-visible.png"]);
  });

  it("allows visible smoke fixtures only during smoke-mode image picker checks", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-image-library-smoke-"));
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    await saveImageBufferToLibrary(storageRoot, pngBytes, "badge-smoke-source.png", internalSmokeImageAttribution);
    await saveImageBufferToLibrary(storageRoot, pngBytes, "qa-picker-visible.png", smokeFixtureImageAttribution);
    await saveImageBufferToLibrary(storageRoot, pngBytes, "user-upload.png");

    const images = await listImageLibrary(storageRoot, { includeSmokeFixtures: true });

    expect(images.map((image) => image.displayName)).toEqual(["qa-picker-visible.png", "user-upload.png"]);
  });

  it("removes a user image from the library index and disk", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-image-remove-"));
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const added = await saveImageBufferToLibrary(storageRoot, pngBytes, "user-upload.png");
    if (isCardnewsError(added)) {
      throw new Error(`Expected image import to succeed: ${added.message}`);
    }

    const result = await removeImageFromLibrary(storageRoot, added.id);
    const images = await listImageLibrary(storageRoot);

    expect(result).toEqual({ id: added.id, removed: true });
    expect(images).toEqual([]);
    await expect(fs.access(path.join(storageRoot, "library", "images", `${added.id}.png`))).rejects.toThrow();
  });

  it("removes an unused background from the library index and disk", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-background-remove-"));
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const added = await saveBackgroundBufferToLibrary(storageRoot, pngBytes, "card-01-clean.png");
    if (isCardnewsError(added)) {
      throw new Error(`Expected background import to succeed: ${added.message}`);
    }

    const result = await removeBackgroundFromLibrary(storageRoot, added.id);
    const backgrounds = await listBackgroundLibrary(storageRoot);

    expect(result).toEqual({ id: added.id, removed: true });
    expect(backgrounds).toEqual([]);
    await expect(
      fs.access(path.join(storageRoot, "library", "backgrounds", `${added.id}.png`))
    ).rejects.toThrow();
  });

  it("blocks storage deletion when the persisted workspace still references the background", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-background-used-"));
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const added = await saveBackgroundBufferToLibrary(storageRoot, pngBytes, "used-background.png");
    if (isCardnewsError(added)) {
      throw new Error(`Expected background import to succeed: ${added.message}`);
    }

    await saveWorkspaceState(storageRoot, {
      headerLabel: "MONEY NOTE",
      footerAccount: "kkongdon_story",
      styleId: "newsprint",
      backgroundId: added.id,
      overrides: {
        "2": { backgroundId: added.id },
        "3": {
          layers: [
            {
              id: "layer-background",
              kind: "image",
              x: 10,
              y: 10,
              width: 20,
              height: 20,
              backgroundId: added.id
            }
          ]
        }
      },
      cards: ["유형: 표지\n제목: 테스트"]
    });

    const result = await removeBackgroundFromLibrary(storageRoot, added.id);

    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    if (isCardnewsError(result)) {
      expect(result.message).toContain("전역 배경");
      expect(result.message).toContain("카드 2 배경");
      expect(result.message).toContain("카드 3 이미지 레이어");
    }
    expect(await listBackgroundLibrary(storageRoot)).toEqual([added]);
    await expect(
      fs.access(path.join(storageRoot, "library", "backgrounds", `${added.id}.png`))
    ).resolves.toBeUndefined();
  });

  it("creates distinct background ids even when two imports share a timestamp", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-background-id-"));
    const sourcePath = path.join(storageRoot, "same-name.png");
    await fs.writeFile(sourcePath, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_720_000_000_000);

    try {
      const first = await addBackgroundToLibrary(storageRoot, sourcePath);
      const second = await addBackgroundToLibrary(storageRoot, sourcePath);
      if (isCardnewsError(first) || isCardnewsError(second)) {
        throw new Error("Expected both background imports to succeed");
      }

      expect(first.id).not.toBe(second.id);
      expect(await listBackgroundLibrary(storageRoot)).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it("returns a controlled miss when removing an unknown background", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-background-remove-miss-"));

    await expect(removeBackgroundFromLibrary(storageRoot, "bg-missing")).resolves.toEqual({
      id: "bg-missing",
      removed: false
    });
  });

  it("returns a controlled miss when removing an unknown image", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-image-remove-miss-"));

    await expect(removeImageFromLibrary(storageRoot, "img-missing")).resolves.toEqual({
      id: "img-missing",
      removed: false
    });
  });

  it("rejects path-shaped render job ids before resolving output paths", () => {
    expect(isRenderJobId("render-2026-07-10T12-00-00")).toBe(true);
    expect(isRenderJobId("render-x/../../../outside")).toBe(false);
    expect(isRenderJobId("render-x\\..\\..\\outside")).toBe(false);
    expect(() => getRenderOutputDirectory("C:/cardnews", "render-x/../../../outside")).toThrow(
      "Unsafe render job id"
    );
  });

  it("ignores poisoned image index entries instead of deleting outside the image library", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-image-index-traversal-"));
    const libraryRoot = path.join(storageRoot, "library");
    const outsidePath = path.join(libraryRoot, "outside.png");
    await fs.mkdir(path.join(libraryRoot, "images"), { recursive: true });
    await fs.writeFile(outsidePath, "keep");
    await fs.writeFile(
      path.join(libraryRoot, "images.json"),
      JSON.stringify([
        {
          id: "../outside",
          displayName: "poisoned.png",
          extension: "png",
          attribution: smokeFixtureImageAttribution
        }
      ]),
      "utf8"
    );

    await expect(removeImageFromLibrary(storageRoot, "../outside")).resolves.toEqual({
      id: "../outside",
      removed: false
    });
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("keep");
  });

  it("ignores poisoned background index entries during snapshot rollback", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-background-index-traversal-"));
    const snapshot = await createTemplatePackImportStorageSnapshot(storageRoot);
    const libraryRoot = path.join(storageRoot, "library");
    const outsidePath = path.join(libraryRoot, "outside.png");
    await fs.mkdir(path.join(libraryRoot, "backgrounds"), { recursive: true });
    await fs.writeFile(outsidePath, "keep");
    await fs.writeFile(
      path.join(libraryRoot, "backgrounds.json"),
      JSON.stringify([{ id: "../outside", displayName: "poisoned.png", extension: "png" }]),
      "utf8"
    );

    await restoreTemplatePackImportStorageSnapshot(storageRoot, snapshot);

    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("keep");
  });

  it("ignores poisoned font index entries instead of reading outside the font library", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-font-index-traversal-"));
    const libraryRoot = path.join(storageRoot, "library");
    const outsidePath = path.join(libraryRoot, "outside.ttf");
    await fs.mkdir(path.join(libraryRoot, "fonts"), { recursive: true });
    await fs.writeFile(outsidePath, "keep");
    await fs.writeFile(
      path.join(libraryRoot, "fonts.json"),
      JSON.stringify([{ id: "../outside", displayName: "poisoned.ttf", extension: "ttf" }]),
      "utf8"
    );

    await expect(findLibraryFont(storageRoot, "../outside")).resolves.toBeUndefined();
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("keep");
  });

  it("removes unindexed template-pack asset files during rollback", async () => {
    const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-template-rollback-"));
    const snapshot = await createTemplatePackImportStorageSnapshot(storageRoot);

    await fs.mkdir(path.join(storageRoot, "library", "backgrounds"), { recursive: true });
    await fs.mkdir(path.join(storageRoot, "library", "images"), { recursive: true });
    await fs.writeFile(path.join(storageRoot, "library", "backgrounds", "bg-orphan.png"), "orphan");
    await fs.writeFile(path.join(storageRoot, "library", "images", "img-orphan.png"), "orphan");

    await restoreTemplatePackImportStorageSnapshot(storageRoot, snapshot);

    await expect(fs.access(path.join(storageRoot, "library", "backgrounds", "bg-orphan.png"))).rejects.toThrow();
    await expect(fs.access(path.join(storageRoot, "library", "images", "img-orphan.png"))).rejects.toThrow();
  });
});
