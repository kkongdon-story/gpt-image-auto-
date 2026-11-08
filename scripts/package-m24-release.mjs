import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  artifactRecord,
  artifactRecords,
  commandLog,
  m24EvidenceRoot,
  parseArgs,
  pathExists,
  readJson,
  requirePassingGate,
  runProcess,
  sha256,
  writeGateEvidence,
  writeJson
} from "./m24-evidence-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
const statePath = path.resolve(m24EvidenceRoot, "package-state.json");
const g12StatePath = path.resolve(m24EvidenceRoot, "G12-portable-installed-smoke", "g12-state.json");
const vmEvidencePath = path.resolve(m24EvidenceRoot, "G13-clean-vm-stage-handoff", "clean-vm-gate.meta.json");

if (!["isolated", "portable-smoke", "installed-smoke", "stage"].includes(phase)) {
  throw new Error(
    "Usage: node scripts/package-m24-release.mjs --phase isolated|portable-smoke|installed-smoke|stage [--require-vm-evidence]"
  );
}

if (phase === "isolated") {
  await packageIsolated();
} else if (phase === "portable-smoke") {
  await smokePortable();
} else if (phase === "installed-smoke") {
  await smokeInstalled();
} else {
  await stageRelease();
}

async function packageIsolated() {
  const startedAt = new Date().toISOString();
  const predecessor = await requirePassingGate("G10-pro-source-build");
  const logs = [predecessor.detail];
  const assertions = [{ id: "predecessor-G10-pro-source-build", passed: predecessor.passed, detail: predecessor.detail }];
  const runId = `m24-release-${timestamp()}`;
  const runRoot = path.resolve(".omc", "build", "m24", runId);
  const liteRoot = path.join(runRoot, "Lite");
  const proRoot = path.join(runRoot, "Pro");
  const artifacts = buildArtifactPaths(liteRoot, proRoot);

  let exitCode = predecessor.passed ? 0 : 2;
  if (predecessor.passed) {
    await fs.mkdir(runRoot, { recursive: true });
    const npm = npmInvocation();
    const commands = [
      ["lite-build", npm.command, [...npm.args, "build:lite"]],
      [
        "lite-package",
        process.execPath,
        [
          "node_modules/electron-builder/out/cli/cli.js",
          "--win",
          "nsis",
          "--config",
          "electron-builder.lite.json",
          `--config.directories.output=${liteRoot}`
        ]
      ],
      ["pro-build", npm.command, [...npm.args, "build:pro"]],
      ["pro-prepare", process.execPath, ["scripts/prepare-pro-package.mjs"]],
      [
        "pro-package",
        process.execPath,
        [
          "node_modules/electron-builder/out/cli/cli.js",
          "--win",
          "nsis",
          "--config",
          "electron-builder.pro.json",
          `--config.directories.output=${proRoot}`
        ]
      ]
    ];

    for (const [id, commandName, commandArgs] of commands) {
      const result = await runLogged(commandName, commandArgs, 30 * 60_000);
      logs.push(commandLog(result));
      assertions.push({ id, passed: result.exitCode === 0, detail: `${result.command} (exit=${result.exitCode})` });
      if (result.exitCode !== 0) {
        exitCode = result.exitCode;
        break;
      }
    }

    for (const [id, filePath] of Object.entries(artifacts)) {
      assertions.push({ id, passed: await pathExists(filePath), detail: filePath });
    }

    if (assertions.every((assertion) => assertion.passed)) {
      const securityOutput = path.join(runRoot, "package-security.json");
      const security = await runLogged(
        process.execPath,
        [
          "scripts/verify-package-security.mjs",
          "--lite-asar",
          artifacts.liteAsar,
          "--pro-asar",
          artifacts.proAsar,
          "--lite-exe",
          artifacts.liteExe,
          "--pro-exe",
          artifacts.proExe,
          "--lite-installer",
          artifacts.liteInstaller,
          "--pro-installer",
          artifacts.proInstaller,
          "--output",
          securityOutput
        ],
        10 * 60_000
      );
      logs.push(commandLog(security));
      artifacts.packageSecurity = securityOutput;
      assertions.push({
        id: "package-security",
        passed: security.exitCode === 0,
        detail: `${securityOutput} (exit=${security.exitCode})`
      });
      exitCode = security.exitCode;
    }
  }

  const artifactList = await existingArtifactRecords(Object.values(artifacts));
  const state = {
    schemaVersion: 1,
    milestone: "M24",
    runId,
    runRoot,
    liteRoot,
    proRoot,
    artifacts,
    artifactHashes: Object.fromEntries(artifactList.map((item) => [path.basename(item.path), item.sha256])),
    updatedAt: new Date().toISOString()
  };
  if (predecessor.passed) await writeJson(statePath, state);

  const meta = await writeGateEvidence({
    gate: "G11-isolated-package",
    command: "node scripts/package-m24-release.mjs --phase isolated",
    startedAt,
    exitCode,
    edition: "lite+pro",
    status: predecessor.passed ? undefined : "blocked",
    artifacts: [...(predecessor.artifact ? [predecessor.artifact] : []), ...artifactList],
    assertions,
    log: logs.join("\n\n")
  });
  console.log(JSON.stringify(meta));
  if (meta.status !== "pass") process.exitCode = meta.status === "blocked" ? 2 : 1;
}

