import fs from "node:fs";
import path from "node:path";

export function withEnv<T>(patch: Record<string, string | undefined>, callback: () => T): T {
  const previous = applyEnvPatch(patch);
  try {
    return callback();
  } finally {
    restoreEnv(previous);
  }
}

export async function withEnvAsync<T>(
  patch: Record<string, string | undefined>,
  callback: () => Promise<T>
): Promise<T> {
  const previous = applyEnvPatch(patch);
  try {
    return await callback();
  } finally {
    restoreEnv(previous);
  }
}

export function writeFakeCli(
  directory: string,
  name: string,
  behavior: {
    readonly version: string;
    readonly delaySeconds?: number;
    readonly metadataPath?: string;
  }
): string {
  fs.mkdirSync(directory, { recursive: true });
  const runnerPath = path.join(directory, `${name}-runner.js`);
  const delayMs = Math.max(0, behavior.delaySeconds ?? 1) * 1000;
  fs.writeFileSync(
    runnerPath,
    [
      'const fs = require("node:fs");',
      `const metadataPath = ${JSON.stringify(behavior.metadataPath ?? "")};`,
      'if (metadataPath) fs.writeFileSync(metadataPath, JSON.stringify({ pid: process.pid, codexHome: process.env["CODEX_HOME"] ?? "" }));',
      `setTimeout(() => console.log(${JSON.stringify(`${name} response`)}), ${delayMs});`
    ].join("\n")
  );
  if (process.platform === "win32") {
    const filePath = path.join(directory, `${name}.cmd`);
    fs.writeFileSync(
      filePath,
      [
        "@echo off",
        `if "%1"=="--version" echo ${behavior.version} && exit /b 0`,
        `"${process.execPath}" "${runnerPath}"`,
        "exit /b 0"
      ].join("\r\n")
    );
    return filePath;
  }

  const filePath = path.join(directory, name);
  fs.writeFileSync(
    filePath,
    [
      "#!/usr/bin/env sh",
      `if [ "$1" = "--version" ]; then echo "${behavior.version}"; exit 0; fi`,
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(runnerPath)}`
    ].join("\n")
  );
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessRunning(pid);
}

function applyEnvPatch(patch: Record<string, string | undefined>): Map<string, string | undefined> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return previous;
}

function restoreEnv(previous: ReadonlyMap<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
