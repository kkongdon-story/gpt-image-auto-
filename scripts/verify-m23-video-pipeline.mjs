import fs from "node:fs/promises";
import path from "node:path";
import {
  artifactRecord,
  m23EvidenceRoot,
  pathExists,
  runProcess,
  writeGateEvidence
} from "./m23-evidence-helpers.mjs";

const gate = "G6-video-quality";
const startedAt = new Date().toISOString();
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const ffmpeg = path.resolve("resources/ffmpeg/ffmpeg.exe");
const ffprobe = path.resolve("resources/ffmpeg/ffprobe.exe");
const output = path.resolve(m23EvidenceRoot, "m23-h264-trial.mp4");
await fs.mkdir(path.dirname(output), { recursive: true });
const tests = await runProcess(
  process.execPath,
  [vitest, "--run", "electron/videoExporter.test.ts", "electron/videoFrameProducer.test.ts", "electron/ffmpegPreflight.test.ts"],
  { timeoutMs: 120_000 }
);
const encoderHelp = await runProcess(ffmpeg, ["-hide_banner", "-h", "encoder=h264_mf"], { timeoutMs: 30_000 });
const encodeArgs = [
  "-hide_banner", "-y",
  "-f", "lavfi",
  "-i", "testsrc2=size=1080x1920:rate=30",
  "-t", "2",
  "-c:v", "h264_mf",
  "-pix_fmt", "yuv420p",
  "-rate_control", "pc_vbr",
  "-b:v", "10M",
  "-maxrate", "14M",
  "-bufsize", "20M",
  "-quality", "85",
  "-scenario", "archive",
  "-g", "60",
  output
];
const encode = await runProcess(ffmpeg, encodeArgs, { timeoutMs: 120_000 });
const probe = encode.exitCode === 0
  ? await runProcess(
      ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
      { timeoutMs: 30_000 }
    )
  : { exitCode: 1, stdout: "", stderr: "encode failed" };
let parsed = {};
if (probe.exitCode === 0) parsed = JSON.parse(probe.stdout);
const video = parsed.streams?.find((stream) => stream.codec_type === "video");
const assertions = [
  { id: "video-pipeline-tests-pass", passed: tests.exitCode === 0, detail: `exit=${tests.exitCode}` },
  { id: "ffmpeg-present", passed: await pathExists(ffmpeg), detail: ffmpeg },
  { id: "ffprobe-present", passed: await pathExists(ffprobe), detail: ffprobe },
  { id: "h264-mf-help", passed: encoderHelp.exitCode === 0 && encoderHelp.stdout.includes("h264_mf"), detail: `exit=${encoderHelp.exitCode}` },
  { id: "h264-mf-trial-encode", passed: encode.exitCode === 0, detail: `exit=${encode.exitCode}` },
  { id: "trial-probe", passed: probe.exitCode === 0, detail: `exit=${probe.exitCode}` },
  { id: "trial-h264", passed: video?.codec_name === "h264", detail: `codec=${video?.codec_name}` },
  { id: "trial-yuv420p", passed: video?.pix_fmt === "yuv420p", detail: `pix_fmt=${video?.pix_fmt}` },
  { id: "trial-resolution", passed: video?.width === 1080 && video?.height === 1920, detail: `${video?.width}x${video?.height}` },
  { id: "trial-fps", passed: video?.avg_frame_rate === "30/1", detail: `fps=${video?.avg_frame_rate}` },
  {
    id: "trial-motion-bitrate",
    passed: Number(video?.bit_rate ?? parsed.format?.bit_rate ?? 0) >= 6_000_000,
    detail: `bit_rate=${video?.bit_rate ?? parsed.format?.bit_rate}`
  },
  {
    id: "trial-duration",
    passed: Math.abs(Number(parsed.format?.duration ?? 0) - 2) <= 1 / 30,
    detail: `duration=${parsed.format?.duration}`
  }
];
const outputs = encode.exitCode === 0 && await pathExists(output) ? [await artifactRecord(output)] : [];
const meta = await writeGateEvidence({
  gate,
  command: `${ffmpeg} ${encodeArgs.join(" ")}`,
  startedAt,
  exitCode: assertions.every((item) => item.passed) ? 0 : 1,
  inputs: [
    await artifactRecord(ffmpeg),
    await artifactRecord(ffprobe)
  ],
  outputs,
  assertions,
  log: [
    tests.stdout,
    tests.stderr,
    encoderHelp.stdout,
    encoderHelp.stderr,
    encode.stdout,
    encode.stderr,
    probe.stdout,
    probe.stderr
  ].join("\n")
});
console.log(JSON.stringify(meta));
if (meta.verdict !== "pass") process.exitCode = 1;
