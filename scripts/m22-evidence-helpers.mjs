import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const defaultEvidenceRoot = ".omc/evidence/v6/m22-media-video-canvas-ai";

export function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2).replaceAll(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = tokens[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

export function timestampRunId(prefix = "run") {
  return `${prefix}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function appendLog(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}

export async function findFiles(directory, options = {}) {
  const maxDepth = options.maxDepth ?? 12;
  const found = [];
  async function visit(current, depth) {
    if (depth > maxDepth) {
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
      } else if (entry.isFile()) {
        found.push(entryPath);
      }
    }
  }
  await visit(directory, 0);
  return found.sort();
}

export function toPortablePath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

export function isBinaryCandidate(filePath) {
  return new Set([".exe", ".dll", ".so", ".dylib", ".zip", ".7z", ".tar", ".gz", ".xz"]).has(
    path.extname(filePath).toLowerCase()
  );
}

export function isPlaceholderSha(value) {
  return /^0{64}$/.test(String(value ?? ""));
}

export function hasForbiddenToken(text) {
  const normalized = text.toLowerCase();
  return ["--enable-gpl", "--enable-nonfree", "--enable-libx264"].find((token) => normalized.includes(token));
}

export function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timeout = options.timeoutMs ?? 30000;
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nProcess timed out after ${timeout}ms.`;
    }, timeout);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
