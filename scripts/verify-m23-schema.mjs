import path from "node:path";
import { runProcess, writeGateEvidence } from "./m23-evidence-helpers.mjs";

const gate = "G1-schema-round-trip";
const startedAt = new Date().toISOString();
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const testFiles = [
  "src/domain/m23Semantic.test.ts",
  "src/domain/media.test.ts",
  "src/storage/projectArchive.test.ts"
];
const test = await runProcess(process.execPath, [vitest, "--run", ...testFiles], { timeoutMs: 120_000 });
const assertions = [
  { id: "schema-tests-pass", passed: test.exitCode === 0, detail: `exit=${test.exitCode}` },
  {
    id: "round-trip-suite-ran",
    passed: test.stdout.includes("Test Files") && test.stdout.includes("3 passed"),
    detail: "All three semantic identity, normalization, and archive suites executed."
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
