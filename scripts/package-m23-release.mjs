import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  artifactRecord,
  m23EvidenceRoot,
  parseArgs,
  pathExists,
  runProcess,
  writeGateEvidence,
  writeJson
} from "./m23-evidence-helpers.mjs";

const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
const statePath = path.resolve(m23EvidenceRoot, "package-state.json");

if (!["isolated", "fresh-profile-smoke", "stage"].includes(phase)) {
  throw new Error("Usage: node scripts/package-m23-release.mjs --phase isolated|fresh-profile-smoke|stage [--require-vm-evidence]");
}

if (phase === "isolated") {
  await packageIsolated();
} else if (phase === "fresh-profile-smoke") {
  await smokeFreshProfiles();
} else {
  await stageRelease();
}

async function packageIsolated() {
  const startedAt = new Date().toISOString();
  const runId = `m23-release-${timestamp()}`;
  const runRoot = path.resolve(".omc/build", runId);
  const liteRoot = path.join(runRoot, "Lite");
  const proRoot = path.join(runRoot, "Pro");
  await fs.mkdir(runRoot, { recursive: true });

  const logs = [];
  const commands = [
    [process.execPath, ["scripts/build-edition.mjs", "lite"]],
    [process.execPath, [
      "node_modules/electron-builder/out/cli/cli.js",
      "--win",
      "nsis",
      "--config",
      "electron-builder.lite.json",
      `--config.directories.output=${liteRoot}`
    ]],
    [process.execPath, ["scripts/build-edition.mjs", "pro"]],
    [process.execPath, ["scripts/prepare-pro-package.mjs"]],
    [process.execPath, [
      "node_modules/electron-builder/out/cli/cli.js",
      "--win",
      "nsis",
      "--config",
      "electron-builder.pro.json",
      `--config.directories.output=${proRoot}`
    ]]
  ];

  let exitCode = 0;
  const assertions = [];
  for (const [command, commandArgs] of commands) {
    const result = await runProcess(command, commandArgs, {
      timeoutMs: 30 * 60 * 1000,
      env: packagingEnvironment()
    });
    logs.push(`$ ${command} ${commandArgs.join(" ")}\n${result.stdout}${result.stderr}`);
    assertions.push({
      id: `package-command-${assertions.length + 1}`,
      passed: result.exitCode === 0,
      detail: `exit=${result.exitCode}`
    });
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      break;
    }
  }

  const artifacts = {
    liteAsar: path.join(liteRoot, "win-unpacked", "resources", "app.asar"),
    liteExe: path.join(liteRoot, "win-unpacked", "Cardnews Studio Lite.exe"),
    liteInstaller: path.join(liteRoot, "Cardnews-Studio-Lite-Setup-2.0.0.exe"),
    proAsar: path.join(proRoot, "win-unpacked", "resources", "app.asar"),
    proExe: path.join(proRoot, "win-unpacked", "Cardnews Studio Pro.exe"),
    proInstaller: path.join(proRoot, "Cardnews-Studio-Pro-Setup-2.0.0.exe")
  };
  for (const [name, filePath] of Object.entries(artifacts)) {
    assertions.push({ id: name, passed: await pathExists(filePath), detail: filePath });
  }

  const securityOutput = path.join(runRoot, "package-security.json");
  if (exitCode === 0 && assertions.every((assertion) => assertion.passed)) {
    const security = await runProcess(process.execPath, [
      "scripts/verify-package-security.mjs",
      "--lite-asar", artifacts.liteAsar,
      "--pro-asar", artifacts.proAsar,
      "--lite-exe", artifacts.liteExe,
      "--pro-exe", artifacts.proExe,
      "--lite-installer", artifacts.liteInstaller,
      "--pro-installer", artifacts.proInstaller,
      "--output", securityOutput
    ], { timeoutMs: 10 * 60 * 1000 });
    logs.push(`$ package security\n${security.stdout}${security.stderr}`);
    assertions.push({
      id: "package-security",
      passed: security.exitCode === 0,
      detail: securityOutput
    });
    exitCode = security.exitCode;
  }

  const outputs = [];
  for (const filePath of Object.values(artifacts)) {
    if (await pathExists(filePath)) {
      outputs.push(await artifactRecord(filePath));
    }
  }
  if (await pathExists(securityOutput)) {
    outputs.push(await artifactRecord(securityOutput));
  }

  const state = { schemaVersion: 1, runId, runRoot, liteRoot, proRoot, artifacts };
  await writeJson(statePath, state);
  const meta = await writeGateEvidence({
    gate: "G8-isolated-package",
    command: "node scripts/package-m23-release.mjs --phase isolated",
    startedAt,
    exitCode,
    edition: "lite+pro",
    outputs,
    assertions,
    log: logs.join("\n"),
    verdict: exitCode === 0 && assertions.every((assertion) => assertion.passed) ? "pass" : "fail"
  });
  console.log(JSON.stringify(meta));
  process.exitCode = meta.verdict === "pass" ? 0 : 1;
}