async function smokePortable() {
  const startedAt = new Date().toISOString();
  const predecessor = await requirePassingGate("G11-isolated-package");
  const state = await readPackageState();
  const { assertions, logs, artifacts, exitCode } = predecessor.passed
    ? await runPortableSmoke(state)
    : {
        assertions: [],
        logs: [],
        artifacts: [],
        exitCode: 2
      };
  const allAssertions = [
    { id: "predecessor-G11-isolated-package", passed: predecessor.passed, detail: predecessor.detail },
    ...assertions
  ];
  const g12State = {
    schemaVersion: 1,
    portable: {
      status: exitCode === 0 && assertions.every((assertion) => assertion.passed) ? "pass" : "fail",
      assertions,
      artifacts
    },
    installed: null,
    updatedAt: new Date().toISOString()
  };
  await writeJson(g12StatePath, g12State);
  const meta = await writeGateEvidence({
    gate: "G12-portable-installed-smoke",
    command: "node scripts/package-m24-release.mjs --phase portable-smoke",
    startedAt,
    exitCode,
    edition: "lite+pro",
    status: predecessor.passed && g12State.portable.status === "pass" ? "partial" : "blocked",
    artifacts: [...(predecessor.artifact ? [predecessor.artifact] : []), ...artifacts],
    assertions: allAssertions,
    limitations: ["G12 is partial after portable-smoke; run installed-smoke to produce final pass evidence."],
    log: [predecessor.detail, ...logs].join("\n\n")
  });
  console.log(JSON.stringify(meta));
  process.exitCode = predecessor.passed && g12State.portable.status === "pass" ? 0 : meta.status === "blocked" ? 2 : 1;
}

async function smokeInstalled() {
  const startedAt = new Date().toISOString();
  const predecessor = await requirePassingGate("G11-isolated-package");
  const state = await readPackageState();
  const prior = (await pathExists(g12StatePath)) ? await readJson(g12StatePath) : null;
  const portablePassed = prior?.portable?.status === "pass";
  const prerequisiteAssertions = [
    { id: "predecessor-G11-isolated-package", passed: predecessor.passed, detail: predecessor.detail },
    {
      id: "portable-smoke-prior-pass",
      passed: portablePassed,
      detail: portablePassed ? "portable-smoke phase passed" : "Run portable-smoke before installed-smoke."
    }
  ];
  const installed = predecessor.passed && portablePassed
    ? await runInstalledSmoke(state)
    : { assertions: [], logs: [], artifacts: [], exitCode: 2 };
  const installedStatus =
    installed.exitCode === 0 && installed.assertions.every((assertion) => assertion.passed) ? "pass" : "fail";
  const g12State = {
    schemaVersion: 1,
    portable: prior?.portable ?? null,
    installed: {
      status: installedStatus,
      assertions: installed.assertions,
      artifacts: installed.artifacts
    },
    updatedAt: new Date().toISOString()
  };
  await writeJson(g12StatePath, g12State);
  const assertions = [
    ...prerequisiteAssertions,
    ...(prior?.portable?.assertions ?? []),
    ...installed.assertions
  ];
  const artifacts = [
    ...(predecessor.artifact ? [predecessor.artifact] : []),
    ...(prior?.portable?.artifacts ?? []),
    ...installed.artifacts
  ];
  const finalPass = predecessor.passed && portablePassed && installedStatus === "pass";
  const meta = await writeGateEvidence({
    gate: "G12-portable-installed-smoke",
    command: "node scripts/package-m24-release.mjs --phase installed-smoke",
    startedAt,
    exitCode: finalPass ? 0 : installed.exitCode || 1,
    edition: "lite+pro",
    status: finalPass ? "pass" : "blocked",
    artifacts,
    assertions,
    log: [predecessor.detail, ...(prior?.portable?.logs ?? []), ...installed.logs].join("\n\n")
  });
  console.log(JSON.stringify(meta));
  if (meta.status !== "pass") process.exitCode = meta.status === "blocked" ? 2 : 1;
}

