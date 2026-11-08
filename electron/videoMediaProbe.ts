import { createHash } from "node:crypto";
import { spawn as spawnChild } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type { VideoMetadataProbe } from "../src/storage/mediaLibrary.js";
import { defaultFfmpegManifest } from "./ffmpegPreflight.js";
import type { FfmpegManifest, FfmpegProbe } from "./ffmpegPreflight.js";

type ProbeProcess = EventEmitter & {
  readonly stdout?: EventEmitter;
  readonly stderr?: EventEmitter;
  readonly kill?: (signal?: NodeJS.Signals) => boolean;
};

type SpawnProbeProcess = (filePath: string, args: readonly string[]) => ProbeProcess;

export type VideoMediaProbeOptions = {
  readonly trustedResourcesRoot: string;
  readonly ffmpegProbe: FfmpegProbe;
  readonly manifest?: Pick<FfmpegManifest, "executableRelativePath" | "sha256" | "probeRelativePath" | "probeSha256">;
  readonly pathApi?: typeof path.win32 | typeof path.posix;
  readonly spawn?: SpawnProbeProcess;
};

type ParsedVideoMetadata = {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly hasAudio: boolean;
  readonly videoCodec?: string;
  readonly audioCodec?: string | null;
  readonly frameRate?: number;
  readonly pixelFormat?: string;
};

const probeTimeoutMs = 30_000;

export function createVideoMediaProbe(options: VideoMediaProbeOptions): VideoMetadataProbe {
  return async ({ sourcePath }) => {
    const pathApi = options.pathApi ?? path.win32;
    const manifest = options.manifest ?? defaultFfmpegManifest;
    if (!manifest.probeRelativePath || !manifest.probeSha256) {
      throw new Error("Bundled FFprobe manifest fields are missing.");
    }
    const readFile = options.ffmpegProbe.readFile ?? fs.readFile;
    const ffprobePath = await resolveTrustedBinaryPath({
      pathApi,
      readFile,
      trustedResourcesRoot: options.trustedResourcesRoot,
      relativePath: manifest.probeRelativePath,
      expectedSha256: manifest.probeSha256,
      label: "FFprobe"
    });
    const ffmpegPath = await resolveTrustedBinaryPath({
      pathApi,
      readFile,
      trustedResourcesRoot: options.trustedResourcesRoot,
      relativePath: manifest.executableRelativePath,
      expectedSha256: manifest.sha256,
      label: "FFmpeg"
    });

    const spawnProcess = options.spawn ?? spawnChild;
    const mediaInfo = await runProbeProcess(
      ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", sourcePath],
      spawnProcess
    );
    if (mediaInfo.exitCode !== 0) {
      throw new Error(`FFprobe could not read the selected video: ${mediaInfo.stderr.trim() || "unknown probe error"}`);
    }
    const parsed = parseFfprobeJson(mediaInfo.stdout);
    if (!parsed) {
      throw new Error("FFprobe returned incomplete video metadata.");
    }

    const poster = await runProbeProcess(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "0",
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1"
      ],
      spawnProcess
    );
    if (poster.exitCode !== 0 || !isJpeg(poster.stdoutBytes)) {
      throw new Error(`FFmpeg could not create a video preview frame: ${poster.stderr.trim() || "empty preview image"}`);
    }

    return {
      ...parsed,
      posterBytes: poster.stdoutBytes,
      posterExtension: "jpg"
    };
  };
}

export function parseFfmpegMediaInfo(output: string): ParsedVideoMetadata | undefined {
  const durationMatch = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output);
  const videoMatch = /Stream #\d+:\d+(?:\[[^\]]+\])?(?:\([^)]+\))?:\s*Video:.*?(\d{2,5})x(\d{2,5})(?:\s|,|\[)/.exec(
    output
  );
  if (!durationMatch || !videoMatch) {
    return undefined;
  }

  const hours = Number.parseInt(durationMatch[1] ?? "0", 10);
  const minutes = Number.parseInt(durationMatch[2] ?? "0", 10);
  const seconds = Number.parseFloat(durationMatch[3] ?? "0");
  const width = Number.parseInt(videoMatch[1] ?? "0", 10);
  const height = Number.parseInt(videoMatch[2] ?? "0", 10);
  const durationMs = Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || width <= 0 || height <= 0) {
    return undefined;
  }

  return {
    width,
    height,
    durationMs,
    hasAudio: /Stream #\d+:\d+(?:\[[^\]]+\])?(?:\([^)]+\))?:\s*Audio:/.test(output)
  };
}

