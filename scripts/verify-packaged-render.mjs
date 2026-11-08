import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--help")) {
  console.log([
    "Usage: node scripts/verify-packaged-render.mjs --exe <path> --edition <lite|pro> --ratio <4:5|1:1|16:9|4:3> --scale <1|1.25|1.5|1.75|2> --profile-dir <path> [options]",
    "",
    "Options:",
    "  --result <path>       Write the structured result JSON.",
    "  --screenshot <path>   Save a production UI screenshot after rendering.",
    "  --timeout-ms <ms>     Per-operation timeout from 10000 to 600000."
  ].join("\n"));
  process.exit(0);
}
const options = parseArgs(process.argv.slice(2));
const executablePath = path.resolve(requiredOption(options, "exe"));
const edition = validateEdition(requiredOption(options, "edition"));
const ratio = validateRatio(requiredOption(options, "ratio"));
const scale = validateScale(requiredOption(options, "scale"));
const profileDirectory = path.resolve(requiredOption(options, "profileDir"));
const resultPath = options.result ? path.resolve(options.result) : undefined;
const screenshotPath = options.screenshot ? path.resolve(options.screenshot) : undefined;
const timeoutMs = validateTimeout(options.timeoutMs ?? "120000");
const expected = expectedDimensions(ratio);
const selectorPrefix = edition === "pro" ? "cardnews" : "smoke";
const startedAt = new Date().toISOString();
const stdoutChunks = [];
const stderrChunks = [];
let child;
let cdp;
let forcedTermination = false;

async function main() {
  try {
  await fs.access(executablePath);
  await prepareProfile(profileDirectory);
  const pngFilesBefore = await findFiles(profileDirectory, "card-01.png");
  const debuggingPort = await reserveEphemeralPort();
  const environment = createIsolatedEnvironment(profileDirectory);
  const chromiumProfile = path.join(profileDirectory, "Chromium");

  child = spawn(
    executablePath,
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--remote-allow-origins=http://127.0.0.1:${debuggingPort}`,
      `--force-device-scale-factor=${scale}`,
      `--user-data-dir=${chromiumProfile}`,
      "--no-first-run"
    ],
    {
      cwd: path.dirname(executablePath),
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

  const target = await waitForPageTarget(debuggingPort, timeoutMs);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl, timeoutMs);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitForWorkspace(cdp, selectorPrefix, edition, timeoutMs);
  const uiSetup = await configureUi(cdp, selectorPrefix, ratio, timeoutMs);
  const renderStatus = await generatePng(cdp, selectorPrefix, timeoutMs);

  if (screenshotPath) {
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }

  const newPngPath = await waitForNewPng(profileDirectory, pngFilesBefore, timeoutMs);
  const verification = await verifyPng(newPngPath, expected, timeoutMs);
  const diagnosticsPath = path.join(path.dirname(newPngPath), "render-diagnostics.json");
  await fs.access(diagnosticsPath);
  const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, "utf8"));

  await cdp.send("Browser.close").catch(() => undefined);
  cdp.close();
  cdp = undefined;
  const closedNaturally = await waitForChildExit(child, 15000);
  if (!closedNaturally) {
    forcedTermination = true;
    await terminateProcessTree(child.pid);
    await waitForChildExit(child, 10000);
  }
  const matchingProcesses = await findProcessesAtExecutable(executablePath);
  if (matchingProcesses.length > 0) {
    throw new Error(`Packaged app process remained after close: ${JSON.stringify(matchingProcesses)}`);
  }
  const result = {
    actual: verification.actual,
    completedAt: new Date().toISOString(),
    diagnosticsPath,
    edition,
    executablePath,
    expected,
    forcedTermination,
    profileDirectory,
    ratio,
    renderStatus,
    result: "pass",
    scale,
    schemaVersion: 1,
    screenshotPath: screenshotPath ?? null,
    startedAt,
    uiSetup,
    verifier: verification.verifier
  };
  await writeResult(resultPath, result);
  console.log(JSON.stringify(result));
  } catch (error) {
    if (cdp) {
      await cdp.send("Browser.close").catch(() => undefined);
      cdp.close();
    }
    if (child && child.exitCode === null) {
      await terminateProcessTree(child.pid).catch(() => undefined);
    }
    const result = {
      completedAt: new Date().toISOString(),
      edition,
      error: error instanceof Error ? error.message : String(error),
      executablePath,
      forcedTermination,
      profileDirectory,
      ratio,
      result: "fail",
      scale,
      schemaVersion: 1,
      startedAt,
      stderr: stderrChunks.join("").slice(-8000),
      stdout: stdoutChunks.join("").slice(-8000)
    };
    await writeResult(resultPath, result).catch(() => undefined);
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  }
}

async function prepareProfile(directory) {
  for (const childName of ["Chromium", "Local", "Roaming", "Temp"]) {
    await fs.mkdir(path.join(directory, childName), { recursive: true });
  }
}

function createIsolatedEnvironment(directory) {
  return {
    ...process.env,
    APPDATA: path.join(directory, "Roaming"),
    LOCALAPPDATA: path.join(directory, "Local"),
    TEMP: path.join(directory, "Temp"),
    TMP: path.join(directory, "Temp")
  };
}

