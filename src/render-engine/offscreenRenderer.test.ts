import type { NativeImage, WebContents } from "electron";
import { describe, expect, it } from "vitest";
import { PaintFrameCollector, type PaintFrameSource } from "./paintFrameCollector.js";
import { createRenderWindowOptions } from "./renderWindowConfig.js";
import {
  createPaintCollectorAndLoad,
  isBlankBitmap,
  waitForImageAssets
} from "./offscreenRenderer.js";

describe("deterministic offscreen render configuration", () => {
  it("uses content dimensions and one render pixel per CSS pixel", () => {
    const options = createRenderWindowOptions({ width: 1080, height: 1350 });

    expect(options).toMatchObject({
      width: 1080,
      height: 1350,
      show: false,
      useContentSize: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: { useSharedTexture: false, deviceScaleFactor: 1 }
      }
    });
  });

  it("subscribes before readiness and returns only an invalidated post-ready frame", async () => {
    const source = new FakePaintSource<string>((fake) => {
      fake.emit(fake.invalidateCount === 1 ? "queued-before-ready" : "post-ready");
    });
    const collector = new PaintFrameCollector(source);
    source.emit("placeholder");

    const frame = await collector.captureInvalidatedFrame(100);

    expect(frame).toEqual({ image: "post-ready", sequence: 3 });
    expect(source.invalidateCount).toBe(2);
    collector.dispose();
    expect(source.listenerCount).toBe(0);
  });

  it("times out instead of accepting an earlier placeholder frame", async () => {
    const source = new FakePaintSource<string>();
    const collector = new PaintFrameCollector(source);
    source.emit("placeholder");

    await expect(collector.captureInvalidatedFrame(10)).rejects.toThrow(
      "Timed out waiting for a post-readiness paint frame."
    );
    collector.dispose();
  });

  it("subscribes to production paint events before loading the render document", async () => {
    const events: string[] = [];
    let paintListener: ((...args: unknown[]) => void) | undefined;
    const webContents = {
      invalidate: () => events.push("invalidate"),
      on: (eventName: string, listener: (...args: unknown[]) => void) => {
        events.push(`subscribe:${eventName}`);
        paintListener = listener;
      },
      removeListener: (eventName: string, listener: (...args: unknown[]) => void) => {
        events.push(`unsubscribe:${eventName}`);
        if (paintListener === listener) {
          paintListener = undefined;
        }
      }
    } as unknown as WebContents;

    const collector = await createPaintCollectorAndLoad(webContents, async () => {
      events.push("load");
    });

    expect(events).toEqual(["subscribe:paint", "load"]);
    const image = { marker: "paint-frame" } as unknown as NativeImage;
    paintListener?.({}, {}, image);
    const framePromise = collector.captureInvalidatedFrame(100);
    paintListener?.({}, {}, image);
    paintListener?.({}, {}, image);
    await expect(framePromise).resolves.toMatchObject({ image });
    collector.dispose();
    expect(events.at(-1)).toBe("unsubscribe:paint");
  });

  it("rejects failed or timed-out image readiness before capture", async () => {
    await expect(
      waitForImageAssets({
        executeJavaScript: async () => ({ failedCount: 1, ready: false, timedOut: false })
      })
    ).rejects.toThrow("이미지 자산을 로드하지 못했습니다");

    await expect(
      waitForImageAssets({
        executeJavaScript: async () => ({ failedCount: 0, ready: false, timedOut: true })
      })
    ).rejects.toThrow("이미지 로딩 시간이 초과되었습니다");
  });

  it("samples BGRA pixels on aligned boundaries at the 1080x1350 target", () => {
    const bitmap = Buffer.alloc(1080 * 1350 * 4);
    for (let index = 0; index < bitmap.length; index += 4) {
      bitmap[index] = 17;
      bitmap[index + 1] = 34;
      bitmap[index + 2] = 51;
      bitmap[index + 3] = 255;
    }

    expect(isBlankBitmap(bitmap)).toBe(true);

    const lastPixel = bitmap.length - 4;
    bitmap[lastPixel] = 99;
    expect(isBlankBitmap(bitmap)).toBe(false);
  });

  it("treats fully transparent pixels as blank even when their RGB bytes differ", () => {
    const bitmap = Buffer.alloc(320 * 180 * 4);
    for (let index = 0; index < bitmap.length; index += 4) {
      bitmap[index] = (index / 4) % 251;
      bitmap[index + 1] = (index / 8) % 241;
      bitmap[index + 2] = (index / 16) % 239;
      bitmap[index + 3] = 0;
    }

    expect(isBlankBitmap(bitmap)).toBe(true);
  });
});

class FakePaintSource<T> implements PaintFrameSource<T> {
  private listener: ((image: T) => void) | undefined;
  readonly onInvalidate: ((source: FakePaintSource<T>) => void) | undefined;
  invalidateCount = 0;

  constructor(onInvalidate?: (source: FakePaintSource<T>) => void) {
    this.onInvalidate = onInvalidate;
  }

  get listenerCount(): number {
    return this.listener ? 1 : 0;
  }

  emit(image: T): void {
    this.listener?.(image);
  }

  invalidate(): void {
    this.invalidateCount += 1;
    this.onInvalidate?.(this);
  }

  subscribe(listener: (image: T) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = undefined;
      }
    };
  }
}
