import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  appendLog,
  defaultEvidenceRoot,
  hasForbiddenToken,
  isPlaceholderSha,
  parseArgs,
  pathExists,
  readJson,
  runProcess,
  sha256,
  timestampRunId,
  writeJson
} from "./m22-evidence-helpers.mjs";

const root = process.cwd();
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  const evidenceRoot = path.resolve(options.evidenceRoot ?? defaultEvidenceRoot);
  const runId = String(options.runId ?? timestampRunId("smoke"));
  const runDir = path.join(evidenceRoot, runId);
  const logPath = path.join(runDir, "smoke.log");
  const metaPath = path.join(runDir, "meta.json");
  const resultPath = path.join(runDir, "smoke-result.json");
  const startedAt = new Date().toISOString();

  try {
    await fs.mkdir(runDir, { recursive: true });
    await appendLog(logPath, `[${startedAt}] M22 video export smoke started.`);
    const result = await runSmoke({ options, runDir, logPath, startedAt });
    await writeJson(resultPath, result);
    await writeJson(metaPath, {
      schemaVersion: 1,
      result: result.result,
      binaryPresent: result.binaryPresent,
      manifestPath: result.manifestPath,
      outputPath: result.outputPath ?? null,
      error: result.error ?? null,
      startedAt,
      completedAt: new Date().toISOString()
    });
    await writeJson(path.join(evidenceRoot, "current.json"), {
      schemaVersion: 1,
      currentRun: runId,
      artifacts: {
        meta: path.relative(evidenceRoot, metaPath).replaceAll(path.sep, "/"),
        log: path.relative(evidenceRoot, logPath).replaceAll(path.sep, "/"),
        smokeResult: path.relative(evidenceRoot, resultPath).replaceAll(path.sep, "/")
      },
      updatedAt: new Date().toISOString()
    });
    console.log(JSON.stringify(result));
    if (result.result !== "pass") {
      process.exitCode = 1;
    }
  } catch (error) {
    const result = {
      schemaVersion: 1,
      result: "fail",
      binaryPresent: false,
      error: error instanceof Error ? error.message : String(error),
      startedAt,
      completedAt: new Date().toISOString()
    };
    await appendLog(logPath, `[${new Date().toISOString()}] ${result.error}`).catch(() => undefined);
    await writeJson(resultPath, result).catch(() => undefined);
    await writeJson(metaPath, result).catch(() => undefined);
    await writeJson(path.join(evidenceRoot, "current.json"), {
      schemaVersion: 1,
      currentRun: runId,
      artifacts: {
        meta: path.relative(evidenceRoot, metaPath).replaceAll(path.sep, "/"),
        log: path.relative(evidenceRoot, logPath).replaceAll(path.sep, "/"),
        smokeResult: path.relative(evidenceRoot, resultPath).replaceAll(path.sep, "/")
      },
      updatedAt: new Date().toISOString()
    }).catch(() => undefined);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
}

