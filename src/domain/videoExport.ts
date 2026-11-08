export const videoExportDefaults = {
  width: 1080,
  height: 1920,
  fps: 30,
  extension: ".mp4",
  partialSuffix: ".partial.mp4"
} as const;

export type VideoExportStage =
  | "compile"
  | "preflight"
  | "producer_init"
  | "render"
  | "encode"
  | "finalize";

export type VideoExportProgress = {
  readonly stage: VideoExportStage;
  readonly percent: number;
  readonly completedFrames?: number;
  readonly totalFrames?: number;
  readonly message?: string;
  readonly elapsedMs?: number;
};

export type VideoExportErrorCode =
  | "invalid_output_path"
  | "output_exists"
  | "preflight_failed"
  | "stage_timeout"
  | "cancelled"
  | "encoder_failed"
  | "disk_full"
  | "permission_denied"
  | "corrupt_source";

export type VideoExportError = {
  readonly ok: false;
  readonly code: VideoExportErrorCode;
  readonly message: string;
};

export type VideoExportPlan = {
  readonly outputPath: string;
  readonly partialPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly overwrite: boolean;
};

export type VideoExportPlanInput = {
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly pathApi?: VideoExportPathApi;
  readonly overwrite?: boolean;
  readonly outputExists?: boolean;
};

export type VideoExportPathApi = {
  readonly resolve: (...paths: readonly string[]) => string;
  readonly relative: (from: string, to: string) => string;
  readonly dirname: (path: string) => string;
  readonly extname: (path: string) => string;
  readonly basename: (path: string, suffix?: string) => string;
  readonly join: (...paths: readonly string[]) => string;
  readonly sep: string;
};

export type VideoExportResult =
  | { readonly ok: true; readonly plan: VideoExportPlan }
  | VideoExportError;

export function buildVideoExportPlan(input: VideoExportPlanInput): VideoExportResult {
  const pathApi = input.pathApi ?? posixLikePathApi;
  const outputRoot = pathApi.resolve(input.outputRoot);
  const outputPath = pathApi.resolve(input.outputPath);

  if (!isPathInside(outputRoot, outputPath, pathApi)) {
    return error("invalid_output_path", "MP4 output must stay inside the selected export folder.");
  }
  if (pathApi.extname(outputPath).toLowerCase() !== videoExportDefaults.extension) {
    return error("invalid_output_path", "MP4 export output must use the .mp4 extension.");
  }
  if (input.outputExists === true && input.overwrite !== true) {
    return error("output_exists", "That MP4 file already exists. Confirm overwrite before exporting.");
  }

  const outputDirectory = pathApi.dirname(outputPath);
  const baseName = pathApi.basename(outputPath, videoExportDefaults.extension);
  const partialPath = pathApi.join(outputDirectory, `${baseName}${videoExportDefaults.partialSuffix}`);
  if (!isPathInside(outputRoot, partialPath, pathApi)) {
    return error("invalid_output_path", "Temporary MP4 output path is outside the export folder.");
  }

  return {
    ok: true,
    plan: {
      outputPath,
      partialPath,
      width: videoExportDefaults.width,
      height: videoExportDefaults.height,
      fps: videoExportDefaults.fps,
      overwrite: input.overwrite === true
    }
  };
}

export function isVideoExportError(value: unknown): value is VideoExportError {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

export function isMonotonicProgress(
  previous: VideoExportProgress | undefined,
  next: VideoExportProgress
): boolean {
  return (
    Number.isFinite(next.percent) &&
    next.percent >= 0 &&
    next.percent <= 100 &&
    (previous === undefined || next.percent >= previous.percent)
  );
}

export const videoExportWatchdogDefaults = {
  heartbeatMs: 1_500,
  preflightMs: 30_000,
  producerInitMs: 45_000,
  renderNoProgressMs: 30_000,
  encodeMs: 60_000,
  finalizeMs: 60_000
} as const;

export function sanitizeVideoExportLog(input: string): string {
  return input
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "[path]")
    .replace(/\\\\[^\s"']+/g, "[path]")
    .replace(/(?:prompt|conversation|message|content)=("[^"]*"|'[^']*'|[^\s]+)/gi, "$1=[redacted]");
}

export function classifyVideoExportFailure(stderr: string): VideoExportErrorCode {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("no space left") || normalized.includes("not enough space")) {
    return "disk_full";
  }
  if (normalized.includes("permission denied") || normalized.includes("eperm") || normalized.includes("eacces")) {
    return "permission_denied";
  }
  if (normalized.includes("invalid data") || normalized.includes("corrupt") || normalized.includes("moov atom not found")) {
    return "corrupt_source";
  }
  return "encoder_failed";
}

function isPathInside(root: string, target: string, pathApi: VideoExportPathApi): boolean {
  const relative = pathApi.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !relative.includes(`..${pathApi.sep}`) && !isAbsoluteLike(relative))
  );
}

function isAbsoluteLike(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\");
}

function error(code: VideoExportErrorCode, message: string): VideoExportError {
  return { ok: false, code, message };
}

const posixLikePathApi: VideoExportPathApi = {
  resolve: (...paths) => {
    const joined = paths.join("/");
    const segments = joined.split(/[\\/]+/).filter(Boolean);
    const resolved: string[] = [];
    for (const segment of segments) {
      if (segment === ".") {
        continue;
      }
      if (segment === "..") {
        resolved.pop();
        continue;
      }
      resolved.push(segment);
    }
    return `/${resolved.join("/")}`;
  },
  relative: (from, to) => {
    const fromParts = from.split("/").filter(Boolean);
    const toParts = to.split("/").filter(Boolean);
    while (fromParts[0] === toParts[0] && fromParts.length > 0 && toParts.length > 0) {
      fromParts.shift();
      toParts.shift();
    }
    return [...fromParts.map(() => ".."), ...toParts].join("/");
  },
  dirname: (value) => value.replace(/[\\/][^\\/]*$/, "") || "/",
  extname: (value) => {
    const name = value.split(/[\\/]/).pop() ?? "";
    const index = name.lastIndexOf(".");
    return index >= 0 ? name.slice(index) : "";
  },
  basename: (value, suffix) => {
    const name = value.split(/[\\/]/).pop() ?? "";
    return suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  },
  join: (...paths) => paths.join("/").replace(/\/+/g, "/"),
  sep: "/"
};
