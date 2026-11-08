import { describe, expect, it, vi } from "vitest";
import type { VideoExportPlan } from "../src/domain/videoExport.js";
import { compositeTransitionRgba, createWorkspaceFrameProducer } from "./videoFrameProducer.js";
import type { FrameCaptureAdapter, FrameCaptureLoadInput } from "./videoFrameProducer.js";

const plan: VideoExportPlan = {
  outputPath: "C:\\exports\\out.mp4",
  partialPath: "C:\\exports\\out.partial.mp4",
  width: 1080,
  height: 1920,
  fps: 30,
  overwrite: true
};

describe("createWorkspaceFrameProducer", () => {
  it("streams real card captures in scene order with deterministic timestamps", async () => {
    const adapter = new FakeCaptureAdapter();
    const producer = createWorkspaceFrameProducer({
      captureAdapter: adapter,
      storageRoot: "C:\\userData\\gpt-cardnews-auto",
      totalFrames: 32,
      workspace: workspaceFixture()
    });

    const frames = [];
    for await (const frame of producer(plan)) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(32);
    expect(frames.map((frame) => frame.index).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(frames.every((frame) => frame.data.byteLength === plan.width * plan.height * 4)).toBe(true);
    expect(frames.every((frame) => frame.data.some((byte) => byte !== 0))).toBe(true);
    expect(adapter.loads.map((load) => load.cardIndex)).toEqual([1, 2]);
    expect(adapter.loads[0]?.html).toContain("첫 카드");
    expect(adapter.loads[1]?.html).toContain("둘째 카드");
    expect(adapter.loads[0]?.html).toContain("cardnews-video-export-surface");
    expect(adapter.seeks[0]).toBe(0);
    expect(adapter.seeks[29]).toBeCloseTo(966.6666666667, 8);
    expect(adapter.seeks[30]).toBe(0);
    expect(adapter.ownerships[0]).toMatchObject({ cardIndex: 1, activeMediaIds: [] });
    expect(adapter.ownerships[30]).toMatchObject({ cardIndex: 2, activeMediaIds: [] });
    expect(adapter.close).toHaveBeenCalledTimes(1);
  });

  it("injects media video URLs and waits through the capture adapter", async () => {
    const adapter = new FakeCaptureAdapter();
    const producer = createWorkspaceFrameProducer({
      captureAdapter: adapter,
      storageRoot: "C:\\userData\\gpt-cardnews-auto",
      totalFrames: 1,
      workspace: workspaceFixture({
        mediaAssets: [
          {
            bytes: 10,
            displayName: "clip.mp4",
            durationMs: 2000,
            hasAudio: false,
            height: 1920,
            id: "video-aaaaaaaaaaaaaaaaaaaa-12345678",
            importedAt: "2026-07-16T00:00:00.000Z",
            kind: "video",
            mimeType: "video/mp4",
            posterRelativePath: "video-aaaaaaaaaaaaaaaaaaaa-12345678/poster.png",
            relativePath: "video-aaaaaaaaaaaaaaaaaaaa-12345678/clip.mp4",
            sha256: "a".repeat(64),
            width: 1080
          }
        ],
        overrides: {
          "1": {
            layers: [
              {
                clipEndMs: 1000,
                clipStartMs: 250,
                height: 100,
                id: "video-layer-1",
                kind: "video",
                mediaId: "video-aaaaaaaaaaaaaaaaaaaa-12345678",
                objectFit: "cover",
                volume: 0,
                width: 100,
                x: 0,
                y: 0
              }
            ]
          }
        }
      })
    });

    const [frame] = await collect(producer(plan));

    expect(frame?.data.some((byte) => byte !== 0)).toBe(true);
    expect(adapter.loads[0]?.html).toContain("data-media-id=\"video-aaaaaaaaaaaaaaaaaaaa-12345678\"");
    expect(adapter.loads[0]?.ownership).toMatchObject({
      cardIndex: 1,
      activeMediaIds: ["video-aaaaaaaaaaaaaaaaaaaa-12345678"],
      activeVideoLayerIds: ["video-layer-1"]
    });
    expect(adapter.loads[0]?.html).toContain("clip.mp4");
    expect(adapter.loads[0]?.html).toContain("data-clip-start-ms=\"250\"");
    expect(adapter.loads[0]?.html).not.toContain("% spanMs");
    expect(adapter.seeks).toEqual([0]);
  });

  it("uses the persisted custom and deleted body-number state in video frames", async () => {
    const customAdapter = new FakeCaptureAdapter();
    const customProducer = createWorkspaceFrameProducer({
      captureAdapter: customAdapter,
      storageRoot: "C:\\userData\\gpt-cardnews-auto",
      totalFrames: 32,
      workspace: workspaceFixture({
        overrides: {
          "2": {
            bodyNumberMode: "show",
            bodyNumberText: "A"
          }
        }
      })
    });

    await collect(customProducer(plan));

    expect(customAdapter.loads[1]?.html).toMatch(
      /data-slot="body-number"[^>]*>A<\/div>/
    );

    const deletedAdapter = new FakeCaptureAdapter();
    const deletedProducer = createWorkspaceFrameProducer({
      captureAdapter: deletedAdapter,
      storageRoot: "C:\\userData\\gpt-cardnews-auto",
      totalFrames: 32,
      workspace: workspaceFixture({
        overrides: {
          "2": {
            bodyNumberMode: "hide",
            bodyNumberText: "A"
          }
        }
      })
    });

    await collect(deletedProducer(plan));

    expect(deletedAdapter.loads[1]?.html).not.toContain('data-slot="body-number"');
  });

  it("closes the adapter and stops without capturing after cancellation", async () => {
    const controller = new AbortController();
    const adapter = new FakeCaptureAdapter({
      onCapture: () => controller.abort()
    });
    const producer = createWorkspaceFrameProducer({
      captureAdapter: adapter,
      signal: controller.signal,
      storageRoot: "C:\\userData\\gpt-cardnews-auto",
      totalFrames: 3,
      workspace: workspaceFixture()
    });

    const iterator = producer(plan)[Symbol.asyncIterator]();
    const first = await iterator.next();
    await expect(iterator.next()).rejects.toThrow("cancelled");

    expect(first.done).toBe(false);
    expect(first.value.index).toBe(1);
    expect(adapter.captures).toBe(1);
    expect(adapter.close).toHaveBeenCalledTimes(1);
  });

  it("uses independent adapters during transition overlap and composites the two cards", async () => {
    const adapters: FakeCaptureAdapter[] = [];
    const producer = createWorkspaceFrameProducer({
      createCaptureAdapter: () => {
        const adapter = new FakeCaptureAdapter();
        adapters.push(adapter);
        return adapter;
      },
      storageRoot: "C:\\userData\\gpt-cardnews-auto",
      totalFrames: 20,
      workspace: workspaceFixture({
        sceneDefaults: {
          durationMs: 1000,
          primaryAudioSourceId: null,
          transition: "fade",
          transitionMs: 500
        }
      })
    });

    const frames = await collect(producer(plan));

    expect(adapters).toHaveLength(2);
    expect(adapters[0]?.loads.map((load) => load.cardIndex)).toContain(1);
    expect(adapters[1]?.loads.map((load) => load.cardIndex)).toEqual([2]);
    expect(frames[15]?.data[0]).toBe(1);
    expect(adapters.every((adapter) => adapter.close.mock.calls.length === 1)).toBe(true);
  });
});

describe("compositeTransitionRgba", () => {
  it("blends fade frames and slides independent scene surfaces", () => {
    const outgoing = solidFrame(2, 1, [200, 0, 0, 255]);
    const incoming = solidFrame(2, 1, [0, 0, 200, 255]);
    const fade = compositeTransitionRgba({
      outgoing,
      incoming,
      width: 2,
      height: 1,
      progress: 0.5,
      type: "fade"
    });
    expect([...fade.subarray(0, 4)]).toEqual([100, 0, 100, 255]);

    const slide = compositeTransitionRgba({
      outgoing,
      incoming,
      width: 2,
      height: 1,
      progress: 0.5,
      type: "slide-left"
    });
    expect([...slide.subarray(0, 4)]).toEqual([200, 0, 0, 255]);
    expect([...slide.subarray(4, 8)]).toEqual([0, 0, 200, 255]);
  });
});

class FakeCaptureAdapter implements FrameCaptureAdapter {
  readonly loads: FrameCaptureLoadInput[] = [];
  readonly seeks: number[] = [];
  readonly ownerships: unknown[] = [];
  readonly close = vi.fn(async () => undefined);
  captures = 0;

  constructor(private readonly options: { readonly onCapture?: () => void } = {}) {}

  async loadCard(input: FrameCaptureLoadInput): Promise<void> {
    this.loads.push(input);
  }

  async seek(timestampMs: number, ownership?: unknown): Promise<void> {
    this.seeks.push(timestampMs);
    this.ownerships.push(ownership);
  }

  async captureRgba(): Promise<Buffer> {
    this.captures += 1;
    this.options.onCapture?.();
    const frame = Buffer.allocUnsafe(plan.width * plan.height * 4);
    frame.fill(0);
    frame[0] = this.loads.at(-1)?.cardIndex ?? 1;
    frame[1] = this.captures;
    frame[3] = 255;
    return frame;
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

function solidFrame(width: number, height: number, rgba: readonly number[]): Buffer {
  const frame = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < frame.length; offset += 4) {
    frame[offset] = rgba[0] ?? 0;
    frame[offset + 1] = rgba[1] ?? 0;
    frame[offset + 2] = rgba[2] ?? 0;
    frame[offset + 3] = rgba[3] ?? 255;
  }
  return frame;
}

function workspaceFixture(overrides: Partial<Parameters<typeof createWorkspaceFrameProducer>[0]["workspace"]> = {}) {
  return {
    cards: [
      "유형: cover\n제목: 첫 카드\n본문: 본문 1",
      "유형: body\n제목: 둘째 카드\n본문: 본문 2"
    ],
    footerAccount: "@kkongdon",
    headerLabel: "MONEY NOTE",
    sceneDefaults: {
      durationMs: 1000,
      primaryAudioSourceId: null,
      transition: "none",
      transitionMs: 0
    },
    styleId: "workbook-ink",
    ...overrides
  };
}
