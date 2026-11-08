import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type FfmpegManifest = {
  readonly executableRelativePath: string;
  readonly sha256: string;
  readonly probeRelativePath?: string;
  readonly probeSha256?: string;
  readonly versionPattern: string;
  readonly requiredEncoders: readonly string[];
  readonly forbiddenBuildConfigurationTokens: readonly string[];
  readonly licenseNotice: string;
  readonly sourceOfferUrl: string;
};

export type FfmpegPreflightFailureCode =
  | "invalid_manifest"
  | "untrusted_path"
  | "hash_mismatch"
  | "version_mismatch"
  | "forbidden_build"
  | "missing_h264_mf"
  | "missing_aac"
  | "probe_failed";

export type FfmpegPreflightResult =
  | {
      readonly ok: true;
      readonly executablePath: string;
      readonly version: string;
      readonly buildConfiguration: string;
      readonly encoders: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: FfmpegPreflightFailureCode;
      readonly message: string;
    };

export type FfmpegProbe = {
  readonly readFile?: (filePath: string) => Promise<Buffer>;
  readonly run: (filePath: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
};

export type FfmpegPreflightOptions = {
  readonly trustedResourcesRoot: string;
  readonly manifest: FfmpegManifest;
  readonly probe: FfmpegProbe;
  readonly pathApi?: typeof path.win32 | typeof path.posix;
};

export const defaultFfmpegManifest: FfmpegManifest = {
  executableRelativePath: "ffmpeg/ffmpeg.exe",
  sha256: "ba0983c7034c56544be56564969dccbed401012bc849f68b4da40dffe34a5560",
  probeRelativePath: "ffmpeg/ffprobe.exe",
  probeSha256: "08a95b336dd60ac3428a8648dd5ce284607db21b21c1191686cf5965386060e4",
  versionPattern: "^ffmpeg version N-125628-ga5e6c0175a-20260715\\b",
  requiredEncoders: ["h264_mf", "aac"],
  forbiddenBuildConfigurationTokens: ["--enable-gpl", "--enable-nonfree", "--enable-libx264"],
  licenseNotice: "BtbN FFmpeg LGPL build; see bundled LICENSE.txt and THIRD_PARTY_NOTICES.md.",
  sourceOfferUrl: "https://github.com/BtbN/FFmpeg-Builds/releases"
};

export async function preflightFfmpeg(options: FfmpegPreflightOptions): Promise<FfmpegPreflightResult> {
  const pathApi = options.pathApi ?? path.win32;
  const manifestValidation = validateFfmpegManifest(options.manifest, pathApi);
  if (manifestValidation.ok === false) {
    return manifestValidation;
  }

  const trustedRoot = pathApi.resolve(options.trustedResourcesRoot);
  const executablePath = pathApi.resolve(trustedRoot, options.manifest.executableRelativePath);
  if (!isPathInside(trustedRoot, executablePath, pathApi)) {
    return failure("untrusted_path", "FFmpeg executable must be under trusted packaged resources.");
  }

  const readFile = options.probe.readFile ?? fs.readFile;
  let bytes: Buffer;
  try {
    bytes = await readFile(executablePath);
  } catch {
    return failure("probe_failed", "Bundled FFmpeg executable could not be read.");
  }

  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== options.manifest.sha256.toLowerCase()) {
    return failure("hash_mismatch", "Bundled FFmpeg hash does not match the trusted manifest.");
  }

  const versionProbe = await runProbe(options.probe, executablePath, ["-hide_banner", "-version"]);
  if (versionProbe.ok === false) {
    return versionProbe;
  }
  const versionOutput = `${versionProbe.stdout}\n${versionProbe.stderr}`.trim();
  if (!new RegExp(options.manifest.versionPattern).test(versionOutput)) {
    return failure("version_mismatch", "Bundled FFmpeg version does not match the trusted manifest.");
  }

  const buildProbe = await runProbe(options.probe, executablePath, ["-hide_banner", "-buildconf"]);
  if (buildProbe.ok === false) {
    return buildProbe;
  }
  const buildConfiguration = `${buildProbe.stdout}\n${buildProbe.stderr}`;
  const forbidden = findForbiddenBuildToken(
    buildConfiguration,
    options.manifest.forbiddenBuildConfigurationTokens
  );
  if (forbidden) {
    return failure("forbidden_build", `Bundled FFmpeg uses forbidden build option: ${forbidden}.`);
  }

  const encodersProbe = await runProbe(options.probe, executablePath, ["-hide_banner", "-encoders"]);
  if (encodersProbe.ok === false) {
    return encodersProbe;
  }
  const encoders = parseFfmpegEncoders(`${encodersProbe.stdout}\n${encodersProbe.stderr}`);
  const encoderSet = new Set(encoders);
  if (!encoderSet.has("h264_mf")) {
    return failure(
      "missing_h264_mf",
      "H.264 Media Foundation encoder h264_mf is unavailable. On Windows N, install the Media Feature Pack and retry."
    );
  }
  if (!encoderSet.has("aac")) {
    return failure("missing_aac", "AAC encoder is unavailable in the bundled FFmpeg build.");
  }

  return {
    ok: true,
    executablePath,
    version: versionOutput.split(/\r?\n/)[0] ?? versionOutput,
    buildConfiguration,
    encoders
  };
}

