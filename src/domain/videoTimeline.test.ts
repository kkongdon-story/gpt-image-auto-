import { describe, expect, it } from "vitest";
import {
  compileVideoTimeline,
  findCompiledTransitionAt,
  getFrameOwnershipManifest,
  getFrameTimestampMs
} from "./videoTimeline.js";
import type { Card, Deck, MediaAssetRef } from "./types.js";

const audioVideo: MediaAssetRef = {
  id: "video-audio",
  kind: "video",
  displayName: "audio.mp4",
  relativePath: "media/video-audio/audio.mp4",
  mimeType: "video/mp4",
  bytes: 2000,
  sha256: "a".repeat(64),
  width: 1080,
  height: 1920,
  durationMs: 1000,
  hasAudio: true
};

const silentVideo: MediaAssetRef = {
  id: "video-silent",
  kind: "video",
  displayName: "silent.mp4",
  relativePath: "media/video-silent/silent.mp4",
  mimeType: "video/mp4",
  bytes: 2000,
  sha256: "b".repeat(64),
  width: 1080,
  height: 1920,
  durationMs: 6000,
  hasAudio: false
};

const imageAsset: MediaAssetRef = {
  id: "image",
  kind: "image",
  displayName: "image.png",
  relativePath: "media/image/image.png",
  mimeType: "image/png",
  bytes: 500,
  sha256: "c".repeat(64),
  width: 1080,
  height: 1920
};

const cards: readonly Card[] = [
  { index: 1, type: "cover", title: "Cover", paragraphs: [], bullets: [] },
  { index: 2, type: "body", title: "Body", paragraphs: ["Body"], bullets: [] },
  { index: 3, type: "cta", title: "CTA", paragraphs: [], bullets: [] }
];