async function smokeFreshProfiles() {
  const startedAt = new Date().toISOString();
  const state = await readState();
  const g8 = await readGate("G8-isolated-package");
  if (g8.verdict !== "pass") {
    throw new Error("G8-isolated-package must pass before G9.");
  }

  const assertions = [];
  const logs = [];
  const outputs = [];
  let exitCode = 0;
  for (const edition of ["lite", "pro"]) {
    const exePath = state.artifacts[`${edition}Exe`];
    const installerPath = state.artifacts[`${edition}Installer`];
    const profilePath = path.join(state.runRoot, `fresh-profile-${edition}`);
    await fs.rm(profilePath, { recursive: true, force: true });
    await fs.mkdir(profilePath, { recursive: true });
    const result = await launchSmoke(exePath, profilePath);
    logs.push(`${edition}: ${JSON.stringify(result)}`);
    assertions.push({
      id: `${edition}-fresh-profile-launch`,
      passed: result.started && result.aliveAfterDelay && result.closed,
      detail: JSON.stringify(result)
    });
    if (!result.started || !result.aliveAfterDelay || !result.closed) {
      exitCode = 1;
    }

    const renderResultPath = path.join(state.runRoot, `${edition}-packaged-render.json`);
    const screenshotPath = path.join(state.runRoot, `${edition}-packaged-render.png`);
    const render = await runProcess(process.execPath, [
      "scripts/verify-packaged-render.mjs",
      "--exe", exePath,
      "--edition", edition,
      "--ratio", "4:5",
      "--scale", "1",
      "--profile-dir", path.join(state.runRoot, `render-profile-${edition}`),
      "--result", renderResultPath,
      "--screenshot", screenshotPath,
      "--timeout-ms", "180000"
    ], { timeoutMs: 5 * 60 * 1000, env: packagingEnvironment() });
    logs.push(`${edition}-render:\n${render.stdout}${render.stderr}`);
    assertions.push({
      id: `${edition}-packaged-render`,
      passed: render.exitCode === 0,
      detail: renderResultPath
    });
    if (render.exitCode !== 0) {
      exitCode = 1;
    }
    for (const outputPath of [renderResultPath, screenshotPath]) {
      if (await pathExists(outputPath)) {
        outputs.push(await artifactRecord(outputPath));
      }
    }

    const installRoot = path.join(state.runRoot, `installed-${edition}`);
    await fs.rm(installRoot, { recursive: true, force: true });
    const install = await runProcess(installerPath, ["/S", `/D=${installRoot}`], {
      timeoutMs: 5 * 60 * 1000,
      env: packagingEnvironment()
    });
    logs.push(`${edition}-install:\n${install.stdout}${install.stderr}`);
    const installedExe = path.join(
      installRoot,
      edition === "lite" ? "Cardnews Studio Lite.exe" : "Cardnews Studio Pro.exe"
    );
    const installedPresent = install.exitCode === 0 && await pathExists(installedExe);
    assertions.push({
      id: `${edition}-silent-install`,
      passed: installedPresent,
      detail: `${installedExe} (exit=${install.exitCode})`
    });
    if (!installedPresent) {
      exitCode = 1;
      continue;
    }

    const installedProfile = path.join(state.runRoot, `installed-profile-${edition}`);
    const installedLaunch = await launchSmoke(installedExe, installedProfile);
    logs.push(`${edition}-installed-launch: ${JSON.stringify(installedLaunch)}`);
    assertions.push({
      id: `${edition}-installed-launch`,
      passed: installedLaunch.started && installedLaunch.aliveAfterDelay && installedLaunch.closed,
      detail: JSON.stringify(installedLaunch)
    });
    if (!installedLaunch.aliveAfterDelay || !installedLaunch.closed) {
      exitCode = 1;
    }

    const uninstaller = path.join(
      installRoot,
      edition === "lite" ? "Uninstall Cardnews Studio Lite.exe" : "Uninstall Cardnews Studio Pro.exe"
    );
    const uninstall = await runProcess(uninstaller, ["/S"], {
      timeoutMs: 5 * 60 * 1000,
      env: packagingEnvironment()
    });
    await waitForPathRemoval(installedExe, 15000);
    const removed = !await pathExists(installedExe);
    assertions.push({
      id: `${edition}-silent-uninstall`,
      passed: uninstall.exitCode === 0 && removed,
      detail: `exit=${uninstall.exitCode}, removed=${removed}`
    });
    if (uninstall.exitCode !== 0 || !removed) {
      exitCode = 1;
    }
  }

  const meta = await writeGateEvidence({
    gate: "G9-fresh-profile-package-smoke",
    command: "node scripts/package-m23-release.mjs --phase fresh-profile-smoke",
    startedAt,
    exitCode,
    edition: "lite+pro",
    inputs: await Promise.all([
      artifactRecord(state.artifacts.liteExe),
      artifactRecord(state.artifacts.proExe)
    ]),
    outputs,
    assertions,
    log: logs.join("\n"),
    verdict: exitCode === 0 ? "pass" : "fail"
  });
  console.log(JSON.stringify(meta));
  process.exitCode = exitCode;
}