async function reserveEphemeralPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve) => server.close(resolve));
  if (!port) {
    throw new Error("Could not reserve an ephemeral debugging port.");
  }
  return port;
}

async function waitForPageTarget(port, timeout) {
  const deadline = Date.now() + timeout;
  let lastFailure = "target list unavailable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          (candidate) => candidate.type === "page" && typeof candidate.webSocketDebuggerUrl === "string"
        );
        if (target) {
          return target;
        }
        lastFailure = `no page target in ${JSON.stringify(targets)}`;
      } else {
        lastFailure = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for packaged app CDP target: ${lastFailure}`);
}

async function waitForWorkspace(client, prefix, expectedEdition, timeout) {
  return evaluateWithTimeout(
    client,
    `(async () => {
      const deadline = Date.now() + ${timeout};
      while (Date.now() < deadline) {
        const root = document.querySelector('[data-${prefix}-workspace-ready="true"]');
        if (root) {
          const edition = root.getAttribute('data-${prefix}-edition');
          if (edition !== ${JSON.stringify(expectedEdition)}) {
            throw new Error('edition mismatch: expected ${expectedEdition}, got ' + edition);
          }
          return { edition, title: document.title };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('workspace did not become ready');
    })()`,
    timeout
  );
}

async function configureUi(client, prefix, targetRatio, timeout) {
  return evaluateWithTimeout(
    client,
    `(async () => {
      const select = document.querySelector('.topbar-ratio-select');
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('ratio selector is missing');
      }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!valueSetter) {
        throw new Error('ratio value setter is unavailable');
      }
      window.confirm = () => true;
      valueSetter.call(select, ${JSON.stringify(targetRatio)});
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));

      const ratioDeadline = Date.now() + 3000;
      while (Date.now() < ratioDeadline) {
        const currentSelect = document.querySelector('.topbar-ratio-select');
        if (currentSelect instanceof HTMLSelectElement && currentSelect.value === ${JSON.stringify(targetRatio)}) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      let previousCount = document.querySelectorAll('.slide-thumb').length;
      while (previousCount > 1) {
        let nextCount = previousCount;
        for (let attempt = 0; attempt < 3 && nextCount >= previousCount; attempt += 1) {
          const removeButton = document.querySelector('[data-${prefix}-action="design-panel-remove-card"]');
          if (!(removeButton instanceof HTMLButtonElement)) {
            throw new Error('remove-card control is missing');
          }
          if (removeButton.disabled) {
            throw new Error('remove-card control is disabled at count ' + previousCount);
          }
          removeButton.click();
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            nextCount = document.querySelectorAll('.slide-thumb').length;
            if (nextCount < previousCount) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (nextCount < previousCount) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (nextCount >= previousCount) {
          throw new Error('card count did not decrease from ' + previousCount + ' after 3 attempts');
        }
        previousCount = nextCount;
      }

      const currentSelect = document.querySelector('.topbar-ratio-select');
      if (!(currentSelect instanceof HTMLSelectElement)) {
        throw new Error('ratio selector disappeared after card setup');
      }
      return {
        cardCount: document.querySelectorAll('.slide-thumb').length,
        ratio: currentSelect.value
      };
    })()`,
    timeout
  );
}

async function generatePng(client, prefix, timeout) {
  const started = await evaluateWithTimeout(
    client,
    `(async () => {
      const openExport = document.querySelector('[data-${prefix}-action="open-export-dialog"]');
      if (!(openExport instanceof HTMLButtonElement)) {
        throw new Error('Export dialog control is missing');
      }
      const before = document.querySelector('.stage-status')?.textContent?.trim() ?? '';
      const disabled = openExport.disabled;
      openExport.click();
      const deadline = Date.now() + 3000;
      let generate;
      while (Date.now() < deadline) {
        generate = document.querySelector('[data-${prefix}-action="export-png-choice"]');
        if (generate instanceof HTMLButtonElement) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!(generate instanceof HTMLButtonElement)) {
        throw new Error('PNG export choice is missing');
      }
      generate.click();
      return { before, disabled };
    })()`,
    5000
  );
  if (started?.disabled) {
    throw new Error(`Export control is disabled: ${started.before || "no status"}`);
  }

  const deadline = Date.now() + timeout;
  let lastStatus = started?.before ?? "";
  while (Date.now() < deadline) {
    const state = await evaluateWithTimeout(
      client,
      `(() => ({
        disabled: document.querySelector('[data-${prefix}-action="open-export-dialog"]')?.disabled ?? null,
        label: document.querySelector('[data-${prefix}-action="open-export-dialog"]')?.textContent?.trim() ?? '',
        status: document.querySelector('.stage-status')?.textContent?.trim() ?? ''
      }))()`,
      5000
    );
    lastStatus = state?.status ?? lastStatus;
    if (lastStatus.startsWith("렌더 완료:")) {
      return lastStatus;
    }
    if (
      lastStatus.startsWith("렌더 실패:") ||
      lastStatus.startsWith("게이트 실패:") ||
      lastStatus.startsWith("파싱 오류") ||
      lastStatus.startsWith("저장 실패:")
    ) {
      throw new Error(lastStatus);
    }
    await delay(200);
  }
  throw new Error(`PNG generation did not finish before timeout. Last status: ${lastStatus || "empty"}`);
}

async function evaluateWithTimeout(client, expression, timeout) {
  const response = await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
    userGesture: true
  }, timeout + 5000);
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
    throw new Error(`CDP evaluation failed: ${description}`);
  }
  return response.result?.value;
}

async function waitForNewPng(directory, before, timeout) {
  const known = new Set(before);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await findFiles(directory, "card-01.png");
    const created = current.filter((filePath) => !known.has(filePath));
    if (created.length > 0) {
      const stats = await Promise.all(created.map(async (filePath) => ({ filePath, stat: await fs.stat(filePath) })));
      stats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
      return stats[0].filePath;
    }
    await delay(100);
  }
  throw new Error("No new card-01.png appeared in the isolated profile.");
}

async function findFiles(directory, fileName) {
  const found = [];
  async function visit(current, depth) {
    if (depth > 9) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (entry.isFile() && entry.name === fileName) {
        found.push(entryPath);
      }
    }
  }
  await visit(directory, 0);
  return found;
}

async function verifyPng(pngPath, dimensions, timeout) {
  const verifierPath = path.join(root, "scripts", "verify-render-png.mjs");
  const result = await runProcess(
    process.execPath,
    [
      verifierPath,
      pngPath,
      "--expect-width",
      String(dimensions.width),
      "--expect-height",
      String(dimensions.height)
    ],
    { cwd: root, timeout }
  );
  if (result.exitCode !== 0) {
    throw new Error(`Independent PNG verifier failed: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout.trim());
  return {
    actual: { height: parsed.height, width: parsed.width },
    verifier: parsed
  };
}

