import path from "node:path";
import {
  artifactRecord,
  artifactRecords,
  m24EvidenceRoot,
  parseArgs,
  pathExists,
  readJson,
  writeGateEvidence,
  writeJson
} from "./m24-evidence-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const passRequested = args.status === "pass" || args.pass === true || args.pass === "true";
const evidencePath = args.evidence ? path.resolve(args.evidence) : null;
const packageStatePath = path.resolve(m24EvidenceRoot, "package-state.json");
const vmEvidencePath = path.resolve(m24EvidenceRoot, "G13-clean-vm-stage-handoff", "clean-vm-gate.meta.json");
const startedAt = new Date().toISOString();
const assertions = [];
const artifacts = [];

const state = (await pathExists(packageStatePath)) ? await readJson(packageStatePath) : null;
assertions.push({
  id: "isolated-package-state-present",
  passed: Boolean(state?.artifacts),
  detail: state?.runRoot ?? "Missing M24 package-state.json; run isolated package first."
});

if (evidencePath) {
  const exists = await pathExists(evidencePath);
  assertions.push({
    id: "clean-vm-evidence-file-present",
    passed: exists,
    detail: evidencePath
  });
  if (exists) artifacts.push(await artifactRecord(evidencePath));
} else {
  assertions.push({
    id: "clean-vm-evidence-file-present",
    passed: false,
    detail: "Provide --evidence <file> from a clean Windows VM run."
  });
}

if (state?.artifacts) {
  artifacts.push(...(await artifactRecords(Object.values(state.artifacts))));
}

assertions.push({
  id: "clean-vm-pass-explicit",
  passed: passRequested,
  detail: passRequested
    ? "Operator recorded clean Windows VM pass."
    : "Clean Windows VM evidence was not marked pass; blocked evidence recorded instead."
});

const exitCode = assertions.every((assertion) => assertion.passed) ? 0 : 2;
const status = exitCode === 0 ? "pass" : "blocked";
const meta = await writeGateEvidence({
  gate: "G13-clean-vm-stage-handoff",
  command: "node scripts/record-m24-vm-gate.mjs",
  startedAt,
  exitCode,
  edition: "lite+pro",
  status,
  artifacts,
  assertions,
  log: [
    status === "pass"
      ? "Clean Windows VM pass evidence recorded for M24 staging."
      : "BLOCKED: clean Windows VM evidence was not fabricated.",
    "Required VM scenario: install both M24 installers in a clean Windows VM, launch, render PNG, verify/export trusted FFmpeg MP4 when available, uninstall, and verify no residue.",
    state?.runRoot ? `isolatedRunRoot=${state.runRoot}` : "isolatedRunRoot=missing",
    evidencePath ? `vmEvidence=${evidencePath}` : "vmEvidence=missing"
  ].join("\n")
});

await writeJson(vmEvidencePath, meta);
console.log(JSON.stringify(meta));
process.exitCode = exitCode;
