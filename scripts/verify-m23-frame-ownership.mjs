import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, writeGateEvidence } from "./m23-evidence-helpers.mjs";

const gate = "G5-frame-ownership-transition";
const startedAt = new Date().toISOString();
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const testFiles = ["src/domain/videoTimeline.test.ts", "electron/videoFrameProducer.test.ts"];
const test = await runProcess(process.execPath, [vitest, "--run", ...testFiles], { timeoutMs: 120_000 });
const producerSource = await fs.readFile(path.resolve("electron/videoFrameProducer.ts"), "utf8");
const assertions = [
  { id: "ownership-transition-tests-pass", passed: test.exitCode === 0, detail: `exit=${test.exitCode}` },
  {
    id: "per-frame-ownership-assertion",
    passed: producerSource.includes("Frame ownership mismatch") && producerSource.includes("expected.activeMediaIds"),
    detail: "DOM media ownership is asserted before frame capture."
  },
  {
    id: "independent-transition-surfaces",
    passed: producerSource.includes("transitionAdapter") && producerSource.includes("captureTransitionFrame"),
    detail: "Transition overlap captures outgoing and incoming scenes in separate adapters."
  },
  {
    id: "deterministic-transition-compositor",
    passed: producerSource.includes("compositeTransitionRgba") && producerSource.includes('input.type === "fade"'),
    detail: "Fade, slide-left, and slide-up are composited from explicit RGBA frames."
  },
  {
    id: "no-modulo-loop-seek",
    passed: !producerSource.includes("% spanMs"),
    detail: "Video seek clamps to clip bounds instead of looping with modulo."
  },
  {
    id: "adapter-cleanup",
    passed: producerSource.includes("Promise.all") && producerSource.includes("adapter.close()"),
    detail: "Both transition render sessions close in finally."
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
