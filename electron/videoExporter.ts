import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildVideoExportPlan,
  classifyVideoExportFailure,
  sanitizeVideoExportLog,
  videoExportWatchdogDefaults
} from "../src/domain/videoExport.js";
import type {
  VideoExportError,
  VideoExportPlan,
  VideoExportProgress,
  VideoExportStage
} from "../src/domain/videoExport.js";
import { preflightFfmpeg } from "./ffmpegPreflight.js";
import type { FfmpegManifest, FfmpegProbe, FfmpegPreflightResult } from "./ffmpegPreflight.js";

export type VideoFrame = {
  readonly index: number;
  readonly data: Buffer;
};

export type VideoExportJob = {
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly totalFrames: number;
  readonly totalDurationMs?: number;
  readonly overwrite?: boolean;
  readonly audioSegments?: readonly VideoExportAudioSegment[];
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: VideoExportProgress) => void;
};

export type VideoExportAudioSegment = {
  readonly path: string;
  readonly sceneStartMs: number;
  readonly clipStartMs: number;
  readonly durationMs: number;
  readonly volume: number;
};

export type VideoExportSuccess = {
  readonly ok: true;
  readonly outputPath: string;
  readonly framesWritten: number;
};

export type VideoExporterResult = VideoExportSuccess | VideoExportError;

export type VideoFrameProducer = (plan: VideoExportPlan) => AsyncIterable<VideoFrame>;

export const highQualityH264MfArgs = [
  "-c:v",
  "h264_mf",
  "-pix_fmt",
  "yuv420p",
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
] as const;

export type SpawnedFfmpeg = EventEmitter & {
  readonly stdin?: {
    readonly write: (chunk: Buffer) => boolean;
    readonly end: () => void;
  };
  readonly stderr?: EventEmitter;
  readonly kill: (signal?: NodeJS.Signals) => boolean;
};

export type SpawnFfmpeg = (filePath: string, args: readonly string[]) => SpawnedFfmpeg;

export type VideoExporterDependencies = {
  readonly trustedResourcesRoot: string;
  readonly manifest: FfmpegManifest;
  readonly ffmpegProbe: FfmpegProbe;
  readonly spawn: SpawnFfmpeg;
  readonly frameProducer: VideoFrameProducer;
  readonly fsApi?: Pick<typeof fs, "access" | "rename" | "rm">;
  readonly pathApi?: typeof path.win32 | typeof path.posix;
  readonly preflight?: () => Promise<FfmpegPreflightResult>;
  readonly watchdog?: Partial<VideoExportWatchdog>;
};

export type VideoExportWatchdog = {
  readonly heartbeatMs: number;
  readonly preflightMs: number;
  readonly producerInitMs: number;
  readonly renderNoProgressMs: number;
  readonly encodeMs: number;
  readonly finalizeMs: number;
};

