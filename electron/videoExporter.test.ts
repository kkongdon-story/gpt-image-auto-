import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FfmpegManifest } from "./ffmpegPreflight.js";
import { buildFfmpegExportArgs, exportVideoMp4 } from "./videoExporter.js";
import type { SpawnedFfmpeg, VideoExporterDependencies, VideoFrame } from "./videoExporter.js";

describe("buildFfmpegExportArgs", () => {
  it("builds a safe argv array for h264_mf/AAC without shell strings", () => {
    const args = buildFfmpegExportArgs(
      {
        outputPath: "C:\\exports\\out.mp4",
        partialPath: "C:\\exports\\out.partial.mp4",
        width: 1080,
        height: 1920,
        fps: 30,
        overwrite: true
      },
      {
        outputPath: "C:\\exports\\out.mp4",
        outputRoot: "C:\\exports",
        totalFrames: 30,
        totalDurationMs: 3000,
        audioSegments: [
          {
            path: "C:\\media\\voice.wav",
            sceneStartMs: 0,
            clipStartMs: 0,
            durationMs: 3000,
            volume: 1
          }
        ]
      }
    );

    expect(args).toContain("h264_mf");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args).toEqual(expect.arrayContaining([
      "-rate_control",
      "pc_vbr",
      "-b:v",
      "10M",
      "-maxrate",
      "14M",
      "-bufsize",
      "20M",
      "-quality",
      "85",
      "-scenario",
      "archive",
      "-g",
      "60"
    ]));
    expect(args).not.toContain("-shortest");
    expect(args.join(" ")).not.toContain("libx264");
    expect(args).not.toContain("--enable-gpl");
    expect(args).not.toContain("--enable-nonfree");
  });

  it("delays card-2 primary audio to the compiled scene start without truncating video", () => {
    const args = buildFfmpegExportArgs(plan(), {
      outputPath: "C:\\exports\\out.mp4",
      outputRoot: "C:\\exports",
      totalFrames: 120,
      totalDurationMs: 4000,
      audioSegments: [
        {
          path: "C:\\media\\card-2.mp4",
          sceneStartMs: 2000,
          clipStartMs: 0,
          durationMs: 2000,
          volume: 0.8
        }
      ]
    });

    expect(args).toContain("C:\\media\\card-2.mp4");
    expect(args).not.toContain("-shortest");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("4");
    expect(filterComplex(args)).toContain("adelay=2000:all=1");
    expect(filterComplex(args)).toContain("volume=0.8");
    expect(filterComplex(args)).toContain("atrim=duration=4");
  });

  it("keeps short primary audio as a short segment and pads the full compiled duration", () => {
    const args = buildFfmpegExportArgs(plan(), {
      outputPath: "C:\\exports\\out.mp4",
      outputRoot: "C:\\exports",
      totalFrames: 90,
      totalDurationMs: 3000,
      audioSegments: [
        {
          path: "C:\\media\\short.mp4",
          sceneStartMs: 0,
          clipStartMs: 0,
          durationMs: 750,
          volume: 1
        }
      ]
    });

    expect(filterComplex(args)).toContain("atrim=start=0:duration=0.75");
    expect(filterComplex(args)).toContain("apad,atrim=duration=3");
    expect(args).not.toContain("-shortest");
  });

  it("mixes multiple scene primary audio segments with scene delays and clip in-points", () => {
    const args = buildFfmpegExportArgs(plan(), {
      outputPath: "C:\\exports\\out.mp4",
      outputRoot: "C:\\exports",
      totalFrames: 180,
      totalDurationMs: 6000,
      audioSegments: [
        {
          path: "C:\\media\\card-1.mp4",
          sceneStartMs: 0,
          clipStartMs: 250,
          durationMs: 1750,
          volume: 1
        },
        {
          path: "C:\\media\\card-3.mp4",
          sceneStartMs: 3500,
          clipStartMs: 1000,
          durationMs: 1500,
          volume: 0.35
        }
      ]
    });

    expect(args).toContain("C:\\media\\card-1.mp4");
    expect(args).toContain("C:\\media\\card-3.mp4");
    expect(filterComplex(args)).toContain("[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[mixed]");
    expect(filterComplex(args)).toContain("atrim=start=0.25:duration=1.75");
    expect(filterComplex(args)).toContain("atrim=start=1:duration=1.5");
    expect(filterComplex(args)).toContain("adelay=3500:all=1");
    expect(filterComplex(args)).toContain("volume=0.35");
    expect(filterComplex(args)).toContain("apad,atrim=duration=6");
  });

  it("uses compiled duration for audio trim and omits AAC output when there are no valid primary segments", () => {
    const args = buildFfmpegExportArgs(plan(), {
      outputPath: "C:\\exports\\out.mp4",
      outputRoot: "C:\\exports",
      totalFrames: 75,
      totalDurationMs: 2500,
      audioSegments: [
        {
          path: "",
          sceneStartMs: 0,
          clipStartMs: 0,
          durationMs: 2500,
          volume: 1
        }
      ]
    });

    expect(args).toContain("-an");
    expect(args).not.toContain("-filter_complex");
    expect(args).not.toContain("-c:a");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("2.5");
  });
});

