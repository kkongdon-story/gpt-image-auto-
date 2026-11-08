import { describe, expect, it } from "vitest";
import {
  defaultCardSceneSettings,
  isBodyNumberVisible,
  normalizeBackgroundMediaSelection,
  normalizeBodyNumberDefault,
  normalizeBodyNumberMode,
  normalizeCardBackgroundMediaSelection,
  normalizeCardSceneSettings,
  normalizeDeckBackgroundMediaSelection,
  normalizeSemanticItemPlacement,
  normalizeSemanticSlotPlacement,
  normalizeVideoProjectMode,
  normalizeVideoLayer
} from "./media.js";

describe("M22 media contract normalization", () => {
  it("keeps legacy background IDs compatible with the new selection model", () => {
    expect(normalizeDeckBackgroundMediaSelection(undefined, " legacy-bg ")).toEqual({
      mode: "asset",
      mediaId: "legacy-bg"
    });
    expect(normalizeDeckBackgroundMediaSelection(undefined)).toEqual({ mode: "none" });
    expect(normalizeCardBackgroundMediaSelection(undefined)).toEqual({ mode: "inherit" });
    expect(normalizeCardBackgroundMediaSelection(undefined, null)).toEqual({ mode: "none" });
    expect(normalizeCardBackgroundMediaSelection(undefined, " local-bg ")).toEqual({
      mode: "asset",
      mediaId: "local-bg"
    });
  });

  it("rejects malformed asset selections without crashing", () => {
    expect(normalizeBackgroundMediaSelection({ mode: "asset", mediaId: "   " })).toEqual({ mode: "inherit" });
    expect(normalizeBackgroundMediaSelection({ mode: "none", mediaId: "ignored" })).toEqual({ mode: "none" });
    expect(normalizeBackgroundMediaSelection({ mode: "unknown" })).toEqual({ mode: "inherit" });
  });

  it("normalizes scene settings with bounded duration, transition, and audio source", () => {
    expect(
      normalizeCardSceneSettings({
        durationMs: 120000,
        transition: "fade",
        transitionMs: 5000,
        primaryAudioSourceId: " bg:card-1 "
      })
    ).toEqual({
      durationMs: 120000,
      durationMode: "fixed",
      transition: "fade",
      transitionMs: 2000,
      primaryAudioSourceId: "bg:card-1"
    });

    expect(normalizeCardSceneSettings({ transition: "none", transitionMs: 300 })).toEqual(defaultCardSceneSettings);
    expect(normalizeCardSceneSettings({ durationMs: 1 })).toMatchObject({ durationMs: 500 });
    expect(normalizeCardSceneSettings({ durationMs: 999999 })).toMatchObject({ durationMs: 180000 });
  });

  it("migrates legacy projects to video mode only when video is actually assigned", () => {
    const videoAsset = {
      id: "video-a",
      kind: "video" as const,
      displayName: "clip.mp4",
      relativePath: "video-a/clip.mp4",
      mimeType: "video/mp4",
      bytes: 100,
      sha256: "a".repeat(64),
      width: 1080,
      height: 1920
    };
    expect(normalizeVideoProjectMode(undefined)).toBe("cards");
    expect(
      normalizeVideoProjectMode(undefined, {
        mediaAssets: [videoAsset],
        backgroundMedia: { mode: "asset", mediaId: videoAsset.id }
      })
    ).toBe("video");
    expect(
      normalizeVideoProjectMode(undefined, {
        mediaAssets: [videoAsset],
        overrides: {
          "2": {
            layers: [
              {
                id: "video-layer",
                kind: "video",
                mediaId: videoAsset.id,
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                objectFit: "cover",
                clipStartMs: 0,
                clipEndMs: null,
                volume: 1
              }
            ]
          }
        }
      })
    ).toBe("video");
    expect(normalizeVideoProjectMode("cards", { mediaAssets: [videoAsset] })).toBe("cards");
  });

  it("normalizes video layers into finite card geometry and clip bounds", () => {
    const normalized = normalizeVideoLayer(
      {
        id: " video-1 ",
        kind: "video",
        mediaId: " asset-video ",
        x: -10,
        y: 120,
        width: 0,
        height: 250,
        zIndex: 2.8,
        opacity: 2,
        objectFit: "contain",
        clipStartMs: 900,
        clipEndMs: 700,
        volume: 3
      },
      1000
    );

    expect(normalized).toEqual({
      id: "video-1",
      kind: "video",
      mediaId: "asset-video",
      x: 0,
      y: 100,
      width: 1,
      height: 100,
      zIndex: 2,
      opacity: 1,
      objectFit: "contain",
      clipStartMs: 900,
      clipEndMs: 901,
      volume: 1
    });
  });

  it("defaults semantic slots to flow and clamps card placement", () => {
    expect(normalizeSemanticSlotPlacement(undefined)).toEqual({
      mode: "flow",
      x: 0,
      y: 0,
      anchor: "top-left"
    });

    expect(
      normalizeSemanticSlotPlacement({
        mode: "card",
        x: 120,
        y: -10,
        width: 0,
        height: 150,
        anchor: "top-right"
      })
    ).toEqual({
      mode: "card",
      x: 100,
      y: 0,
      width: 1,
      height: 100,
      anchor: "top-right"
    });
  });

  it("normalizes M23 semantic item placements with required box dimensions", () => {
    expect(normalizeSemanticItemPlacement(undefined)).toEqual({
      mode: "flow",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      anchor: "top-left"
    });

    expect(
      normalizeSemanticItemPlacement({
        mode: "card",
        x: -20,
        y: 200,
        width: 0,
        height: 101,
        anchor: "top-center"
      })
    ).toEqual({
      mode: "card",
      x: 0,
      y: 100,
      width: 1,
      height: 100,
      anchor: "top-center"
    });
  });

  it("resolves body number visibility from global and card policy", () => {
    expect(normalizeBodyNumberDefault("bad")).toBe("show");
    expect(normalizeBodyNumberMode("bad")).toBe("inherit");
    expect(isBodyNumberVisible("show", "inherit")).toBe(true);
    expect(isBodyNumberVisible("hide", "inherit")).toBe(false);
    expect(isBodyNumberVisible("show", "show")).toBe(true);
    expect(isBodyNumberVisible("show", "hide")).toBe(false);
    expect(isBodyNumberVisible("hide", "show")).toBe(true);
    expect(isBodyNumberVisible("hide", "hide")).toBe(false);
  });
});
