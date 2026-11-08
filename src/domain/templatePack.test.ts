import { describe, expect, it } from "vitest";
import {
  maxTemplatePackArchiveEntries,
  maxTemplatePackCards,
  maxTemplatePackJsonBytes,
  maxTemplatePackTotalUncompressedBytes,
  normalizeTemplatePackAssetPath,
  parseTemplatePackManifest,
  templatePackSchema,
  validateTemplatePackArchiveEntries
} from "./templatePack.js";
import type { CardnewsResult, CardnewsError } from "./types.js";
import type { NormalizedTemplatePackManifest } from "./templatePack.js";

function expectError(input: unknown): asserts input is { readonly ok: false; readonly message: string } {
  expect(input).toMatchObject({ ok: false });
}

function isCardnewsError(input: unknown): input is CardnewsError {
  return typeof input === "object" && input !== null && "ok" in input && input.ok === false;
}

function expectManifest(input: CardnewsResult<NormalizedTemplatePackManifest>): NormalizedTemplatePackManifest {
  if (isCardnewsError(input)) {
    throw new Error(input.message);
  }
  return input;
}

describe("templatePack", () => {
  const availableAssets = new Set([
    "backgrounds/card-01-clean.png",
    "backgrounds/card-02-clean.png",
    "backgrounds/card-03-clean.png",
    "assets/eye-mark.png"
  ]);

  it("accepts a valid one-card template pack manifest", () => {
    const parsed = parseTemplatePackManifest(
      {
        schema: templatePackSchema,
        name: "One Card",
        style: {
          name: "Black Yellow",
          pageBackground: "#111111",
          ink: "#ffffff",
          accentDefault: "#ffd23c"
        },
        chrome: { header: "MONEY NOTE", footer: "kkongdon_story", pageFormat: "{n} / {total}" },
        cards: [
          {
            type: "cover",
            backgroundImage: "backgrounds/card-01-clean.png",
            badge: "looking for",
            title: "모집 타이틀",
            subtitle: "함께 성장할 사람을 찾습니다.",
            layers: [{ kind: "image", image: "assets/eye-mark.png", x: 70, y: 8, width: 16, height: 12 }]
          }
        ]
      },
      { availableAssetPaths: availableAssets }
    );

    const manifest = expectManifest(parsed);
    expect(manifest.cards).toHaveLength(1);
    expect(manifest.cards[0]?.backgroundImage).toBe("backgrounds/card-01-clean.png");
    expect(manifest.referencedAssetPaths).toEqual(["backgrounds/card-01-clean.png", "assets/eye-mark.png"]);
  });

  it("accepts valid multi-card packs and maps closing cards to cta", () => {
    const parsed = parseTemplatePackManifest(
      JSON.stringify({
        schema: templatePackSchema,
        name: "Three Cards",
        cards: [
          { type: "cover", backgroundImage: "backgrounds/card-01-clean.png", title: "표지" },
          { type: "body", backgroundImage: "backgrounds/card-02-clean.png", title: "본문", body: ["문장 1"] },
          { type: "closing", backgroundImage: "backgrounds/card-03-clean.png", title: "마무리" }
        ]
      }),
      { availableAssetPaths: availableAssets }
    );

    const manifest = expectManifest(parsed);
    expect(manifest.cards.map((card) => card.type)).toEqual(["cover", "body", "cta"]);
  });

  it("rejects unsafe asset paths", () => {
    for (const candidate of [
      "../outside.png",
      "/absolute/path.png",
      "C:\\temp\\outside.png",
      "backgrounds/../../x.png",
      "assets/script.exe"
    ]) {
      expect(normalizeTemplatePackAssetPath(candidate)).toBeUndefined();
    }

    const parsed = parseTemplatePackManifest(
      {
        schema: templatePackSchema,
        name: "Missing Asset",
        cards: [{ type: "cover", backgroundImage: "backgrounds/missing.png", title: "표지" }]
      },
      { availableAssetPaths: availableAssets }
    );
    expectError(parsed);
    expect(parsed.message).toContain("템플릿팩에 없는 이미지");
  });

  it("validates archive entry bounds before import work starts", () => {
    expectError(validateTemplatePackArchiveEntries([]));

    const tooMany = Array.from({ length: maxTemplatePackArchiveEntries + 1 }, (_, index) => ({
      path: index === 0 ? "template.json" : `assets/${index}.png`,
      uncompressedSize: 1
    }));
    expectError(validateTemplatePackArchiveEntries(tooMany));

    expectError(
      validateTemplatePackArchiveEntries([
        { path: "template.json", uncompressedSize: maxTemplatePackJsonBytes + 1 }
      ])
    );

    expectError(
      validateTemplatePackArchiveEntries([
        { path: "template.json", uncompressedSize: 1 },
        { path: "assets/a.png", uncompressedSize: maxTemplatePackTotalUncompressedBytes }
      ])
    );

    expectError(
      validateTemplatePackArchiveEntries([
        { path: "template.json", uncompressedSize: 1 },
        { path: "assets/a.png", uncompressedSize: 1 },
        { path: "ASSETS/a.png", uncompressedSize: 1 }
      ])
    );
  });

  it("rejects manifests above the card limit", () => {
    const parsed = parseTemplatePackManifest({
      schema: templatePackSchema,
      name: "Too Many Cards",
      cards: Array.from({ length: maxTemplatePackCards + 1 }, (_, index) => ({
        title: `카드 ${index + 1}`
      }))
    });

    expectError(parsed);
    expect(parsed.message).toContain(`${maxTemplatePackCards}장 이하`);
  });
});
