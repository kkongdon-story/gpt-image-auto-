import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, writeGateEvidence } from "./m23-evidence-helpers.mjs";

const gate = "G4-timeline-consistency";
const startedAt = new Date().toISOString();
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const testFiles = ["src/domain/videoTimeline.test.ts", "electron/videoFrameProducer.test.ts"];
const test = await runProcess(process.execPath, [vitest, "--run", ...testFiles], { timeoutMs: 120_000 });
const appSource = await fs.readFile(path.resolve("src/ui/App.tsx"), "utf8");
const producerSource = await fs.readFile(path.resolve("electron/videoFrameProducer.ts"), "utf8");
const assertions = [
  { id: "timeline-tests-pass", passed: test.exitCode === 0, detail: `exit=${test.exitCode}` },
  {
    id: "ui-uses-compiled-timeline",
    passed: appSource.includes("compileVideoTimeline") && appSource.includes("compiledTimeline.frameCount"),
    detail: "Timeline UI total duration and frames come from CompiledVideoTimeline."
  },
  {
    id: "producer-uses-compiled-timeline",
    passed:
      producerSource.includes("compileVideoTimeline") &&
      producerSource.includes("findCompiledSceneAt") &&
      producerSource.includes("findCompiledTransitionAt"),
    detail: "Frame producer consumes canonical scene and transition lookup."
  },
  {
    id: "playhead-drives-selected-scene",
    passed: appSource.includes("findCompiledSceneAt(compiledTimeline, next)"),
    detail: "Project playhead selects the canonical scene."
  },
  {
    id: "playhead-drives-live-video",
    passed: appSource.includes("playheadMs - sceneStartMs") && appSource.includes("video.currentTime"),
    detail: "Scrubbing updates selected-card video time."
  },
  {
    id: "timeline-duration-mode",
    passed: appSource.includes("fit-primary-video"),
    detail: "Timeline exposes fixed and fit-primary-video duration modes."
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
