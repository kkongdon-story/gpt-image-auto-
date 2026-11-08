import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultEvidenceRoot,
  findFiles,
  hasForbiddenToken,
  isBinaryCandidate,
  isPlaceholderSha,
  parseArgs,
  pathExists,
  readJson,
  sha256,
  toPortablePath,
  writeJson
} from "./m22-evidence-helpers.mjs";

const root = process.cwd();
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  const evidenceRoot = path.resolve(options.evidenceRoot ?? defaultEvidenceRoot);
  const outputPath = path.resolve(options.output ?? path.join(evidenceRoot, "audit-result.json"));
  const result = await verifyM22Evidence({ evidenceRoot });
  await writeJson(outputPath, result);
  console.log(JSON.stringify(result));
  if (result.result !== "pass") {
    process.exitCode = 1;
  }
}

export async function verifyM22Evidence({ evidenceRoot = path.resolve(defaultEvidenceRoot) } = {}) {
  const checks = [];
  const startedAt = new Date().toISOString();
  await checkResourceContract(checks);
  await checkThirdPartyNotice(checks);
  await checkEvidenceArtifacts(checks, evidenceRoot);
  const failures = checks.filter((check) => check.result === "fail");
  return {
    schemaVersion: 1,
    result: failures.length === 0 ? "pass" : "fail",
    startedAt,
    completedAt: new Date().toISOString(),
    evidenceRoot,
    failed: failures.length,
    passed: checks.length - failures.length,
    checks
  };
}

async function checkResourceContract(checks) {
  const resourceRoot = path.join(root, "resources", "ffmpeg");
  const schemaPath = path.join(resourceRoot, "ffmpeg.manifest.schema.json");
  const placeholderPath = path.join(resourceRoot, "ffmpeg.manifest.placeholder.json");
  const manifestPath = path.join(resourceRoot, "ffmpeg.manifest.json");
  const readmePath = path.join(resourceRoot, "README.md");
  const licensePath = path.join(resourceRoot, "LICENSE.txt");
  const requiredFiles = [schemaPath, placeholderPath, manifestPath, readmePath, licensePath];
  for (const filePath of requiredFiles) {
    await recordFileExists(checks, filePath, `resource:${path.basename(filePath)}`);
  }
  if (!(await Promise.all(requiredFiles.map(pathExists))).every(Boolean)) {
    return;
  }

  const schema = await readJson(schemaPath);
  for (const field of [
    "schemaVersion",
    "binaryPresent",
    "trustStatus",
    "executableRelativePath",
    "sha256",
    "versionPattern",
    "requiredEncoders",
    "forbiddenBuildConfigurationTokens",
    "licenseNotice",
    "sourceOfferUrl",
    "buildRecipeUrl",
    "provenance"
  ]) {
    record(checks, `schema-required-${field}`, schema.required?.includes(field), `Schema must require ${field}.`);
  }

  const placeholder = await readJson(placeholderPath);
  record(checks, "placeholder-binary-absent", placeholder.binaryPresent === false, "Placeholder must explicitly mark the binary absent.");
  record(
    checks,
    "placeholder-not-trusted",
    placeholder.trustStatus === "placeholder-only-not-approved",
    "Placeholder must not be marked as trusted."
  );
  record(checks, "placeholder-zero-sha", isPlaceholderSha(placeholder.sha256), "Placeholder SHA must remain all zeroes.");
  record(
    checks,
    "manifest-required-encoders",
    Array.isArray(placeholder.requiredEncoders) &&
      placeholder.requiredEncoders.includes("h264_mf") &&
      placeholder.requiredEncoders.includes("aac"),
    "Manifest must require h264_mf and aac."
  );
  const manifest = await readJson(manifestPath);
  record(checks, "manifest-binary-present", manifest.binaryPresent === true, "Release manifest must mark the binary present.");
  record(checks, "manifest-trusted", manifest.trustStatus === "trusted-pinned-lgpl-build", "Release manifest must be trusted and pinned.");
  record(checks, "manifest-real-sha", !isPlaceholderSha(manifest.sha256), "Release manifest must pin a real FFmpeg SHA.");
  record(checks, "manifest-real-probe-sha", !isPlaceholderSha(manifest.probeSha256), "Release manifest must pin a real FFprobe SHA.");
  for (const token of ["--enable-gpl", "--enable-nonfree", "--enable-libx264"]) {
    record(
      checks,
      `manifest-forbidden-token-${token}`,
      manifest.forbiddenBuildConfigurationTokens?.includes(token),
      `Manifest must scan for ${token}.`
    );
  }

  const readme = await fs.readFile(readmePath, "utf8");
  for (const text of ["-buildconf", "-encoders", "h264_mf", "aac", "--enable-gpl", "--enable-nonfree", "--enable-libx264"]) {
    record(checks, `readme-guidance-${text}`, readme.includes(text), `README must document ${text}.`);
  }
  record(
    checks,
    "readme-pinned-binary-guidance",
    /packages a reviewed|fully pinned by SHA-256/i.test(readme),
    "README must document the reviewed pinned binary."
  );
  record(
    checks,
    "readme-source-build-url",
    readme.includes("https://github.com/BtbN/FFmpeg-Builds") && readme.includes("https://ffmpeg.org/releases/"),
    "README must include source offer and build guidance URLs."
  );

  const files = await findFiles(resourceRoot);
  const binaries = files.filter((filePath) => isBinaryCandidate(filePath));
  record(checks, "resource-binary-count", binaries.length === 2, `Expected exactly ffmpeg.exe and ffprobe.exe; found ${binaries.length}.`);

  const executablePath = path.resolve(resourceRoot, "..", manifest.executableRelativePath);
  const probePath = path.resolve(resourceRoot, "..", manifest.probeRelativePath);
  await recordFileExists(checks, executablePath, "ffmpeg-binary");
  await recordFileExists(checks, probePath, "ffprobe-binary");
  if (await pathExists(executablePath)) {
    record(checks, "binary-hash-matches-manifest", (await sha256(executablePath)) === manifest.sha256, "FFmpeg hash must match manifest.");
  }
  if (await pathExists(probePath)) {
    record(checks, "probe-hash-matches-manifest", (await sha256(probePath)) === manifest.probeSha256, "FFprobe hash must match manifest.");
  }
}

