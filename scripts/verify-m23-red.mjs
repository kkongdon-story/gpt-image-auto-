import fs from "node:fs/promises";
import path from "node:path";
import {
  artifactRecord,
  parseArgs,
  pathExists,
  runProcess,
  writeGateEvidence
} from "./m23-evidence-helpers.mjs";

const options = parseArgs(process.argv.slice(2));
const gate = "G0-context-and-red";
const startedAt = new Date().toISOString();
const userVideo = path.resolve(
  options.input ?? "C:/Users/js480/Downloads/cardnews-2026-07-17.mp4"
);
const ffprobe = path.resolve("resources/ffmpeg/ffprobe.exe");
const assertions = [];
const inputs = [];
let log = "";

function assert(id, passed, detail) {
  assertions.push({ id, passed, detail });
}

assert("ffprobe-present", await pathExists(ffprobe), ffprobe);
assert("user-regression-video-present", await pathExists(userVideo), userVideo);

if (await pathExists(userVideo)) {
  inputs.push(await artifactRecord(userVideo));
}

if (assertions.every((item) => item.passed)) {
  const probe = await runProcess(
    ffprobe,
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      userVideo
    ],
    { timeoutMs: 30000 }
  );
  log += `${probe.stdout}\n${probe.stderr}`;
  assert("ffprobe-exit", probe.exitCode === 0, `exit=${probe.exitCode}`);
  if (probe.exitCode === 0) {
    const parsed = JSON.parse(probe.stdout);
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    assert("regression-codec-h264", video?.codec_name === "h264", `codec=${video?.codec_name}`);
    assert(
      "regression-resolution-1080x1920",
      video?.width === 1080 && video?.height === 1920,
      `${video?.width}x${video?.height}`
    );
    assert(
      "regression-frame-rate-30",
      video?.avg_frame_rate === "30/1",
      `avg_frame_rate=${video?.avg_frame_rate}`
    );
    assert(
      "regression-duration-30s",
      Math.abs(Number(parsed.format?.duration) - 30) <= 0.05,
      `duration=${parsed.format?.duration}`
    );
  }
}

const result = await writeGateEvidence({
  gate,
  command: `node scripts/verify-m23-red.mjs --input "${userVideo}"`,
  startedAt,
  exitCode: assertions.every((item) => item.passed) ? 0 : 1,
  inputs,
  assertions,
  log
});

console.log(JSON.stringify(result));
if (result.verdict !== "pass") process.exitCode = 1;