export async function exportVideoMp4(
  job: VideoExportJob,
  dependencies: VideoExporterDependencies
): Promise<VideoExporterResult> {
  const fsApi = dependencies.fsApi ?? fs;
  const pathApi = dependencies.pathApi ?? path.win32;
  const watchdog = { ...videoExportWatchdogDefaults, ...dependencies.watchdog };
  let lastProgress: VideoExportProgress | undefined;
  let stageStartedAt = Date.now();
  const progress = (next: VideoExportProgress) => {
    if (lastProgress?.stage !== next.stage) {
      stageStartedAt = Date.now();
    }
    const bounded = {
      ...next,
      percent: Math.max(lastProgress?.percent ?? 0, Math.min(100, next.percent)),
      elapsedMs: Date.now() - stageStartedAt
    };
    lastProgress = bounded;
    job.onProgress?.(bounded);
  };
  const heartbeat = setInterval(() => {
    if (!lastProgress) return;
    job.onProgress?.({
      ...lastProgress,
      elapsedMs: Date.now() - stageStartedAt
    });
  }, watchdog.heartbeatMs);
  heartbeat.unref?.();

  let plan: VideoExportPlan | undefined;
  let child: SpawnedFfmpeg | undefined;
  let iterator: AsyncIterator<VideoFrame> | undefined;
  let completed = false;
  const abort = async () => {
    if (completed) return;
    child?.stdin?.end();
    child?.kill("SIGTERM");
    if (iterator?.return) {
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
    if (plan) await cleanupPartial(plan.partialPath, fsApi);
  };
  const abortHandler = () => {
    void abort();
  };
  job.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    progress({ stage: "compile", percent: 0, message: "영상 구성을 확인하는 중" });
    const outputExists = await pathExists(job.outputPath, fsApi);
    const planResult = buildVideoExportPlan({
      outputPath: job.outputPath,
      outputRoot: job.outputRoot,
      overwrite: job.overwrite === true,
      outputExists,
      pathApi
    });
    if (planResult.ok === false) return planResult;
    plan = planResult.plan;
    if (job.signal?.aborted) return error("cancelled", "MP4 export was cancelled.");

    progress({ stage: "preflight", percent: 5, message: "영상 인코더를 점검하는 중" });
    const preflight =
      dependencies.preflight ??
      (() =>
        preflightFfmpeg({
          trustedResourcesRoot: dependencies.trustedResourcesRoot,
          manifest: dependencies.manifest,
          probe: dependencies.ffmpegProbe,
          pathApi
        }));
    const preflightResult = await withStageTimeout(preflight(), watchdog.preflightMs, "preflight");
    if (preflightResult.ok === false) return error("preflight_failed", preflightResult.message);

    const args = buildFfmpegExportArgs(plan, job);
    child = dependencies.spawn(preflightResult.executablePath, args);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    iterator = dependencies.frameProducer(plan)[Symbol.asyncIterator]();
    progress({ stage: "producer_init", percent: 15, message: "첫 장면을 준비하는 중" });
    let nextFrame = await withStageTimeout(iterator.next(), watchdog.producerInitMs, "producer_init");
    let framesWritten = 0;
    while (!nextFrame.done) {
      if (job.signal?.aborted) {
        await abort();
        return error("cancelled", "MP4 export was cancelled.");
      }
      const frame = nextFrame.value;
      child.stdin?.write(frame.data);
      framesWritten += 1;
      const renderPercent =
        20 + Math.floor((Math.min(framesWritten, job.totalFrames) / Math.max(1, job.totalFrames)) * 65);
      progress({
        stage: "render",
        percent: renderPercent,
        completedFrames: frame.index,
        totalFrames: job.totalFrames,
        message: `장면 렌더링 ${Math.min(framesWritten, job.totalFrames)}/${job.totalFrames}`
      });
      nextFrame = await withStageTimeout(iterator.next(), watchdog.renderNoProgressMs, "render");
    }
    child.stdin?.end();

    progress({
      stage: "encode",
      percent: 90,
      completedFrames: framesWritten,
      totalFrames: job.totalFrames,
      message: "MP4 파일을 인코딩하는 중"
    });
    const exitCode = await withStageTimeout(waitForExit(child), watchdog.encodeMs, "encode");
    if (exitCode !== 0) {
      await cleanupPartial(plan.partialPath, fsApi);
      const cleaned = sanitizeVideoExportLog(stderr);
      return error(classifyVideoExportFailure(cleaned), userMessageForFailure(cleaned));
    }

    progress({ stage: "finalize", percent: 95, message: "완성 파일을 저장하는 중" });
    await withStageTimeout(fsApi.rename(plan.partialPath, plan.outputPath), watchdog.finalizeMs, "finalize");
    completed = true;
    progress({ stage: "finalize", percent: 100, message: "MP4 내보내기 완료" });
    return {
      ok: true,
      outputPath: plan.outputPath,
      framesWritten
    };
  } catch (cause) {
    await abort();
    if (cause instanceof VideoStageTimeoutError) {
      return error(
        "stage_timeout",
        `${stageLabel(cause.stage)} 단계가 ${Math.round(cause.timeoutMs / 1000)}초 동안 응답하지 않아 중단했습니다. 미디어 파일을 확인한 뒤 다시 시도하세요.`
      );
    }
    const cleaned = sanitizeVideoExportLog(cause instanceof Error ? cause.message : String(cause));
    return error(classifyVideoExportFailure(cleaned), userMessageForFailure(cleaned));
  } finally {
    clearInterval(heartbeat);
    job.signal?.removeEventListener("abort", abortHandler);
    if (!completed && job.signal?.aborted) {
      if (plan) await cleanupPartial(plan.partialPath, fsApi);
    }
  }
}