async function checkThirdPartyNotice(checks) {
  const noticePath = path.join(root, "THIRD_PARTY_NOTICES.md");
  await recordFileExists(checks, noticePath, "third-party-notices");
  if (!(await pathExists(noticePath))) {
    return;
  }
  const text = await fs.readFile(noticePath, "utf8");
  record(checks, "third-party-m22-section", text.includes("## M22 FFmpeg and FFprobe"), "THIRD_PARTY_NOTICES must include M22 FFmpeg section.");
  record(checks, "third-party-binary-claim", /bundle the static `ffmpeg\.exe` and `ffprobe\.exe`/i.test(text), "Notice must describe bundled binaries.");
  record(checks, "third-party-lgpl-source", text.includes("https://ffmpeg.org/releases/"), "Notice must include FFmpeg source offer URL.");
}

async function checkEvidenceArtifacts(checks, evidenceRoot) {
  const currentPath = path.join(evidenceRoot, "current.json");
  await recordFileExists(checks, currentPath, "evidence-current");
  if (!(await pathExists(currentPath))) {
    return;
  }
  const current = await readJson(currentPath);
  record(checks, "current-schema", current.schemaVersion === 1, "current.json must use schemaVersion 1.");
  record(checks, "current-run-id", typeof current.currentRun === "string" && current.currentRun.length > 0, "current.json must name currentRun.");
  const runDir = current.currentRun ? path.resolve(evidenceRoot, current.currentRun) : evidenceRoot;
  record(checks, "current-run-dir-inside-root", isInside(evidenceRoot, runDir), "currentRun must stay under evidence root.");
  await recordFileExists(checks, path.join(runDir, "meta.json"), "evidence-meta");
  await recordFileExists(checks, path.join(runDir, "smoke.log"), "evidence-smoke-log");
  if (await pathExists(path.join(runDir, "smoke.log"))) {
    const stat = await fs.stat(path.join(runDir, "smoke.log"));
    record(checks, "evidence-smoke-log-nonempty", stat.size > 0, "smoke.log must not be empty.");
  }
  if (await pathExists(path.join(runDir, "meta.json"))) {
    const meta = await readJson(path.join(runDir, "meta.json"));
    record(checks, "meta-schema", meta.schemaVersion === 1, "meta.json must use schemaVersion 1.");
    record(checks, "meta-result-not-fail", meta.result !== "fail", `meta.json records failure: ${meta.error ?? "unknown failure"}`);
    record(
      checks,
      "meta-does-not-hide-absent-binary",
      meta.result !== "pass" || meta.binaryPresent === true,
      "Passing evidence must come from a present trusted binary."
    );
  }

  const jsonFiles = (await findFiles(runDir, { maxDepth: 2 })).filter((filePath) => path.extname(filePath).toLowerCase() === ".json");
  for (const jsonPath of jsonFiles) {
    const value = await readJson(jsonPath);
    if (value?.result === "fail" || value?.ok === false) {
      record(
        checks,
        `json-failure-${toPortablePath(path.relative(runDir, jsonPath))}`,
        false,
        `${path.relative(runDir, jsonPath)} records a failure.`
      );
    }
  }
}

async function recordFileExists(checks, filePath, id) {
  record(checks, id, await pathExists(filePath), `${toPortablePath(path.relative(root, filePath))} must exist.`);
}

function record(checks, id, passed, detail) {
  checks.push({ id, result: passed ? "pass" : "fail", detail });
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
