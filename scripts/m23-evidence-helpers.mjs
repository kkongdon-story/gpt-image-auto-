import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseArgs,
  pathExists,
  runProcess,
  sha256,
  writeJson
} from "./m22-evidence-helpers.mjs";

export { parseArgs, pathExists, runProcess, sha256, writeJson };

export const m23EvidenceRoot = ".omc/evidence/v6/m23-canvas-video-timeline-hardening";

export async function collectM23Context() {
  const [commitResult, statusResult] = await Promise.all([
    runProcess("git", ["rev-parse", "HEAD"], { timeoutMs: 10000 }),
    runProcess("git", ["status", "--porcelain=v1"], { timeoutMs: 10000 })
  ]);
  const status = statusResult.stdout.trim();
  return {
    sourceCommit: commitResult.exitCode === 0 ? commitResult.stdout.trim() : null,
    dirtyDigest: createHash("sha256").update(status, "utf8").digest("hex"),
    machine: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      hostname: os.hostname()
    }
  };
}

export async function artifactRecord(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  return {
    path: absolutePath,
    size: stat.size,
    sha256: await sha256(absolutePath)
  };
}

export async function writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode,
  edition = "shared",
  inputs = [],
  outputs = [],
  assertions = [],
  log = "",
  verdict
}) {
  const evidenceRoot = path.resolve(m23EvidenceRoot);
  await fs.mkdir(evidenceRoot, { recursive: true });
  const context = await collectM23Context();
  const finalVerdict =
    verdict ??
    (exitCode === 0 && assertions.length > 0 && assertions.every((assertion) => assertion.passed === true)
      ? "pass"
      : "fail");
  const meta = {
    schemaVersion: 1,
    milestone: "M23",
    gate,
    startedAt,
    finishedAt: new Date().toISOString(),
    command,
    cwd: process.cwd(),
    exitCode,
    sourceCommit: context.sourceCommit,
    dirtyDigest: context.dirtyDigest,
    edition,
    machine: context.machine,
    inputs,
    outputs,
    assertions,
    verdict: finalVerdict
  };
  await Promise.all([
    fs.writeFile(path.join(evidenceRoot, `${gate}.log`), log.endsWith("\n") ? log : `${log}\n`, "utf8"),
    writeJson(path.join(evidenceRoot, `${gate}.meta.json`), meta)
  ]);
  return meta;
}
