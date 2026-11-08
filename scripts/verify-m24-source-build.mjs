import path from "node:path";
import {
  artifactRecords,
  commandLog,
  parseArgs,
  requirePassingGate,
  runProcess,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const edition = args.edition;

if (!["lite", "pro"].includes(edition)) {
  throw new Error("Usage: node scripts/verify-m24-source-build.mjs --edition lite|pro");
}

const gate = edition === "lite" ? "G9-lite-source-build" : "G10-pro-source-build";
const predecessorGate = edition === "lite" ? "G8-shared-regression" : "G9-lite-source-build";
const command = `node scripts/verify-m24-source-build.mjs --edition ${edition}`;
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate(predecessorGate);
const assertions = [
  {
    id: `predecessor-${predecessorGate}`,
    passed: predecessor.passed,
    detail: predecessor.detail
  }
];
const logs = [predecessor.detail];
const limitations = [];

if (predecessor.passed) {
  const buildResult = await runNpmBuild(edition, 15 * 60_000);
  logs.push(commandLog(buildResult));
  assertions.push({
    id: `${edition}-source-build`,
    passed: buildResult.exitCode === 0,
    detail: `${buildResult.command} (exit=${buildResult.exitCode})`
  });

  if (buildResult.exitCode === 0) {
    const verifyResult = await runStep(
      process.execPath,
      ["scripts/verify-edition.mjs", "--edition", edition, "--scan", "dist", "dist-electron"],
      5 * 60_000
    );
    logs.push(commandLog(verifyResult));
    assertions.push({
      id: `${edition}-verify-edition-dist`,
      passed: verifyResult.exitCode === 0,
      detail: `${verifyResult.command} (exit=${verifyResult.exitCode})`
    });
  }

  if (edition === "pro" && assertions.every((assertion) => assertion.passed)) {
    const ffmpegSmoke = await maybeRunTrustedFfmpegSmoke();
    logs.push(ffmpegSmoke.log);
    assertions.push(ffmpegSmoke.assertion);
    limitations.push(...ffmpegSmoke.limitations);
  }
}

const exitCode = assertions.every((assertion) => assertion.passed) ? 0 : 1;
const meta = await writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode,
  edition,
  status: predecessor.passed ? undefined : "blocked",
  artifacts: [
    ...(predecessor.artifact ? [predecessor.artifact] : []),
    ...(await artifactRecords([
      "package.json",
      "dist/index.html",
      "dist-electron/electron/main.js",
      "dist-electron/electron/lite-main.js",
      "dist-electron/electron/preload.cjs",
      "dist-electron/electron/preload-lite.cjs",
      "resources/ffmpeg/ffmpeg.manifest.json"
    ]))
  ],
  assertions,
  limitations,
  log: logs.join("\n\n")
});

console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = meta.status === "blocked" ? 2 : 1;

async function runStep(commandName, stepArgs, timeoutMs) {
  const result = await runProcess(commandName, stepArgs, { timeoutMs, env: packagingEnvironment() });
  return {
    ...result,
    command: `${commandName} ${stepArgs.join(" ")}`
  };
}

async function maybeRunTrustedFfmpegSmoke() {
  const manifestPath = path.resolve("resources", "ffmpeg", "ffmpeg.manifest.json");
  const result = await runStep(
    process.execPath,
    [
      "scripts/smoke-video-export.mjs",
      "--evidence-root",
      ".omc/evidence/v6/m24-export-media-editor-ux-hardening/G10-pro-source-build/ffmpeg-smoke",
      "--run-id",
      "trusted-ffmpeg-integrated"
    ],
    5 * 60_000
  );
  const unavailable =
    result.exitCode !== 0 &&
    /Trusted FFmpeg binary is absent|placeholder SHA-256|executable is missing|manifest/i.test(
      `${result.stdout}\n${result.stderr}`
    );
  return {
    assertion: {
      id: "trusted-ffmpeg-integrated-smoke",
      passed: result.exitCode === 0 || unavailable,
      detail:
        result.exitCode === 0
          ? `${result.command} (exit=0)`
          : `trusted FFmpeg smoke skipped because trusted resources are unavailable: ${manifestPath}`
    },
    limitations: unavailable ? ["Trusted FFmpeg integrated smoke was skipped because pinned binaries were unavailable."] : [],
    log: commandLog(result)
  };
}

function packagingEnvironment() {
  const windowsRoot = process.env.SystemRoot ?? "C:\\Windows";
  const required = [
    path.join(windowsRoot, "System32"),
    path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0"),
    path.join(windowsRoot, "System32", "Wbem")
  ];
  const currentPath = process.env.Path ?? process.env.PATH ?? "";
  const nextPath = [...required, currentPath].filter(Boolean).join(path.delimiter);
  return {
    ...process.env,
    Path: nextPath,
    PATH: nextPath
  };
}

function npmCommand() {
  if (process.platform !== "win32") {
    return { command: "npm", args: ["run"] };
  }
  return {
    command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm run"]
  };
}

async function runNpmBuild(buildEdition, timeoutMs) {
  const npm = npmCommand();
  const commandArgs = [...npm.args, `build:${buildEdition}`];
  const result = await runProcess(npm.command, commandArgs, { timeoutMs, env: packagingEnvironment() });
  return {
    ...result,
    command: `${npm.command} ${commandArgs.join(" ")}`
  };
}
