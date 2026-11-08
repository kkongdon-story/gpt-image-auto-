import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = process.cwd();
const harnessPath = path.resolve(
  args.harness ??
    ".omc/evidence/v6/m20-dpi-safe-render-dimensions/harness/render-dimension-smoke.js"
);
const evidenceDir = path.resolve(
  args.outputDir ?? ".omc/evidence/v6/m20-dpi-safe-render-dimensions/t04-matrix"
);
const electronPath = path.resolve("node_modules/electron/dist/electron.exe");
const editions = args.edition ? [validateEdition(args.edition)] : ["lite", "pro"];
const ratios = ["4:5", "1:1", "16:9", "4:3"];
const scales = [1, 1.25, 1.5, 1.75, 2];
const contentFixtures = [
  "dark-no-photo",
  "dark-photo",
  "light-no-photo",
  "chrome-elements",
  "bundled-korean-font",
  "user-ttf"
];
const readinessFixtures = ["missing-image", "missing-font"];
const geometryFixtures = [
  "m21-title-0",
  "m21-title-50",
  "m21-title-100",
  "m21-footer-negative",
  "m21-footer-zero",
  "m21-footer-positive",
  "m21-custom-transparent-0",
  "m21-custom-transparent-50",
  "m21-custom-transparent-100",
  "m21-custom-filled-50"
];
const rows = [];

await fs.mkdir(evidenceDir, { recursive: true });
for (const edition of editions) {
  for (const ratio of ratios) {
    for (const scale of scales) {
      await runScenario({ edition, fixture: "dark-no-photo", kind: "dimension", ratio, scale });
    }
  }

  for (const fixture of contentFixtures) {
    await runScenario({ edition, fixture, kind: "content", ratio: "4:5", scale: 1.5 });
  }

  for (const fixture of readinessFixtures) {
    await runScenario({ edition, fixture, kind: "readiness", ratio: "4:5", scale: 1.5 });
  }

  for (const ratio of ratios) {
    for (const fixture of geometryFixtures) {
      await runScenario({ edition, fixture, kind: "geometry", ratio, scale: 1 });
    }
  }
}