describe("M22 video timeline compiler", () => {
  it("compiles deterministic scene timing with transition overlap exactly once", () => {
    const deck: Pick<Deck, "cards" | "mediaAssets" | "sceneDefaults" | "overrides"> = {
      cards,
      mediaAssets: [imageAsset],
      sceneDefaults: {
        durationMs: 2000,
        transition: "fade",
        transitionMs: 500,
        primaryAudioSourceId: null
      },
      overrides: {
        "3": {
          scene: {
            durationMs: 3000,
            transition: "none",
            transitionMs: 0,
            primaryAudioSourceId: null
          }
        }
      }
    };

    const timeline = compileVideoTimeline(deck);

    expect(timeline).toMatchObject({
      width: 1080,
      height: 1920,
      frameRate: 30,
      durationMs: 6000,
      frameCount: 180
    });
    expect(timeline.scenes.map((scene) => [scene.startMs, scene.endMs, scene.transitionMs])).toEqual([
      [0, 2000, 500],
      [1500, 3500, 500],
      [3000, 6000, 0]
    ]);
    expect(timeline.scenes.map((scene) => [scene.startFrame, scene.endFrameExclusive])).toEqual([
      [0, 60],
      [45, 105],
      [90, 180]
    ]);
    expect(timeline.digest).toContain("\"durationMs\":6000");
    expect(findCompiledTransitionAt(timeline, 1499)).toBeNull();
    expect(findCompiledTransitionAt(timeline, 1500)).toMatchObject({
      outgoing: { cardIndex: 1 },
      incoming: { cardIndex: 2 },
      progress: 0,
      type: "fade"
    });
    expect(findCompiledTransitionAt(timeline, 1750)?.progress).toBeCloseTo(0.5, 8);
  });

  it("keeps one primary audio source audible and mutes every other source", () => {
    const deck: Pick<Deck, "cards" | "backgroundMedia" | "mediaAssets" | "overrides"> = {
      cards: [cards[0]!],
      backgroundMedia: { mode: "asset", mediaId: "video-audio" },
      mediaAssets: [audioVideo, silentVideo],
      overrides: {
        "1": {
          scene: {
            durationMs: 3000,
            transition: "none",
            transitionMs: 0,
            primaryAudioSourceId: "layer:foreground"
          },
          layers: [
            {
              id: "foreground",
              kind: "video",
              mediaId: "video-audio",
              x: 10,
              y: 10,
              width: 80,
              height: 80,
              objectFit: "cover",
              clipStartMs: 0,
              clipEndMs: null,
              volume: 0.7
            },
            {
              id: "silent",
              kind: "video",
              mediaId: "video-silent",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              objectFit: "contain",
              clipStartMs: 0,
              clipEndMs: null,
              volume: 1
            }
          ]
        }
      }
    };

    const [scene] = compileVideoTimeline(deck).scenes;

    expect(scene?.primaryAudioSourceId).toBe("layer:foreground");
    expect(scene?.sources.map((source) => [source.sourceId, source.hasAudio, source.muted])).toEqual([
      ["background:1", true, true],
      ["layer:foreground", true, false],
      ["layer:silent", false, true]
    ]);
    expect(scene?.sources.find((source) => source.sourceId === "background:1")?.playback).toBe("final-frame-hold");
  });

  it("falls back to silent scene audio when primary source is deleted or has no audio", () => {
    const deck: Pick<Deck, "cards" | "mediaAssets" | "overrides"> = {
      cards: [cards[0]!],
      mediaAssets: [silentVideo],
      overrides: {
        "1": {
          scene: {
            durationMs: 3000,
            transition: "none",
            transitionMs: 0,
            primaryAudioSourceId: "layer:silent"
          },
          layers: [
            {
              id: "silent",
              kind: "video",
              mediaId: "video-silent",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              objectFit: "cover",
              clipStartMs: 0,
              clipEndMs: null,
              volume: 1
            },
            {
              id: "missing",
              kind: "video",
              mediaId: "missing",
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
    };

    const timeline = compileVideoTimeline(deck);

    expect(timeline.scenes[0]?.primaryAudioSourceId).toBeNull();
    expect(timeline.scenes[0]?.sources.every((source) => source.muted)).toBe(true);
    expect(timeline.warnings).toEqual([
      "Missing video layer media asset on card 1: missing",
      "Primary audio source is unavailable on card 1: layer:silent"
    ]);
  });

  it("uses rational frame timestamps without cumulative floating drift", () => {
    expect(getFrameTimestampMs(0)).toBe(0);
    expect(getFrameTimestampMs(1)).toBeCloseTo(1000 / 30, 10);
    expect(getFrameTimestampMs(179)).toBeCloseTo(5966.666666666667, 10);
    expect(() => getFrameTimestampMs(-1)).toThrow(RangeError);
  });

  it("compiles fit-primary-video duration, ownership manifests, and final-frame hold policy", () => {
    const deck: Pick<Deck, "cards" | "backgroundMedia" | "mediaAssets" | "overrides"> = {
      cards: [cards[0]!, cards[1]!],
      backgroundMedia: { mode: "asset", mediaId: "video-audio" },
      mediaAssets: [audioVideo, silentVideo],
      overrides: {
        "1": {
          scene: {
            durationMs: 3000,
            durationMode: "fit-primary-video",
            transition: "none",
            transitionMs: 0,
            primaryAudioSourceId: null
          } as never
        },
        "2": {
          scene: {
            durationMs: 3000,
            transition: "none",
            transitionMs: 0,
            primaryAudioSourceId: null
          },
          backgroundMedia: { mode: "none" },
          layers: [
            {
              id: "foreground",
              kind: "video",
              mediaId: "video-silent",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              objectFit: "cover",
              clipStartMs: 1000,
              clipEndMs: 2500,
              volume: 1
            }
          ]
        }
      }
    };

    const timeline = compileVideoTimeline(deck);

    expect(timeline.durationMs).toBe(4000);
    expect(timeline.scenes[0]).toMatchObject({
      durationMode: "fit-primary-video",
      durationMs: 1000,
      startFrame: 0,
      endFrameExclusive: 30
    });
    expect(timeline.scenes[1]?.sources[0]).toMatchObject({
      mediaId: "video-silent",
      playback: "final-frame-hold",
      clipStartMs: 1000,
      clipEndMs: 2500
    });
    expect(getFrameOwnershipManifest(timeline, 0)).toEqual({
      cardIndex: 1,
      sceneId: "scene:1",
      localTimeMs: 0,
      activeMediaIds: ["video-audio"],
      activeVideoLayerIds: []
    });
    expect(getFrameOwnershipManifest(timeline, 30)).toMatchObject({
      cardIndex: 2,
      localTimeMs: 0,
      activeMediaIds: ["video-silent"],
      activeVideoLayerIds: ["foreground"]
    });
  });

  it("rejects timelines over the 600 second export cap", () => {
    const manyCards = Array.from({ length: 201 }, (_value, index): Card => ({
      index: index + 1,
      type: "body",
      title: `Card ${index + 1}`,
      paragraphs: [],
      bullets: []
    }));

    expect(() =>
      compileVideoTimeline({
        cards: manyCards,
        sceneDefaults: {
          durationMs: 3000,
          transition: "none",
          transitionMs: 0,
          primaryAudioSourceId: null
        }
      })
    ).toThrow("600000ms");
  });
});
