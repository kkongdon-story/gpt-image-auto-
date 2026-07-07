import { describe, expect, it } from "vitest";
import type { DeckPreset, StylePresetRecord, WorkspaceState } from "../domain/types.js";
import { collectProjectReferences, validateProjectDescriptor } from "./projectArchive.js";

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
      fontIds: ["font-main", "font-preset"]
    });
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
});