async function stageRelease() {
  const startedAt = new Date().toISOString();
  const predecessor = await requirePassingGate("G12-portable-installed-smoke");
  const state = await readPackageState();
  const requireVm = args.requireVmEvidence === true || args.requireVmEvidence === "true";
  const assertions = [{ id: "predecessor-G12-portable-installed-smoke", passed: predecessor.passed, detail: predecessor.detail }];
  const logs = [predecessor.detail];
  let exitCode = predecessor.passed ? 0 : 2;
  let status = predecessor.passed ? undefined : "blocked";
  const artifacts = predecessor.artifact ? [predecessor.artifact] : [];

  const vmEvidence = (await pathExists(vmEvidencePath)) ? await readJson(vmEvidencePath) : null;
  const vmPassed = vmEvidence?.status === "pass" && vmEvidence?.exitCode === 0;
  assertions.push({
    id: "clean-vm-pass-evidence",
    passed: vmPassed,
    detail: vmPassed ? `Clean VM evidence present: ${vmEvidencePath}` : "Clean Windows VM pass evidence is missing."
  });

  if (requireVm && (!predecessor.passed || !vmPassed)) {
    const meta = await writeGateEvidence({
      gate: "G13-clean-vm-stage-handoff",
      command: "node scripts/package-m24-release.mjs --phase stage --require-vm-evidence",
      startedAt,
      exitCode: 2,
      edition: "lite+pro",
      status: "blocked",
      artifacts,
      assertions,
      log: [`Staging refused before release/ writes. Isolated artifacts remain at ${state.runRoot}.`, ...logs].join("\n")
    });
    console.log(JSON.stringify(meta));
    process.exitCode = 2;
    return;
  }
  if (!requireVm) {
    throw new Error("M24 staging without --require-vm-evidence is intentionally unsupported.");
  }

  const stageRoot = path.resolve("release", `M24-${timestamp()}`);
  await fs.mkdir(stageRoot, { recursive: false });
  const stagedArtifacts = [];
  for (const [name, sourcePath] of Object.entries(stageCopyArtifacts(state.artifacts))) {
    const destination = path.join(stageRoot, path.basename(sourcePath));
    await fs.copyFile(sourcePath, destination);
    const sourceHash = await sha256(sourcePath);
    const stagedHash = await sha256(destination);
    assertions.push({
      id: `${name}-staged-hash-match`,
      passed: sourceHash === stagedHash,
      detail: `${destination} sha256=${stagedHash}`
    });
    stagedArtifacts.push(await artifactRecord(destination));
  }

  exitCode = assertions.every((assertion) => assertion.passed) ? 0 : 1;
  status = exitCode === 0 ? "pass" : "fail";
  const manifestPath = path.join(stageRoot, "m24-release-manifest.json");
  await writeJson(manifestPath, {
    schemaVersion: 1,
    milestone: "M24",
    stageRoot,
    isolatedRunRoot: state.runRoot,
    stagedAt: new Date().toISOString(),
    artifacts: stagedArtifacts,
    cleanVmEvidence: vmEvidencePath
  });
  stagedArtifacts.push(await artifactRecord(manifestPath));

  const meta = await writeGateEvidence({
    gate: "G13-clean-vm-stage-handoff",
    command: "node scripts/package-m24-release.mjs --phase stage --require-vm-evidence",
    startedAt,
    exitCode,
    edition: "lite+pro",
    status,
    artifacts: [...artifacts, ...(await artifactRecords([vmEvidencePath])), ...stagedArtifacts],
    assertions,
    log: [`stagedRoot=${stageRoot}`, ...logs].join("\n")
  });
  console.log(JSON.stringify(meta));
  if (meta.status !== "pass") process.exitCode = 1;
}

