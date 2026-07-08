import { extractAll } from "@electron/asar";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const forbiddenLiteSymbols = [
  "renderBulkCsv",
  "cardnews:renderBulkCsv",
  "importBulkCsvFile",
  "exportBulkCsvTemplate",
  "removeImageBackground",
  "cardnews:removeImageBackground",
  "exportProject",
  "cardnews:exportProject",
  "importProject",
  "cardnews:importProject",
  "registerProHandlers",
  "aiChat",
  "ai:chat",
  "cardnews:ai:listProviders",
  "cardnews:ai:chat",
  "runAiChat",
  "runAiProviderChat",
  "listAiProviders",
  "listAiProviderStatuses",
  "ai-draft-regression",
  "ProPanels"
];

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".xml"
]);

function parseArgs(argv) {
  let edition = "lite";
  const scanPaths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--edition") {
      edition = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--scan") {
      for (const candidate of argv.slice(index + 1)) {
        scanPaths.push(candidate);
      }
      break;
    }
  }

  return { edition, scanPaths };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  const files = [];
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function expandScanPath(targetPath, tempRoots) {
  if (!(await pathExists(targetPath))) {
    return [];
  }

  if (targetPath.endsWith(".asar")) {
    const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-edition-"));
    tempRoots.push(extractRoot);
    extractAll(targetPath, extractRoot);
    return listFiles(extractRoot);
  }

  const stat = await fs.stat(targetPath);
  if (stat.isDirectory()) {
    const files = await listFiles(targetPath);
    const expanded = [];
    for (const file of files) {
      if (file.endsWith(".asar")) {
        expanded.push(...(await expandScanPath(file, tempRoots)));
      } else {
        expanded.push(file);
      }
    }
    return expanded;
  }

  return [targetPath];
}

async function scanTextFile(filePath) {
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
    return [];
  }

  const stat = await fs.stat(filePath);
  if (stat.size > 8 * 1024 * 1024) {
    return [];
  }

  const text = await fs.readFile(filePath, "utf8");
  return forbiddenLiteSymbols
    .filter((symbol) => text.includes(symbol))
    .map((symbol) => ({ filePath, symbol }));
}

async function main() {
  const { edition, scanPaths } = parseArgs(process.argv.slice(2));
  if (edition !== "lite") {
    console.log(`verify-edition: ${edition} has no Lite stripping rule.`);
    return;
  }

  const targets = scanPaths.length > 0 ? scanPaths : ["dist", "dist-electron"];
  const tempRoots = [];
  const findings = [];
  try {
    for (const target of targets) {
      const absoluteTarget = path.resolve(process.cwd(), target);
      const files = await expandScanPath(absoluteTarget, tempRoots);
      for (const file of files) {
        findings.push(...(await scanTextFile(file)));
      }
    }
  } finally {
    await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  }

  if (findings.length > 0) {
    console.error("verify-edition failed: Lite artifact contains Pro-only symbols.");
    for (const finding of findings) {
      console.error(`- ${path.relative(process.cwd(), finding.filePath)} :: ${finding.symbol}`);
    }
    process.exit(1);
  }

  console.log(`verify-edition passed: ${targets.join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