export function buildFfmpegExportArgs(plan: VideoExportPlan, job: VideoExportJob): readonly string[] {
  const args = [
    "-hide_banner",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${plan.width}x${plan.height}`,
    "-r",
    String(plan.fps),
    "-i",
    "pipe:0"
  ];

  const audioSegments = normalizeAudioSegments(job.audioSegments);
  for (const segment of audioSegments) {
    args.push("-i", segment.path);
  }

  const durationSeconds = millisecondsToSeconds(job.totalDurationMs);
  if (audioSegments.length > 0) {
    args.push(
      "-filter_complex",
      buildAudioFilterComplex(audioSegments, durationSeconds),
      "-map",
      "0:v:0",
      "-map",
      "[aout]"
    );
  } else {
    args.push("-an");
  }

  args.push(
    ...highQualityH264MfArgs,
    "-r",
    String(plan.fps),
    "-movflags",
    "+faststart",
    ...(durationSeconds > 0 ? ["-t", formatSeconds(durationSeconds)] : []),
    ...(audioSegments.length > 0 ? ["-c:a", "aac"] : []),
    plan.partialPath
  );
  return args;
}

function normalizeAudioSegments(segments: readonly VideoExportAudioSegment[] | undefined): readonly VideoExportAudioSegment[] {
  return (segments ?? []).filter(
    (segment) =>
      segment.path.length > 0 &&
      Number.isFinite(segment.sceneStartMs) &&
      Number.isFinite(segment.clipStartMs) &&
      Number.isFinite(segment.durationMs) &&
      Number.isFinite(segment.volume) &&
      segment.sceneStartMs >= 0 &&
      segment.clipStartMs >= 0 &&
      segment.durationMs > 0 &&
      segment.volume > 0
  );
}

function buildAudioFilterComplex(segments: readonly VideoExportAudioSegment[], totalDurationSeconds: number): string {
  const chains = segments.map((segment, index) => {
    const inputIndex = index + 1;
    const label = audioSegmentLabel(index);
    const filters = [
      `atrim=start=${formatSeconds(millisecondsToSeconds(segment.clipStartMs))}:duration=${formatSeconds(millisecondsToSeconds(segment.durationMs))}`,
      "asetpts=PTS-STARTPTS",
      `volume=${formatVolume(segment.volume)}`,
      `adelay=${Math.round(segment.sceneStartMs)}:all=1`
    ];
    return `[${inputIndex}:a:0]${filters.join(",")}[${label}]`;
  });
  const mixedLabel = "mixed";
  const mix =
    segments.length === 1
      ? `[${audioSegmentLabel(0)}]anull[${mixedLabel}]`
      : `${segments.map((_segment, index) => `[${audioSegmentLabel(index)}]`).join("")}amix=inputs=${segments.length}:duration=longest:dropout_transition=0[${mixedLabel}]`;
  const trim =
    totalDurationSeconds > 0
      ? `[${mixedLabel}]apad,atrim=duration=${formatSeconds(totalDurationSeconds)},asetpts=PTS-STARTPTS[aout]`
      : `[${mixedLabel}]anull[aout]`;
  return [...chains, mix, trim].join(";");
}

function audioSegmentLabel(index: number): string {
  return `a${index}`;
}

function millisecondsToSeconds(milliseconds: number | undefined): number {
  return typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds > 0
    ? milliseconds / 1000
    : 0;
}

function formatSeconds(seconds: number): string {
  return seconds.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatVolume(volume: number): string {
  return Math.max(0, Math.min(1, volume)).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

async function pathExists(filePath: string, fsApi: Pick<typeof fs, "access">): Promise<boolean> {
  try {
    await fsApi.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPartial(filePath: string, fsApi: Pick<typeof fs, "rm">): Promise<void> {
  await fsApi.rm(filePath, { force: true }).catch(() => undefined);
}

function waitForExit(child: SpawnedFfmpeg): Promise<number> {
  return new Promise((resolve) => {
    child.once("exit", (code: number | null) => resolve(code ?? 1));
  });
}

class VideoStageTimeoutError extends Error {
  constructor(
    readonly stage: VideoExportStage,
    readonly timeoutMs: number
  ) {
    super(`${stage} timed out after ${timeoutMs}ms`);
    this.name = "VideoStageTimeoutError";
  }
}

function withStageTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: VideoExportStage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new VideoStageTimeoutError(stage, timeoutMs)), timeoutMs);
    timeout.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timeout);
        reject(cause);
      }
    );
  });
}

function stageLabel(stage: VideoExportStage): string {
  if (stage === "preflight") return "인코더 점검";
  if (stage === "producer_init") return "첫 장면 준비";
  if (stage === "render") return "장면 렌더링";
  if (stage === "encode") return "MP4 인코딩";
  if (stage === "finalize") return "파일 저장";
  return "영상 구성";
}

function userMessageForFailure(stderr: string): string {
  const code = classifyVideoExportFailure(stderr);
  if (code === "disk_full") {
    return "There is not enough disk space to finish the MP4 export.";
  }
  if (code === "permission_denied") {
    return "The MP4 export folder is not writable.";
  }
  if (code === "corrupt_source") {
    return "One of the media sources could not be decoded.";
  }
  return "FFmpeg failed while encoding the MP4.";
}

function error(code: VideoExportError["code"], message: string): VideoExportError {
  return { ok: false, code, message };
}