export function validateFfmpegManifest(
  manifest: FfmpegManifest,
  pathApi: typeof path.win32 | typeof path.posix = path.win32
): FfmpegPreflightResult {
  if (
    !manifest.executableRelativePath ||
    pathApi.isAbsolute(manifest.executableRelativePath) ||
    manifest.executableRelativePath.split(/[\\/]+/).includes("..")
  ) {
    return failure("invalid_manifest", "FFmpeg manifest must use a relative executable path.");
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    return failure("invalid_manifest", "FFmpeg manifest must pin a SHA-256 checksum.");
  }
  if (
    (manifest.probeRelativePath !== undefined || manifest.probeSha256 !== undefined) &&
    (!manifest.probeRelativePath ||
      pathApi.isAbsolute(manifest.probeRelativePath) ||
      manifest.probeRelativePath.split(/[\\/]+/).includes("..") ||
      !manifest.probeSha256 ||
      !/^[a-f0-9]{64}$/i.test(manifest.probeSha256))
  ) {
    return failure("invalid_manifest", "FFprobe manifest fields must use a trusted relative path and pinned SHA-256.");
  }
  if (!manifest.requiredEncoders.includes("h264_mf") || !manifest.requiredEncoders.includes("aac")) {
    return failure("invalid_manifest", "FFmpeg manifest must require h264_mf and AAC encoders.");
  }
  const forbidden = findForbiddenBuildToken(
    [
      manifest.executableRelativePath,
      manifest.probeRelativePath ?? "",
      manifest.versionPattern,
      manifest.requiredEncoders.join(" "),
      manifest.licenseNotice,
      manifest.sourceOfferUrl
    ].join("\n"),
    ["--enable-gpl", "--enable-nonfree", "--enable-libx264"]
  );
  if (forbidden) {
    return failure("invalid_manifest", `FFmpeg manifest contains forbidden token: ${forbidden}.`);
  }
  if (!manifest.licenseNotice.trim() || !/^https?:\/\//.test(manifest.sourceOfferUrl)) {
    return failure("invalid_manifest", "FFmpeg manifest must include LGPL notice and source/build URL.");
  }
  return {
    ok: true,
    executablePath: "",
    version: "",
    buildConfiguration: "",
    encoders: []
  };
}

export function parseFfmpegEncoders(output: string): readonly string[] {
  const encoders = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[A-Z.]{6}\s+([A-Za-z0-9_]+)/.exec(line);
    if (match?.[1]) {
      encoders.add(match[1]);
    }
  }
  return [...encoders].sort();
}

function findForbiddenBuildToken(text: string, tokens: readonly string[]): string | undefined {
  const normalized = text.toLowerCase();
  return tokens.find((token) => normalized.includes(token.toLowerCase()));
}

async function runProbe(
  probe: FfmpegProbe,
  executablePath: string,
  args: readonly string[]
): Promise<
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | { readonly ok: false; readonly code: FfmpegPreflightFailureCode; readonly message: string }
> {
  try {
    const result = await probe.run(executablePath, args);
    return { ok: true, ...result };
  } catch {
    return failure("probe_failed", "Bundled FFmpeg probe failed.");
  }
}

function isPathInside(root: string, target: string, pathApi: typeof path.win32 | typeof path.posix): boolean {
  const relative = pathApi.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

function failure(
  code: FfmpegPreflightFailureCode,
  message: string
): { readonly ok: false; readonly code: FfmpegPreflightFailureCode; readonly message: string } {
  return { ok: false, code, message };
}
