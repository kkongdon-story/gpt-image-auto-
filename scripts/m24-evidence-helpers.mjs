import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseArgs,
  pathExists,
  readJson,
  runProcess,
  sha256,
  writeJson
} from "./m22-evidence-helpers.mjs";

export { parseArgs, pathExists, readJson, runProcess, sha256, writeJson };

export const m24EvidenceRoot = ".omc/evidence/v6/m24-export-media-editor-ux-hardening";

export async function collectM24Context() {
  const [commitResult, statusResult] = await Promise.all([
    runProcess("git", ["rev-parse", "HEAD"], { timeoutMs: 10000 }),
    runProcess("git", ["status", "--porcelain=v1"], { timeoutMs: 10000 })
  ]);
  const status = statusResult.stdout.trim();
  return {
    commit: commitResult.exitCode === 0 ? commitResult.stdout.trim() : null,
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

export async function artifactRecords(filePaths) {
  const records = [];
  for (const filePath of filePaths) {
    if (await pathExists(filePath)) records.push(await artifactRecord(filePath));
  }
  return records;
}

export async function readText(filePath) {
  return fs.readFile(path.resolve(filePath), "utf8");
}

export async function existingPaths(filePaths) {
  const existing = [];
  for (const filePath of filePaths) {
    if (await pathExists(filePath)) existing.push(filePath);
  }
  return existing;
}

export async function runVitest(testFiles, timeoutMs = 180_000) {
  const vitest = path.resolve("node_modules/vitest/vitest.mjs");
  const args = [vitest, "--run", ...testFiles];
  const result = await runProcess(process.execPath, args, { timeoutMs });
  return {
    ...result,
    command: `${process.execPath} ${args.join(" ")}`
  };
}

export async function requirePassingGate(gate) {
  const metaPath = path.resolve(m24EvidenceRoot, gate, `${gate}.meta.json`);
  if (!(await pathExists(metaPath))) {
    return { passed: false, detail: `Missing predecessor metadata: ${metaPath}` };
  }
  try {
    const [meta, context] = await Promise.all([readJson(metaPath), collectM24Context()]);
    if (meta.status !== "pass" || meta.exitCode !== 0) {
      return {
        passed: false,
        detail: `Predecessor ${gate} is ${meta.status} (exit=${meta.exitCode}).`
      };
    }
    if (meta.commit && context.commit && meta.commit !== context.commit) {
      return {
        passed: false,
        detail: `Predecessor ${gate} commit ${meta.commit} differs from ${context.commit}.`
      };
    }
    return {
      passed: true,
      detail: `Predecessor ${gate} passed at commit ${meta.commit ?? "unknown"}.`,
      artifact: await artifactRecord(metaPath)
    };
  } catch (error) {
    return {
      passed: false,
      detail: `Invalid predecessor metadata for ${gate}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function sourceContains(id, source, needles, detail) {
  const required = Array.isArray(needles) ? needles : [needles];
  const missing = required.filter((needle) => !source.includes(needle));
  return {
    id,
    passed: missing.length === 0,
    detail: missing.length === 0 ? detail : `${detail} Missing: ${missing.join(", ")}`
  };
}

export function sourceExcludes(id, source, needles, detail) {
  const prohibited = Array.isArray(needles) ? needles : [needles];
  const found = prohibited.filter((needle) => source.includes(needle));
  return {
    id,
    passed: found.length === 0,
    detail: found.length === 0 ? detail : `${detail} Found: ${found.join(", ")}`
  };
}

export function commandLog(result) {
  return `$ ${result.command}\n${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export async function writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode,
  edition = "shared",
  artifacts = [],
  assertions = [],
  limitations = [],
  log = "",
  status
}) {
  const gateRoot = path.resolve(m24EvidenceRoot, gate);
  await fs.mkdir(gateRoot, { recursive: true });
  const context = await collectM24Context();
  const finishedAt = new Date().toISOString();
  const finalStatus =
    status ??
    (exitCode === 0 && assertions.length > 0 && assertions.every((assertion) => assertion.passed === true)
      ? "pass"
      : "fail");
  const meta = {
    schemaVersion: 1,
    milestone: "M24",
    gate,
    edition,
    status: finalStatus,
    startedAt,
    finishedAt,
    commit: context.commit,
    dirtyDigest: context.dirtyDigest,
    command,
    exitCode,
    machine: context.machine,
    artifacts,
    assertions,
    limitations
  };
  const standardLog = [
    `milestone=M24`,
    `gate=${gate}`,
    `edition=${edition}`,
    `command=${command}`,
    `cwd=${process.cwd()}`,
    `node=${process.version}`,
    `platform=${context.machine.platform} ${context.machine.release} ${context.machine.arch}`,
    `startedAt=${startedAt}`,
    `finishedAt=${finishedAt}`,
    `exitCode=${exitCode}`,
    `status=${finalStatus}`,
    "",
    log
  ].join("\n");
  await Promise.all([
    fs.writeFile(
      path.join(gateRoot, "run.log"),
      standardLog.endsWith("\n") ? standardLog : `${standardLog}\n`,
      "utf8"
    ),
    writeJson(path.join(gateRoot, `${gate}.meta.json`), meta)
  ]);
  return meta;
}
