import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--help")) {
  console.log([
    "Usage: node scripts/run-packaged-render-matrix.mjs --exe <path> --edition <lite|pro> --profile-root <path> --output-dir <path> [options]",
    "",
    "Options:",
    "  --timeout-ms <ms>        Per packaged-app scenario timeout.",
    "  --screenshots <mode>     all, representative, or none (default: representative)."
  ].join("\n"));
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const executablePath = path.resolve(requiredOption(options, "exe"));
const edition = validateEdition(requiredOption(options, "edition"));
const profileRoot = path.resolve(requiredOption(options, "profileRoot"));
const outputDirectory = path.resolve(requiredOption(options, "outputDir"));
const timeoutMs = validateTimeout(options.timeoutMs ?? "180000");
const screenshotMode = validateScreenshotMode(options.screenshots ?? "representative");
const driverPath = path.join(root, "scripts", "verify-packaged-render.mjs");
const ratios = ["4:5", "1:1", "16:9", "4:3"];
const scales = [1, 1.25, 1.5, 1.75, 2];
const startedAt = new Date().toISOString();
const runId = startedAt.replaceAll(/[:.]/g, "-");
const rows = [];

await fs.access(executablePath);
await fs.mkdir(profileRoot, { recursive: true });
await fs.mkdir(outputDirectory, { recursive: true });

for (const ratio of ratios) {
  for (const scale of scales) {
    const scenarioId = `${edition}-${ratio.replace(":", "x")}-${String(scale).replace(".", "p")}`;
    const profileDirectory = path.join(profileRoot, `${runId}-${scenarioId}`);
    const resultPath = path.join(outputDirectory, `${scenarioId}.json`);
    const logPath = path.join(outputDirectory, `${scenarioId}.log`);
    const screenshotPath = shouldCaptureScreenshot(screenshotMode, scale)
      ? path.join(outputDirectory, `${scenarioId}.png`)
      : undefined;
    await fs.rm(resultPath, { force: true });
    await fs.rm(logPath, { force: true });
    if (screenshotPath) {
      await fs.rm(screenshotPath, { force: true });
    }
    const childArgs = [
      driverPath,
      "--exe",
      executablePath,
      "--edition",
      edition,
      "--ratio",
      ratio,
      "--scale",
      String(scale),
      "--profile-dir",
      profileDirectory,
      "--result",
      resultPath,
      "--timeout-ms",
      String(timeoutMs)
    ];
    if (screenshotPath) {
      childArgs.push("--screenshot", screenshotPath);
    }

    const processResult = await runProcess(process.execPath, childArgs);
    await fs.writeFile(
      logPath,
      [
        `exitCode=${processResult.exitCode}`,
        "--- stdout ---",
        processResult.stdout.trimEnd(),
        "--- stderr ---",
        processResult.stderr.trimEnd(),
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await readResult(resultPath, processResult);
    const row = {
      actual: result.actual ?? null,
      diagnosticsPath: result.diagnosticsPath ?? null,
      exitCode: processResult.exitCode,
      expected: result.expected ?? null,
      forcedTermination: result.forcedTermination ?? null,
      logPath,
      profileDirectory,
      ratio,
      result: result.result ?? "fail",
      resultPath,
      scale,
      screenshotPath: screenshotPath ?? null
    };
    rows.push(row);
    console.log(JSON.stringify({ edition, ...row }));
  }
}

const failedRows = rows.filter(
  (row) => row.exitCode !== 0 || row.result !== "pass" || row.forcedTermination !== false
);
const summary = {
  completedAt: new Date().toISOString(),
  edition,
  executablePath,
  failed: failedRows.length,
  passed: rows.length - failedRows.length,
  rows,
  runId,
  scenarios: rows.length,
  schemaVersion: 1,
  startedAt
};
await fs.writeFile(
  path.join(outputDirectory, "matrix-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8"
);
process.exitCode = failedRows.length === 0 ? 0 : 1;

function runProcess(command, childArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, childArgs, {
      cwd: root,
      env: { ...process.env },
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
  });
}

async function readResult(resultPath, processResult) {
  try {
    return JSON.parse(await fs.readFile(resultPath, "utf8"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      result: "fail",
      stderr: processResult.stderr.slice(-4000),
      stdout: processResult.stdout.slice(-4000)
    };
  }
}

function shouldCaptureScreenshot(mode, scale) {
  return mode === "all" || (mode === "representative" && scale === 1.5);
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

function requiredOption(parsed, key) {
  const value = parsed[key];
  if (!value) {
    throw new Error(`Missing required option: --${key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return value;
}

function validateEdition(value) {
  if (value !== "lite" && value !== "pro") {
    throw new Error(`Unsupported edition: ${value}`);
  }
  return value;
}

function validateTimeout(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10000 || parsed > 600000) {
    throw new Error(`Invalid timeout: ${value}`);
  }
  return parsed;
}

function validateScreenshotMode(value) {
  if (!new Set(["all", "representative", "none"]).has(value)) {
    throw new Error(`Invalid screenshot mode: ${value}`);
  }
  return value;
}
