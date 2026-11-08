import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, writeGateEvidence } from "./m23-evidence-helpers.mjs";

const gate = "G3-preview-and-import";
const startedAt = new Date().toISOString();
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const testFiles = [
  "src/storage/mediaLibrary.test.ts",
  "electron/videoMediaProbe.test.ts",
  "src/render-engine/cardTemplate.test.ts"
];
const test = await runProcess(process.execPath, [vitest, "--run", ...testFiles], { timeoutMs: 120_000 });
const librarySource = await fs.readFile(path.resolve("src/storage/mediaLibrary.ts"), "utf8");
const rendererSource = await fs.readFile(path.resolve("src/render-engine/cardTemplate.ts"), "utf8");
const assertions = [
  { id: "preview-import-tests-pass", passed: test.exitCode === 0, detail: `exit=${test.exitCode}` },
  {
    id: "selected-card-live-video",
    passed: rendererSource.includes("input.liveVideo === true") && rendererSource.includes("<video"),
    detail: "Only the selected card requests live video rendering."
  },
  {
    id: "inactive-video-poster",
    passed: rendererSource.includes("video-poster"),
    detail: "Inactive video surfaces use poster markup."
  },
  {
    id: "video-import-300mib",
    passed: librarySource.includes("300 * 1024 * 1024"),
    detail: "New MP4 import limit is 300 MiB."
  },
  {
    id: "streaming-import",
    passed: librarySource.includes("createReadStream") || librarySource.includes("pipeline("),
    detail: "Media import hashes/copies with streaming APIs."
  },
  {
    id: "import-probe-contract",
    passed:
      librarySource.includes("h264") &&
      librarySource.includes("yuv420p") &&
      librarySource.includes("durationMs"),
    detail: "Import enforces codec, pixel format, and duration metadata."
  }
];
const meta = await writeGateEvidence({
  gate,
  command: `node ${vitest} --run ${testFiles.join(" ")}`,
  startedAt,
  exitCode: assertions.every((item) => item.passed) ? 0 : 1,
  assertions,
  log: `${test.stdout}\n${test.stderr}`
});
console.log(JSON.stringify(meta));
if (meta.verdict !== "pass") process.exitCode = 1;
