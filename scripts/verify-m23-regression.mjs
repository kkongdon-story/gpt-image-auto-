import path from "node:path";
import {
  m23EvidenceRoot,
  runProcess,
  writeGateEvidence
} from "./m23-evidence-helpers.mjs";

const startedAt = new Date().toISOString();
const commands = [
  [process.execPath, ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"]],
  [process.execPath, ["node_modules/vitest/vitest.mjs", "--run"]],
  [process.execPath, ["scripts/build-edition.mjs", "lite"]],
  [process.execPath, ["scripts/verify-edition.mjs", "--edition", "lite", "--scan", "dist", "dist-electron"]],
  [process.execPath, ["scripts/build-edition.mjs", "pro"]]
];

const logs = [];
const assertions = [];
let exitCode = 0;

for (const [command, args] of commands) {
  const label = `${command} ${args.join(" ")}`;
  const result = await runProcess(command, args, { timeoutMs: 15 * 60 * 1000 });
  logs.push(`$ ${label}\n${result.stdout}${result.stderr}`);
  assertions.push({
    id: `command-${assertions.length + 1}`,
    passed: result.exitCode === 0,
    detail: `${label} (exit=${result.exitCode})`
  });
  if (result.exitCode !== 0) {
    exitCode = result.exitCode;
    break;
  }
}

const meta = await writeGateEvidence({
  gate: "G7-regression-editions-security",
  command: "node scripts/verify-m23-regression.mjs",
  startedAt,
  exitCode,
  edition: "lite+pro",
  outputs: [
    { path: path.resolve(m23EvidenceRoot, "G7-regression-editions-security.log") }
  ],
  assertions,
  log: logs.join("\n"),
  verdict: exitCode === 0 ? "pass" : "fail"
});

console.log(JSON.stringify(meta));
process.exitCode = exitCode;
