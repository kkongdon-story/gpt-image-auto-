import { describe, expect, it } from "vitest";
import { stripProDeck, stripProDeckDraft, stripProDeckPreset, stripProWorkspaceState } from "./editionFilter.js";
import type { CardOverrideMap, Deck, DeckDraft, DeckPreset, WorkspaceState } from "./types.js";

const overrides: CardOverrideMap = {
  "1": {
    backgroundId: "bg-clean-1",
    badge: { imageId: "img-eye", imageHeight: 72, textColor: "#ffd23c" },
    typography: { sizeScale: 1.12, weight: 800, italic: true, scope: "title" },
    layers: [
      { id: "shape-1", kind: "shape", x: 2, y: 2, width: 18, height: 6, shape: "rect", fill: "#ffd23c" },
      { id: "line-1", kind: "line", x1: 80, y1: 80, x2: 96, y2: 92, thickness: 3, color: "#ffffff" },
      { id: "image-1", kind: "image", x: 70, y: 8, width: 15, height: 12, backgroundId: "img-eye" },
      {
        id: "video-1",
        kind: "video",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        mediaId: "video-a",
        objectFit: "cover",
        clipStartMs: 0,
        clipEndMs: null,
        volume: 0.5
      }
    ]
  }
};

const chrome = {
  header: { visible: true, color: "#111111", fontSize: 24, fontWeight: 800, offsetX: 2, offsetY: 3, useDeckFont: true },
  footer: { visible: true, color: "#222222", fontSize: 20, fontWeight: 700, offsetX: 0, offsetY: -2, useDeckFont: true },
  pageNumber: {
    visible: true,
    color: "#333333",
    fontSize: 22,
    fontWeight: 700,
    offsetX: -1,
    offsetY: 1,
    useDeckFont: true,
    template: "{n} / {total}"
  }
};

const nextHint = { kind: "image" as const, imageId: "img-next", height: 42 };
const mediaAssets = [
  {
    id: "video-a",
    kind: "video" as const,
    displayName: "clip.mp4",
    relativePath: "video-a/clip.mp4",
    mimeType: "video/mp4",
    bytes: 123,
    sha256: "a".repeat(64),
    width: 1080,
    height: 1920,
    durationMs: 3000,
    hasAudio: true
  }
];
const sceneDefaults = {
  durationMs: 3000,
  transition: "fade" as const,
  transitionMs: 300,
  primaryAudioSourceId: null
};

describe("editionFilter", () => {
  it("preserves Lite manual design fields across stripped shapes", () => {
    const draft: DeckDraft = {
      headerLabel: "MONEY NOTE",
      footerAccount: "kkongdon_story",
      cards: [{ index: 1, rawText: "유형: 표지\n제목: 테스트" }],
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    };

    expect(stripProDeckDraft(draft)).toMatchObject({
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    });

    const deck: Deck = {
      id: "current",
      headerLabel: draft.headerLabel,
      footerAccount: draft.footerAccount,
      cards: [{ index: 1, type: "cover", title: "테스트", paragraphs: [], bullets: [] }],
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    };
    expect(stripProDeck(deck)).toMatchObject({
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    });

    const workspace: WorkspaceState = {
      headerLabel: draft.headerLabel,
      footerAccount: draft.footerAccount,
      styleId: "minimal",
      cards: ["유형: 표지\n제목: 테스트"],
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    };
    expect(stripProWorkspaceState(workspace)).toMatchObject({
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    });

    const preset: DeckPreset = {
      name: "Manual Design",
      headerLabel: draft.headerLabel,
      footerAccount: draft.footerAccount,
      styleId: "minimal",
      cards: ["유형: 표지\n제목: 테스트"],
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    };
    expect(stripProDeckPreset(preset)).toMatchObject({
      chrome,
      nextHint,
      backgroundMedia: { mode: "asset", mediaId: "video-a" },
      mediaAssets,
      videoProjectMode: "video",
      sceneDefaults,
      bodyNumberDefault: "hide",
      overrides
    });
  });
});
