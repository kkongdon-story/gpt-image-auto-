import { writeGateEvidence } from "./m23-evidence-helpers.mjs";

const startedAt = new Date().toISOString();
const meta = await writeGateEvidence({
  gate: "G10-clean-vm-install-smoke",
  command: "node scripts/record-m23-vm-gate.mjs",
  startedAt,
  exitCode: 2,
  edition: "lite+pro",
  assertions: [{
    id: "clean-windows-vm",
    passed: false,
    detail: "A clean Windows VM without Node, npm, or the source workspace was not available in this session."
  }],
  log: [
    "BLOCKED: clean Windows VM evidence was not fabricated.",
    "Required follow-up: install both M23 installers in a clean Windows VM, launch, render PNG, preview/export MP4, uninstall, and verify no residue."
  ].join("\n"),
  verdict: "blocked"
});

console.log(JSON.stringify(meta));
process.exitCode = 2;