describe("exportVideoMp4", () => {
  it("preflights, streams frames, reports monotonic progress, finalizes atomically, and uses spawn argv", async () => {
    const progresses: number[] = [];
    const stages: string[] = [];
    const child = new FakeChild();
    const spawn = vi.fn((_filePath: string, _args: readonly string[]) => child);
    const fsApi = fakeFs(false);
    const resultPromise = exportVideoMp4(
      {
        outputRoot: "C:\\exports",
        outputPath: "C:\\exports\\카드 뉴스.mp4",
        totalFrames: 3,
        onProgress: (progress) => {
          progresses.push(progress.percent);
          stages.push(progress.stage);
        }
      },
      deps({
        spawn,
        fsApi,
        frameProducer: async function* (): AsyncIterable<VideoFrame> {
          yield { index: 1, data: Buffer.from("a") };
          yield { index: 2, data: Buffer.from("b") };
          yield { index: 3, data: Buffer.from("c") };
          setTimeout(() => child.emit("exit", 0), 0);
        }
      })
    );

    const result = await resultPromise;

    expect(result).toMatchObject({ ok: true, framesWritten: 3 });
    expect(spawn).toHaveBeenCalledWith("C:\\app\\resources\\ffmpeg\\ffmpeg.exe", expect.any(Array));
    expect(spawn.mock.calls[0]?.[1]).toContain("h264_mf");
    expect(child.writes.map((write) => write.toString())).toEqual(["a", "b", "c"]);
    expect(fsApi.rename).toHaveBeenCalledWith(
      "C:\\exports\\카드 뉴스.partial.mp4",
      "C:\\exports\\카드 뉴스.mp4"
    );
    expect(progresses).toEqual([...progresses].sort((a, b) => a - b));
    expect(progresses.at(-1)).toBe(100);
    expect(stages).toEqual(expect.arrayContaining([
      "compile",
      "preflight",
      "producer_init",
      "render",
      "encode",
      "finalize"
    ]));
  });

  it("fails a stalled preflight within the configured watchdog and never spawns FFmpeg", async () => {
    const spawn = vi.fn(() => new FakeChild());
    const result = await exportVideoMp4(
      {
        outputRoot: "C:\\exports",
        outputPath: "C:\\exports\\out.mp4",
        totalFrames: 1
      },
      deps({
        spawn,
        preflight: () => new Promise(() => undefined),
        watchdog: { preflightMs: 15, heartbeatMs: 5 }
      })
    );

    expect(result).toMatchObject({ ok: false, code: "stage_timeout" });
    expect(result.ok === false ? result.message : "").toContain("인코더 점검");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("terminates FFmpeg and removes the partial output when frame production stalls", async () => {
    const child = new FakeChild();
    const fsApi = fakeFs(false);
    const result = await exportVideoMp4(
      {
        outputRoot: "C:\\exports",
        outputPath: "C:\\exports\\out.mp4",
        totalFrames: 2
      },
      deps({
        fsApi,
        spawn: () => child,
        frameProducer: async function* (): AsyncIterable<VideoFrame> {
          yield { index: 1, data: Buffer.from("first") };
          await new Promise(() => undefined);
        },
        watchdog: { renderNoProgressMs: 15, heartbeatMs: 5 }
      })
    );

    expect(result).toMatchObject({ ok: false, code: "stage_timeout" });
    expect(child.killedWith).toBe("SIGTERM");
    expect(fsApi.rm).toHaveBeenCalledWith("C:\\exports\\out.partial.mp4", { force: true });
  });

  it("cancels the encoder process and removes partial files", async () => {
    const controller = new AbortController();
    const child = new FakeChild();
    const fsApi = fakeFs(false);
    const resultPromise = exportVideoMp4(
      {
        outputRoot: "C:\\exports",
        outputPath: "C:\\exports\\out.mp4",
        totalFrames: 2,
        signal: controller.signal
      },
      deps({
        fsApi,
        spawn: () => child,
        frameProducer: async function* (): AsyncIterable<VideoFrame> {
          yield { index: 1, data: Buffer.from("frame") };
          controller.abort();
          yield { index: 2, data: Buffer.from("late") };
        }
      })
    );

    const result = await resultPromise;

    expect(result).toMatchObject({ ok: false, code: "cancelled" });
    expect(child.killedWith).toBe("SIGTERM");
    expect(fsApi.rm).toHaveBeenCalledWith("C:\\exports\\out.partial.mp4", { force: true });
    expect(fsApi.rename).not.toHaveBeenCalled();
  });

  it("rejects existing output unless overwrite is explicit and maps encoder failures", async () => {
    const existingResult = await exportVideoMp4(
      {
        outputRoot: "C:\\exports",
        outputPath: "C:\\exports\\out.mp4",
        totalFrames: 1
      },
      deps({ fsApi: fakeFs(true) })
    );
    expect(existingResult).toMatchObject({ ok: false, code: "output_exists" });

    const child = new FakeChild();
    const fsApi = fakeFs(false);
    const failedPromise = exportVideoMp4(
      {
        outputRoot: "C:\\exports",
        outputPath: "C:\\exports\\out.mp4",
        totalFrames: 1
      },
      deps({
        fsApi,
        spawn: () => child,
        frameProducer: async function* (): AsyncIterable<VideoFrame> {
          yield { index: 1, data: Buffer.from("frame") };
          child.stderr.emit("data", "No space left on device C:\\Users\\secret\\out.mp4");
          setTimeout(() => child.emit("exit", 1), 0);
        }
      })
    );

    await expect(failedPromise).resolves.toMatchObject({ ok: false, code: "disk_full" });
    expect(fsApi.rm).toHaveBeenCalledWith("C:\\exports\\out.partial.mp4", { force: true });
  });
});

class FakeChild extends EventEmitter implements SpawnedFfmpeg {
  readonly writes: Buffer[] = [];
  readonly stderr = new EventEmitter();
  killedWith: NodeJS.Signals | undefined;
  readonly stdin = {
    write: (chunk: Buffer) => {
      this.writes.push(chunk);
      return true;
    },
    end: () => undefined
  };

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    this.emit("exit", 1);
    return true;
  }
}

function deps(overrides: Partial<VideoExporterDependencies> = {}): VideoExporterDependencies {
  const bytes = Buffer.from("trusted ffmpeg");
  const manifest: FfmpegManifest = {
    executableRelativePath: "ffmpeg\\ffmpeg.exe",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    versionPattern: "^ffmpeg version 7",
    requiredEncoders: ["h264_mf", "aac"],
    forbiddenBuildConfigurationTokens: ["--enable-gpl", "--enable-nonfree", "libx264"],
    licenseNotice: "LGPL FFmpeg build.",
    sourceOfferUrl: "https://ffmpeg.org/releases/"
  };

  return {
    trustedResourcesRoot: "C:\\app\\resources",
    manifest,
    pathApi: path.win32,
    ffmpegProbe: {
      readFile: async () => bytes,
      run: async (_filePath, args) => {
        if (args.includes("-version")) {
          return { stdout: "ffmpeg version 7", stderr: "" };
        }
        if (args.includes("-buildconf")) {
          return { stdout: "--enable-shared --disable-gpl", stderr: "" };
        }
        return { stdout: " V..... h264_mf\n A..... aac", stderr: "" };
      }
    },
    spawn: () => new FakeChild(),
    frameProducer: async function* (): AsyncIterable<VideoFrame> {
      yield { index: 1, data: Buffer.from("frame") };
    },
    ...overrides
  };
}

function fakeFs(exists: boolean) {
  return {
    access: vi.fn(async () => {
      if (!exists) {
        throw new Error("missing");
      }
    }),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined)
  };
}

function plan() {
  return {
    outputPath: "C:\\exports\\out.mp4",
    partialPath: "C:\\exports\\out.partial.mp4",
    width: 1080,
    height: 1920,
    fps: 30,
    overwrite: true
  };
}

function filterComplex(args: readonly string[]): string {
  return args[args.indexOf("-filter_complex") + 1] ?? "";
}