async function runSmoke({ options, runDir, logPath, startedAt }) {
  const manifestPath = path.resolve(options.manifest ?? path.join(root, "resources", "ffmpeg", "ffmpeg.manifest.json"));
  const trustedResourcesRoot = path.resolve(options.trustedResourcesRoot ?? path.join(root, "resources"));
  const manifest = await readJson(manifestPath);
  const executablePath = path.resolve(trustedResourcesRoot, manifest.executableRelativePath ?? "");
  const probePath = path.resolve(trustedResourcesRoot, manifest.probeRelativePath ?? "");
  await appendLog(logPath, `manifest=${manifestPath}`);
  await appendLog(logPath, `trustedResourcesRoot=${trustedResourcesRoot}`);
  await appendLog(logPath, `executable=${executablePath}`);

  if (manifest.binaryPresent !== true || manifest.trustStatus !== "trusted-pinned-lgpl-build") {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: false,
      error:
        "Trusted FFmpeg binary is absent. Supply resources/ffmpeg/ffmpeg.exe out of band, replace the placeholder manifest with trustStatus=trusted-pinned-lgpl-build, and pin the real SHA-256 before running MP4 smoke."
    });
  }
  if (isPlaceholderSha(manifest.sha256)) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: false,
      error: "FFmpeg manifest still uses the all-zero placeholder SHA-256."
    });
  }
  if (!(await pathExists(executablePath))) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: false,
      error: `Trusted FFmpeg executable is missing at ${executablePath}.`
    });
  }
  const actualSha = await sha256(executablePath);
  if (actualSha !== manifest.sha256.toLowerCase()) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `FFmpeg SHA-256 mismatch. expected=${manifest.sha256.toLowerCase()} actual=${actualSha}`
    });
  }
  if (!(await pathExists(probePath))) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `Trusted FFprobe executable is missing at ${probePath}.`
    });
  }
  if ((await sha256(probePath)) !== String(manifest.probeSha256 ?? "").toLowerCase()) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: "FFprobe SHA-256 mismatch."
    });
  }

  const version = await runFfmpeg(executablePath, ["-hide_banner", "-version"]);
  const buildconf = await runFfmpeg(executablePath, ["-hide_banner", "-buildconf"]);
  const encoders = await runFfmpeg(executablePath, ["-hide_banner", "-encoders"]);
  const forbidden = hasForbiddenToken(`${version.stdout}\n${version.stderr}\n${buildconf.stdout}\n${buildconf.stderr}`);
  if (forbidden) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `FFmpeg build contains forbidden token: ${forbidden}.`
    });
  }
  for (const encoder of ["h264_mf", "aac"]) {
    if (!`${encoders.stdout}\n${encoders.stderr}`.includes(encoder)) {
      return actionableFailure({
        startedAt,
        manifestPath,
        binaryPresent: true,
        error: `FFmpeg encoder is missing: ${encoder}.`
      });
    }
  }

  const exporterModule = path.join(root, "dist-electron", "electron", "videoExporter.js");
  if (!(await pathExists(exporterModule))) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: "Built video exporter is missing. Run npm run build:pro before the integrated MP4 smoke."
    });
  }
  const { exportVideoMp4 } = await import(pathToFileUrl(exporterModule));
  const outputRoot = path.join(runDir, "out");
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "m22-smoke.mp4");
  const audioPath = path.join(outputRoot, "primary-audio.wav");
  await runFfmpeg(executablePath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "pcm_s16le",
    audioPath
  ]);
  const progress = [];
  const totalFrames = 30;
  const totalDurationMs = 1000;
  const result = await exportVideoMp4(
    {
      outputRoot,
      outputPath,
      totalFrames,
      totalDurationMs,
      overwrite: true,
      audioSegments: [
        {
          path: audioPath,
          sceneStartMs: 0,
          clipStartMs: 0,
          durationMs: 500,
          volume: 1
        },
        {
          path: audioPath,
          sceneStartMs: 500,
          clipStartMs: 500,
          durationMs: 500,
          volume: 0.5
        }
      ],
      onProgress: (event) => progress.push(event)
    },
    {
      trustedResourcesRoot,
      manifest: toRuntimeManifest(manifest),
      ffmpegProbe: {
        run: async (filePath, args) => runFfmpeg(filePath, args),
        readFile: fs.readFile
      },
      spawn: spawnFfmpeg,
      frameProducer: async function* (plan) {
        const blue = solidRgbaFrame(plan.width, plan.height, [24, 86, 160, 255]);
        const white = solidRgbaFrame(plan.width, plan.height, [230, 236, 245, 255]);
        for (let index = 1; index <= totalFrames; index += 1) {
          yield { index, data: index <= totalFrames / 2 ? blue : white };
        }
      }
    }
  );
  await appendLog(logPath, `exportVideoMp4=${JSON.stringify(result)}`);
  if (result.ok !== true) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `Integrated MP4 export failed: ${result.code} ${result.message}`
    });
  }
  const stat = await fs.stat(outputPath);
  const metadataResult = await runProcess(
    probePath,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath],
    { cwd: root, timeoutMs: 30000 }
  );
  if (metadataResult.exitCode !== 0) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `FFprobe could not inspect the exported MP4: ${metadataResult.stderr}`
    });
  }
  const metadata = JSON.parse(metadataResult.stdout);
  await writeJson(path.join(runDir, "t11-ffprobe.json"), metadata);
  const streamTypes = Array.isArray(metadata.streams)
    ? metadata.streams.map((stream) => stream.codec_type).filter(Boolean)
    : [];
  if (!streamTypes.includes("video") || !streamTypes.includes("audio")) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `Exported MP4 must contain video and audio streams; found ${streamTypes.join(", ")}.`
    });
  }
  const durationSeconds = Number(metadata.format?.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.9 || durationSeconds > 1.2) {
    return actionableFailure({
      startedAt,
      manifestPath,
      binaryPresent: true,
      error: `Exported MP4 duration must stay near one second; found ${metadata.format?.duration ?? "missing"}.`
    });
  }
  return {
    schemaVersion: 1,
    result: "pass",
    binaryPresent: true,
    manifestPath,
    outputPath,
    outputBytes: stat.size,
    streamTypes,
    durationSeconds: Number(metadata.format?.duration ?? 0),
    progress,
    startedAt,
    completedAt: new Date().toISOString()
  };
}

function actionableFailure({ startedAt, manifestPath, binaryPresent, error }) {
  return {
    schemaVersion: 1,
    result: "fail",
    binaryPresent,
    manifestPath,
    error,
    startedAt,
    completedAt: new Date().toISOString()
  };
}

function toRuntimeManifest(manifest) {
  return {
    executableRelativePath: manifest.executableRelativePath,
    sha256: manifest.sha256,
    versionPattern: manifest.versionPattern,
    requiredEncoders: manifest.requiredEncoders,
    forbiddenBuildConfigurationTokens: manifest.forbiddenBuildConfigurationTokens,
    licenseNotice: manifest.licenseNotice,
    sourceOfferUrl: manifest.sourceOfferUrl
  };
}

async function runFfmpeg(filePath, args) {
  const result = await runProcess(filePath, args, { cwd: root, timeoutMs: 30000 });
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg probe failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function spawnFfmpeg(filePath, args) {
  const child = spawn(filePath, args, {
    cwd: root,
    shell: false,
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true
  });
  return child;
}

function solidRgbaFrame(width, height, rgba) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < buffer.length; offset += 4) {
    buffer[offset] = rgba[0];
    buffer[offset + 1] = rgba[1];
    buffer[offset + 2] = rgba[2];
    buffer[offset + 3] = rgba[3];
  }
  return buffer;
}

function pathToFileUrl(filePath) {
  return new URL(`file:///${path.resolve(filePath).replaceAll("\\", "/")}`).href;
}