async function stageRelease() {
  const startedAt = new Date().toISOString();
  const state = await readState();
  const g9 = await readGate("G9-fresh-profile-package-smoke");
  if (g9.verdict !== "pass") {
    throw new Error("G9-fresh-profile-package-smoke must pass before staging.");
  }
  const vmPath = path.resolve(m23EvidenceRoot, "G10-clean-vm-install-smoke.meta.json");
  const vmEvidence = await pathExists(vmPath) ? JSON.parse(await fs.readFile(vmPath, "utf8")) : null;
  const vmPassed = vmEvidence?.verdict === "pass";
  const requireVm = args.requireVmEvidence === true || args.requireVmEvidence === "true";
  if (requireVm && !vmPassed) {
    const meta = await writeGateEvidence({
      gate: "G11-stage-and-handoff",
      command: "node scripts/package-m23-release.mjs --phase stage --require-vm-evidence",
      startedAt,
      exitCode: 2,
      edition: "lite+pro",
      assertions: [{
        id: "clean-vm-evidence",
        passed: false,
        detail: "G10 clean Windows VM evidence is absent or not pass; public staging refused."
      }],
      log: `Staging refused. Isolated artifacts remain at ${state.runRoot}.`,
      verdict: "blocked"
    });
    console.log(JSON.stringify(meta));
    process.exitCode = 2;
    return;
  }
  throw new Error("M23 staging without --require-vm-evidence is intentionally unsupported.");
}

async function launchSmoke(exePath, profilePath) {
  const child = spawn(exePath, [`--user-data-dir=${profilePath}`, "--disable-gpu"], {
    cwd: path.dirname(exePath),
    detached: false,
    stdio: "ignore",
    windowsHide: true
  });
  const result = { started: true, pid: child.pid, aliveAfterDelay: false, closed: false };
  await delay(8000);
  result.aliveAfterDelay = child.exitCode === null;
  const taskkillPath = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "taskkill.exe"
  );
  const killed = await runProcess(taskkillPath, ["/PID", String(child.pid), "/T", "/F"], {
    timeoutMs: 10000,
    env: packagingEnvironment()
  });
  await delay(1500);
  result.closed = child.exitCode !== null || killed.exitCode === 0;
  result.taskkillExitCode = killed.exitCode;
  return result;
}

async function readState() {
  if (!await pathExists(statePath)) {
    throw new Error("Run --phase isolated first.");
  }
  return JSON.parse(await fs.readFile(statePath, "utf8"));
}

async function readGate(gate) {
  const gatePath = path.resolve(m23EvidenceRoot, `${gate}.meta.json`);
  if (!await pathExists(gatePath)) {
    throw new Error(`${gate} evidence is missing.`);
  }
  return JSON.parse(await fs.readFile(gatePath, "utf8"));
}

function timestamp() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join("");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPathRemoval(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await pathExists(filePath)) {
      return true;
    }
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
  return {
    ...process.env,
    Path: [...required, currentPath].filter(Boolean).join(path.delimiter),
    PATH: [...required, currentPath].filter(Boolean).join(path.delimiter)
  };
}
