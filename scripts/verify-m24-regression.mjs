import {
  artifactRecords,
  commandLog,
  requirePassingGate,
  runProcess,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const gate = "G8-shared-regression";
const command = "node scripts/verify-m24-regression.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G7-menu-accessibility-performance");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g7", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const steps = [
    {
      id: "typecheck",
      command: process.execPath,
      args: ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"],
      timeoutMs: 5 * 60_000
    },
    {
      id: "full-vitest",
      command: process.execPath,
      args: ["node_modules/vitest/vitest.mjs", "--run"],
      timeoutMs: 10 * 60_000
    },
    {
      id: "m23-shared-regression",
      command: process.execPath,
      args: ["scripts/verify-m23-schema.mjs"],
      timeoutMs: 3 * 60_000
    },
    {
      id: "m23-canvas-regression",
      command: process.execPath,
      args: ["scripts/verify-m23-canvas.mjs"],
      timeoutMs: 3 * 60_000
    }
  ];
  for (const step of steps) {
    const result = await runProcess(step.command, step.args, { timeoutMs: step.timeoutMs });
    result.command = `${step.command} ${step.args.join(" ")}`;
    logs.push(commandLog(result));
    assertions.push({
      id: step.id,
      passed: result.exitCode === 0,
      detail: `${result.command} (exit=${result.exitCode})`
    });
    if (result.exitCode !== 0) break;
  }
}

const exitCode = assertions.every((item) => item.passed) ? 0 : 1;
const meta = await writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode,
  edition: "shared",
  status: predecessor.passed ? undefined : "blocked",
  artifacts: [
    ...(predecessor.artifact ? [predecessor.artifact] : []),
    ...(await artifactRecords([
      "package.json",
      "tsconfig.json",
      "scripts/verify-m23-schema.mjs",
      "scripts/verify-m23-canvas.mjs"
    ]))
  ],
  assertions,
  limitations: ["Lite/Pro source builds, packaged archive opens, and PNG/MP4 runtime exports are mandatory downstream gates G9-G13."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