async function runPortableSmoke(state) {
  const assertions = [];
  const logs = [];
  const artifacts = [];
  let exitCode = 0;
  for (const edition of ["lite", "pro"]) {
    const exePath = state.artifacts[`${edition}Exe`];
    const profilePath = path.join(state.runRoot, `portable-profile-${edition}`);
    await fs.rm(profilePath, { recursive: true, force: true });
    await fs.mkdir(profilePath, { recursive: true });
    const launch = await launchSmoke(exePath, profilePath);
    logs.push(`${edition}-portable-launch: ${JSON.stringify(launch)}`);
    assertions.push({
      id: `${edition}-portable-fresh-profile-launch`,
      passed: launch.started && launch.aliveAfterDelay && launch.closed,
      detail: JSON.stringify(launch)
    });
    if (!launch.started || !launch.aliveAfterDelay || !launch.closed) exitCode = 1;

    const renderArtifacts = await runPackagedRender({
      edition,
      exePath,
      resultPath: path.join(state.runRoot, `${edition}-portable-render.json`),
      screenshotPath: path.join(state.runRoot, `${edition}-portable-render.png`),
      profilePath: path.join(state.runRoot, `portable-render-profile-${edition}`)
    });
    logs.push(renderArtifacts.log);
    assertions.push(renderArtifacts.assertion);
    artifacts.push(...renderArtifacts.artifacts);
    if (!renderArtifacts.assertion.passed) exitCode = 1;
  }
  return { assertions, logs, artifacts, exitCode };
}

async function runInstalledSmoke(state) {
  const assertions = [];
  const logs = [];
  const artifacts = [];
  let exitCode = 0;
  for (const edition of ["lite", "pro"]) {
    const installerPath = state.artifacts[`${edition}Installer`];
    const installRoot = path.join(state.runRoot, `installed-${edition}`);
    await fs.rm(installRoot, { recursive: true, force: true });
    const install = await runLogged(installerPath, ["/S", `/D=${installRoot}`], 5 * 60_000);
    logs.push(commandLog(install));
    const installedExe = path.join(installRoot, edition === "lite" ? "Cardnews Studio Lite.exe" : "Cardnews Studio Pro.exe");
    const installedPresent = install.exitCode === 0 && (await pathExists(installedExe));
    assertions.push({
      id: `${edition}-silent-install`,
      passed: installedPresent,
      detail: `${installedExe} (exit=${install.exitCode})`
    });
    if (!installedPresent) {
      exitCode = 1;
      continue;
    }

    const renderArtifacts = await runPackagedRender({
      edition,
      exePath: installedExe,
      resultPath: path.join(state.runRoot, `${edition}-installed-render.json`),
      screenshotPath: path.join(state.runRoot, `${edition}-installed-render.png`),
      profilePath: path.join(state.runRoot, `installed-render-profile-${edition}`)
    });
    logs.push(renderArtifacts.log);
    assertions.push(renderArtifacts.assertion);
    artifacts.push(...renderArtifacts.artifacts);
    if (!renderArtifacts.assertion.passed) exitCode = 1;

    const launch = await launchSmoke(installedExe, path.join(state.runRoot, `installed-profile-${edition}`));
    logs.push(`${edition}-installed-launch: ${JSON.stringify(launch)}`);
    assertions.push({
      id: `${edition}-installed-fresh-profile-launch`,
      passed: launch.started && launch.aliveAfterDelay && launch.closed,
      detail: JSON.stringify(launch)
    });
    if (!launch.started || !launch.aliveAfterDelay || !launch.closed) exitCode = 1;

    const uninstaller = path.join(
      installRoot,
      edition === "lite" ? "Uninstall Cardnews Studio Lite.exe" : "Uninstall Cardnews Studio Pro.exe"
    );
    const uninstall = await runLogged(uninstaller, ["/S"], 5 * 60_000);
    logs.push(commandLog(uninstall));
    const installedAsar = path.join(installRoot, "resources", "app.asar");
    await waitForPathsRemoval([installedExe, installedAsar], 60_000);
    const residue = await pathExists(installedExe) || await pathExists(installedAsar);
    assertions.push({
      id: `${edition}-silent-uninstall-no-residue`,
      passed: uninstall.exitCode === 0 && !residue,
      detail: `exit=${uninstall.exitCode}, residue=${residue}`
    });
    if (uninstall.exitCode !== 0 || residue) exitCode = 1;
  }
  return { assertions, logs, artifacts, exitCode };
}

async function runPackagedRender({ edition, exePath, resultPath, screenshotPath, profilePath }) {
  const result = await runLogged(
    process.execPath,
    [
      "scripts/verify-packaged-render.mjs",
      "--exe",
      exePath,
      "--edition",
      edition,
      "--ratio",
      "4:5",
      "--scale",
      "1",
      "--profile-dir",
      profilePath,
      "--result",
      resultPath,
      "--screenshot",
      screenshotPath,
      "--timeout-ms",
      "180000"
    ],
    5 * 60_000
  );
  return {
    assertion: {
      id: `${edition}-packaged-render-png`,
      passed: result.exitCode === 0,
      detail: `${resultPath} (exit=${result.exitCode})`
    },
    artifacts: await existingArtifactRecords([resultPath, screenshotPath]),
    log: commandLog(result)
  };
}