async function findProcessesAtExecutable(targetPath) {
  const escaped = targetPath.replaceAll("'", "''");
  const script = [
    `$target = '${escaped}'`,
    "$items = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | Select-Object ProcessId,Name,ExecutablePath",
    "$items | ConvertTo-Json -Compress"
  ].join("; ");
  const result = await runProcess(resolveWindowsSystemTool("WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-Command", script], {
    cwd: root,
    timeout: 30000
  });
  const text = result.stdout.trim();
  if (!text) {
    return [];
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function terminateProcessTree(pid) {
  if (!Number.isInteger(pid)) {
    return;
  }
  await runProcess(resolveWindowsSystemTool("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
    cwd: root,
    timeout: 30000
  });
}

function resolveWindowsSystemTool(...segments) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  return path.join(systemRoot, "System32", ...segments);
}

function waitForChildExit(processHandle, timeout) {
  if (processHandle.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      processHandle.off("close", onClose);
      resolve(false);
    }, timeout);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    processHandle.once("close", onClose);
  });
}

function runProcess(command, args, { cwd, timeout }) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      processHandle.kill();
      reject(new Error(`${path.basename(command)} timed out after ${timeout}ms`));
    }, timeout);
    processHandle.stdout.setEncoding("utf8");
    processHandle.stderr.setEncoding("utf8");
    processHandle.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    processHandle.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    processHandle.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processHandle.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
  });
}

async function writeResult(filePath, value) {
  if (!filePath) {
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2).replaceAll(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const value = tokens[index + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function requiredOption(values, name) {
  const value = values[name];
  if (!value) {
    throw new Error(`Missing required option --${name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return value;
}

function validateEdition(value) {
  if (value !== "lite" && value !== "pro") {
    throw new Error(`Unsupported edition: ${value}`);
  }
  return value;
}

function validateRatio(value) {
  if (!["4:5", "1:1", "16:9", "4:3"].includes(value)) {
    throw new Error(`Unsupported ratio: ${value}`);
  }
  return value;
}

function validateScale(value) {
  const scaleValue = Number(value);
  if (![1, 1.25, 1.5, 1.75, 2].includes(scaleValue)) {
    throw new Error(`Unsupported scale: ${value}`);
  }
  return scaleValue;
}

function validateTimeout(value) {
  const timeout = Number.parseInt(value, 10);
  if (!Number.isFinite(timeout) || timeout < 10000 || timeout > 600000) {
    throw new Error(`Unsupported timeout: ${value}`);
  }
  return timeout;
}

function expectedDimensions(value) {
  return {
    "4:5": { height: 1350, width: 1080 },
    "1:1": { height: 1080, width: 1080 },
    "16:9": { height: 1080, width: 1920 },
    "4:3": { height: 1080, width: 1440 }
  }[value];
}

class CdpClient {
  constructor(socket, timeout) {
    this.socket = socket;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`CDP socket closed during ${pending.method}`));
      }
      this.pending.clear();
    });
  }

  static async connect(url, timeout) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out.")), timeout);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket connection failed."));
      }, { once: true });
    });
    return new CdpClient(socket, timeout);
  }

  send(method, params = {}, timeout = this.timeout) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, { method, reject, resolve, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

await main();