const geometryChecks = await validateM21Geometry();
const transportFailures = rows.filter((row) => row.exitCode !== 0 || row.result !== "pass");
const geometryFailures = geometryChecks.filter((check) => check.result !== "pass");
const failed = [...transportFailures, ...geometryFailures];
const summary = {
  completedAt: new Date().toISOString(),
  failed: failed.length,
  fixtures: [...contentFixtures, ...readinessFixtures, ...geometryFixtures],
  geometry: {
    failed: geometryFailures.length,
    passed: geometryChecks.length - geometryFailures.length,
    checks: geometryChecks
  },
  kinds: Object.fromEntries(
    ["dimension", "content", "readiness", "geometry"].map((kind) => [
      kind,
      rows.filter((row) => row.kind === kind).length
    ])
  ),
  passed: rows.length - transportFailures.length,
  rows: rows.map(({ stdout: _stdout, stderr: _stderr, ...row }) => row),
  scenarios: rows.length,
  schemaVersion: 1
};
await fs.writeFile(path.join(evidenceDir, "matrix-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.exitCode = failed.length === 0 ? 0 : 1;

async function validateM21Geometry() {
  const checks = [];
  for (const edition of editions) {
    for (const ratio of ratios) {
      const dimensions = ratioDimensions(ratio);
      for (const y of [0, 50, 100]) {
        const fixture = `m21-title-${y}`;
        const title = await readSlot(edition, fixture, ratio, "title-direct");
        const expectedTop = ((dimensions.height - title.height) * y) / 100;
        checks.push(check(`title-${edition}-${ratio}-${y}`, title.top, expectedTop));
        checks.push(check(`title-bounds-${edition}-${ratio}-${y}`, title.top + title.height, Math.min(dimensions.height, title.top + title.height)));
      }

      const footerZero = await readSlot(edition, "m21-footer-zero", ratio, "footer");
      for (const [fixture, offsetX, offsetY] of [
        ["m21-footer-negative", -32, -24],
        ["m21-footer-zero", 0, 0],
        ["m21-footer-positive", 32, 24]
      ]) {
        const footer = await readSlot(edition, fixture, ratio, "footer");
        checks.push(check(`footer-x-${edition}-${ratio}-${fixture}`, footer.left, footerZero.left + offsetX));
        checks.push(check(`footer-y-${edition}-${ratio}-${fixture}`, footer.top, footerZero.top + offsetY));
      }

      for (const [fixture, opacity, background] of [
        ["m21-custom-transparent-0", "0.000", "transparent"],
        ["m21-custom-transparent-50", "0.500", "transparent"],
        ["m21-custom-transparent-100", "1.000", "transparent"],
        ["m21-custom-filled-50", "0.500", "#123456"]
      ]) {
        const layer = await readSlot(edition, fixture, ratio, "layer-m21-text");
        const html = await readScenarioHtml(edition, fixture, ratio);
        checks.push(check(`layer-left-${edition}-${ratio}-${fixture}`, layer.left, dimensions.width * 0.1));
        checks.push(check(`layer-top-${edition}-${ratio}-${fixture}`, layer.top, dimensions.height * 0.2));
        checks.push(check(`layer-width-${edition}-${ratio}-${fixture}`, layer.width, dimensions.width * 0.5));
        checks.push(check(`layer-height-${edition}-${ratio}-${fixture}`, layer.height, dimensions.height * 0.12));
        checks.push(sourceCheck(`layer-opacity-${edition}-${ratio}-${fixture}`, html.includes(`opacity: ${opacity}`)));
        checks.push(sourceCheck(`layer-background-${edition}-${ratio}-${fixture}`, html.includes(`background: ${background}`)));
        checks.push(sourceCheck(`accent-${edition}-${ratio}-${fixture}`, html.toLowerCase().includes("#12abef")));
      }
    }
  }
  await fs.writeFile(path.join(evidenceDir, "m21-geometry-summary.json"), `${JSON.stringify({
    schemaVersion: 1,
    tolerancePixels: 2,
    failed: checks.filter((item) => item.result === "fail").length,
    passed: checks.filter((item) => item.result === "pass").length,
    checks
  }, null, 2)}\n`, "utf8");
  return checks;
}

async function readSlot(edition, fixture, ratio, slot) {
  const slotsPath = path.join(scenarioPath(edition, fixture, ratio), "slots.json");
  const slots = JSON.parse(await fs.readFile(slotsPath, "utf8"));
  const metric = slots.find((item) => item.slot === slot);
  if (!metric) throw new Error(`Missing slot ${slot}: ${slotsPath}`);
  return metric;
}

async function readScenarioHtml(edition, fixture, ratio) {
  return fs.readFile(path.join(scenarioPath(edition, fixture, ratio), "card-01.html"), "utf8");
}

function scenarioPath(edition, fixture, ratio) {
  return path.join(evidenceDir, ["geometry", edition, fixture, ratio.replace(":", "x"), "1"].join("-"));
}

function check(id, actual, expected) {
  const errorPixels = Math.abs(actual - expected);
  return { id, actual, expected, errorPixels, result: errorPixels <= 2 ? "pass" : "fail" };
}

function sourceCheck(id, passed) {
  return { id, result: passed ? "pass" : "fail" };
}

function ratioDimensions(ratio) {
  return {
    "4:5": { width: 1080, height: 1350 },
    "1:1": { width: 1080, height: 1080 },
    "16:9": { width: 1920, height: 1080 },
    "4:3": { width: 1440, height: 1080 }
  }[ratio];
}

async function runScenario({ edition, fixture, kind, ratio, scale }) {
  const scenarioId = [
    kind,
    edition,
    fixture,
    ratio.replace(":", "x"),
    String(scale).replace(".", "p")
  ].join("-");
  const scenarioDir = path.join(evidenceDir, scenarioId);
  await fs.rm(scenarioDir, { recursive: true, force: true });
  await fs.mkdir(scenarioDir, { recursive: true });
  const resultPath = path.join(scenarioDir, "result.json");
  const processResult = await runProcess(electronPath, [
    `--force-device-scale-factor=${scale}`,
    harnessPath,
    "--edition",
    edition,
    "--ratio",
    ratio,
    "--scale",
    String(scale),
    "--fixture",
    fixture,
    "--output-dir",
    scenarioDir,
    "--result",
    resultPath
  ]);
  const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
  const row = {
    ...(result.actual ? { actual: result.actual } : {}),
    code: result.code,
    edition,
    exitCode: processResult.exitCode,
    fixture,
    ...(result.internalErrorName ? { internalErrorName: result.internalErrorName } : {}),
    kind,
    ratio,
    result: result.result,
    scale,
    stderr: processResult.stderr.trim(),
    stdout: processResult.stdout.trim()
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}

function runProcess(command, childArgs) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(command, childArgs, {
      cwd: root,
      env: environment,
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

function validateEdition(value) {
  if (value !== "lite" && value !== "pro") {
    throw new Error(`Unsupported edition: ${value}`);
  }
  return value;
}