export function parseFfprobeJson(output: string): ParsedVideoMetadata | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!isObject(payload)) {
    return undefined;
  }
  const streams = Array.isArray(payload["streams"]) ? payload["streams"].filter(isObject) : [];
  const videoStream = streams.find((stream) => stream["codec_type"] === "video");
  if (!videoStream) {
    return undefined;
  }

  const width = finiteNumber(videoStream["width"]);
  const height = finiteNumber(videoStream["height"]);
  const durationSeconds =
    finiteNumber(videoStream["duration"]) ??
    (isObject(payload["format"]) ? finiteNumber(payload["format"]["duration"]) : undefined);
  if (!width || !height || !durationSeconds || durationSeconds <= 0) {
    return undefined;
  }
  const frameRate = parseFrameRate(videoStream["avg_frame_rate"]) ?? parseFrameRate(videoStream["r_frame_rate"]);
  const audioStream = streams.find((stream) => stream["codec_type"] === "audio");
  const videoCodec = stringValue(videoStream["codec_name"]);
  const pixelFormat = stringValue(videoStream["pix_fmt"]);

  return {
    width: Math.round(width),
    height: Math.round(height),
    durationMs: Math.round(durationSeconds * 1000),
    hasAudio: streams.some((stream) => stream["codec_type"] === "audio"),
    ...(videoCodec ? { videoCodec } : {}),
    ...(pixelFormat ? { pixelFormat } : {}),
    ...(frameRate !== undefined ? { frameRate } : {}),
    audioCodec: audioStream ? stringValue(audioStream["codec_name"]) ?? null : null
  };
}

async function resolveTrustedBinaryPath(input: {
  readonly trustedResourcesRoot: string;
  readonly readFile: (filePath: string) => Promise<Buffer>;
  readonly pathApi: typeof path.win32 | typeof path.posix;
  readonly relativePath: string;
  readonly expectedSha256: string;
  readonly label: string;
}): Promise<string> {
  const trustedRoot = input.pathApi.resolve(input.trustedResourcesRoot);
  const binaryPath = input.pathApi.resolve(trustedRoot, input.relativePath);
  if (!isPathInside(trustedRoot, binaryPath, input.pathApi)) {
    throw new Error(`Bundled ${input.label} path is outside trusted resources.`);
  }

  try {
    const bytes = await input.readFile(binaryPath);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== input.expectedSha256.toLowerCase()) {
      throw new Error(`Bundled ${input.label} hash does not match the trusted manifest.`);
    }
    return binaryPath;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Bundled ${input.label}`)) {
      throw error;
    }
    throw new Error(`Bundled ${input.label} executable could not be read.`);
  }
}

function isJpeg(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

function isPathInside(root: string, target: string, pathApi: typeof path.win32 | typeof path.posix): boolean {
  const relative = pathApi.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0 || value === "0/0") {
    return undefined;
  }
  const [rawNumerator, rawDenominator] = value.split("/");
  const numerator = Number(rawNumerator);
  const denominator = Number(rawDenominator ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }
  const frameRate = numerator / denominator;
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined;
}

function runProbeProcess(
  filePath: string,
  args: readonly string[],
  spawnProcess: SpawnProbeProcess
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: Buffer;
}> {
  return new Promise((resolve) => {
    const child = spawnProcess(filePath, args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill?.("SIGTERM");
      finish(1);
    }, probeTimeoutMs);

    const finish = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const stdoutBytes = Buffer.concat(stdoutChunks);
      const stderrBytes = Buffer.concat(stderrChunks);
      resolve({
        exitCode,
        stdoutBytes,
        stdout: stdoutBytes.toString("utf8"),
        stderr: stderrBytes.toString("utf8")
      });
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", () => finish(1));
    child.once("exit", (code: number | null) => finish(code ?? 1));
  });
}