async function launchSmoke(exePath, profilePath) {
  const child = spawn(exePath, [`--user-data-dir=${profilePath}`, "--disable-gpu", "--no-first-run"], {
    cwd: path.dirname(exePath),
    detached: false,
    env: packagingEnvironment(),
    stdio: "ignore",
    windowsHide: true
  });
  const result = { started: Boolean(child.pid), pid: child.pid, aliveAfterDelay: false, closed: false };
  await delay(8000);
  result.aliveAfterDelay = child.exitCode === null;
  if (child.pid) {
    const taskkillPath = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    const killed = await runProcess(taskkillPath, ["/PID", String(child.pid), "/T", "/F"], {
      timeoutMs: 10000,
      env: packagingEnvironment()
    });
    result.taskkillExitCode = killed.exitCode;
    if (killed.exitCode !== 0) {
      const fallback = await terminateByExecutablePath(exePath);
      result.pathTerminationExitCode = fallback.exitCode;
      result.pathTerminationStderr = fallback.stderr;
    }
  }
  await delay(1500);
  result.closed =
    child.exitCode !== null ||
    result.taskkillExitCode === 0 ||
    result.pathTerminationExitCode === 0;
  return result;
}

async function terminateByExecutablePath(exePath) {
  const powershellPath = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const script = [
    "$target = [IO.Path]::GetFullPath($env:M24_TEST_EXE_PATH)",
    "$deadline = (Get-Date).AddSeconds(10)",
    "do {",
    "  $processes = @(Get-Process | Where-Object { $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq $target })",
    "  if ($processes.Count -eq 0) { exit 0 }",
    "  $processes | Stop-Process -Force -ErrorAction SilentlyContinue",
    "  Start-Sleep -Milliseconds 500",
    "} while ((Get-Date) -lt $deadline)",
    "exit 1"
  ].join("; ");
  return runProcess(
    powershellPath,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      timeoutMs: 15000,
      env: { ...packagingEnvironment(), M24_TEST_EXE_PATH: exePath }
    }
  );
}

async function readPackageState() {
  if (!(await pathExists(statePath))) {
    throw new Error("Run node scripts/package-m24-release.mjs --phase isolated first.");
  }
  return readJson(statePath);
}

function buildArtifactPaths(liteRoot, proRoot) {
  return {
    liteAsar: path.join(liteRoot, "win-unpacked", "resources", "app.asar"),
    liteExe: path.join(liteRoot, "win-unpacked", "Cardnews Studio Lite.exe"),
    liteInstaller: path.join(liteRoot, "Cardnews-Studio-Lite-Setup-2.0.0.exe"),
    proAsar: path.join(proRoot, "win-unpacked", "resources", "app.asar"),
    proExe: path.join(proRoot, "win-unpacked", "Cardnews Studio Pro.exe"),
    proInstaller: path.join(proRoot, "Cardnews-Studio-Pro-Setup-2.0.0.exe")
  };
}

function stageCopyArtifacts(artifacts) {
  return {
    liteInstaller: artifacts.liteInstaller,
    proInstaller: artifacts.proInstaller,
    packageSecurity: artifacts.packageSecurity
  };
}

async function existingArtifactRecords(paths) {
  const records = [];
  for (const filePath of paths.filter(Boolean)) {
    if (await pathExists(filePath)) records.push(await artifactRecord(filePath));
  }
  return records;
}

async function runLogged(commandName, commandArgs, timeoutMs) {
  const result = await runProcess(commandName, commandArgs, { timeoutMs, env: packagingEnvironment() });
  return { ...result, command: `${commandName} ${commandArgs.join(" ")}` };
}

function npmInvocation() {
  if (process.platform !== "win32") {
    return { command: "npm", args: ["run"] };
  }
  return {
    command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm run"]
  };
}

function timestamp() {
  return new Date().toISOString().replaceAll(/[:.]/g, "-").replace("T", "-").slice(0, 19);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPathRemoval(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await pathExists(filePath))) return true;
    await delay(500);
  }
  return false;
}

async function waitForPathsRemoval(filePaths, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(filePaths.map((filePath) => pathExists(filePath)));
    if (states.every((exists) => !exists)) return true;
    await delay(500);
  }
  return false;
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
