import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiProviderId } from "../../src/domain/types.js";

export type ResolvedAiProviderExecutable = {
  readonly file: string;
  readonly source: "env" | "path" | "where" | "appdata" | "npm-prefix" | "common";
};

export type AiProviderCommand = {
  readonly file: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly windowsVerbatimArguments?: true;
};

export function resolveAiProviderExecutableCandidates(
  providerId: AiProviderId,
  commandName: string,
  env: NodeJS.ProcessEnv
): readonly ResolvedAiProviderExecutable[] {
  const candidates: ResolvedAiProviderExecutable[] = [];
  const envOverride = env[`CARDNEWS_${providerId.toUpperCase()}_PATH`];
  if (envOverride?.trim()) {
    candidates.push({ file: envOverride.trim(), source: "env" });
  }

  candidates.push({ file: commandName, source: "path" });
  candidates.push(...findWhereCandidates(commandName, env));
  candidates.push(...findNpmPrefixCandidates(commandName, env));
  candidates.push(...findWindowsAppDataCandidates(commandName, env));
  candidates.push(...findCommonWindowsCandidates(commandName, env));
  return uniqueExecutableCandidates(candidates);
}

export function shouldProbeExecutableCandidate(candidate: ResolvedAiProviderExecutable): boolean {
  return candidate.source === "path" || fs.existsSync(candidate.file);
}

export function buildExecutableInvocation(file: string, args: readonly string[]): AiProviderCommand {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(file)) {
    const commandLine = ["call", quoteWindowsCommandArg(file), ...args.map(quoteWindowsCommandArg)].join(" ");
    const windowsRoot = resolveWindowsRoot(process.env);
    return {
      file: path.join(windowsRoot, "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", commandLine],
      shell: false,
      windowsVerbatimArguments: true
    };
  }
  return { file, args, shell: false };
}

export function describeExecutableSource(candidate: ResolvedAiProviderExecutable): string {
  switch (candidate.source) {
    case "env":
      return "환경변수에 지정된 CLI 경로를 사용합니다.";
    case "where":
      return "Windows where.exe로 CLI 경로를 찾았습니다.";
    case "appdata":
      return "%APPDATA%\\npm 전역 설치 경로에서 CLI를 찾았습니다.";
    case "npm-prefix":
      return "npm global prefix 경로에서 CLI를 찾았습니다.";
    case "common":
      return "일반 사용자 설치 경로에서 CLI를 찾았습니다.";
    case "path":
      return "PATH에서 CLI를 찾았습니다.";
  }
}

export function sanitizeProviderVersion(input: string): string | undefined {
  const withoutAnsi = stripAnsi(input);
  if (/[\r\n]/u.test(withoutAnsi)) {
    return undefined;
  }
  const normalized = withoutAnsi.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,119}$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function findWhereCandidates(commandName: string, env: NodeJS.ProcessEnv): readonly ResolvedAiProviderExecutable[] {
  if (process.platform !== "win32") {
    return [];
  }
  const whereExe = path.join(resolveWindowsRoot(env), "System32", "where.exe");
  const result = spawnSync(whereExe, [commandName], {
    encoding: "utf8",
    env,
    shell: false,
    timeout: 3_000,
    windowsHide: true
  });
  if (result.status !== 0) {
    return [];
  }
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((candidateFile) => ({ file: candidateFile, source: "where" as const }));
}

function resolveWindowsRoot(env: NodeJS.ProcessEnv): string {
  return env["WINDIR"]?.trim() || env["SystemRoot"]?.trim() || "C:\\Windows";
}

function findNpmPrefixCandidates(commandName: string, env: NodeJS.ProcessEnv): readonly ResolvedAiProviderExecutable[] {
  const npmPrefix = env["CARDNEWS_NPM_GLOBAL_PREFIX"];
  if (!npmPrefix?.trim()) {
    return [];
  }
  return appendWindowsCommandExtensions(path.join(npmPrefix.trim(), commandName)).map((candidateFile) => ({
    file: candidateFile,
    source: "npm-prefix" as const
  }));
}

function findWindowsAppDataCandidates(commandName: string, env: NodeJS.ProcessEnv): readonly ResolvedAiProviderExecutable[] {
  if (process.platform !== "win32") {
    return [];
  }
  const appData = env["APPDATA"];
  if (!appData?.trim()) {
    return [];
  }
  return appendWindowsCommandExtensions(path.join(appData.trim(), "npm", commandName)).map((candidateFile) => ({
    file: candidateFile,
    source: "appdata" as const
  }));
}

function findCommonWindowsCandidates(commandName: string, env: NodeJS.ProcessEnv): readonly ResolvedAiProviderExecutable[] {
  if (process.platform !== "win32") {
    return [];
  }
  const roots = [env["LOCALAPPDATA"], env["USERPROFILE"], os.homedir()].filter(
    (root): root is string => typeof root === "string" && root.trim().length > 0
  );
  const bases = roots.flatMap((root) => [
    path.join(root, "AppData", "Roaming", "npm", commandName),
    path.join(root, "npm", commandName)
  ]);
  return bases.flatMap((base) =>
    appendWindowsCommandExtensions(base).map((candidateFile) => ({
      file: candidateFile,
      source: "common" as const
    }))
  );
}

function appendWindowsCommandExtensions(basePath: string): readonly string[] {
  if (process.platform !== "win32") {
    return [basePath];
  }
  return [basePath, `${basePath}.cmd`, `${basePath}.bat`, `${basePath}.exe`];
}

function uniqueExecutableCandidates(
  candidates: readonly ResolvedAiProviderExecutable[]
): readonly ResolvedAiProviderExecutable[] {
  const seen = new Set<string>();
  const unique: ResolvedAiProviderExecutable[] = [];
  for (const candidate of candidates) {
    const key = process.platform === "win32" ? candidate.file.toLocaleLowerCase("en-US") : candidate.file;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function quoteWindowsCommandArg(input: string): string {
  if (/[&|<>^%!"\r\n]/u.test(input)) {
    throw new Error("Unsafe Windows command script path or argument.");
  }
  if (input.length === 0) {
    return '""';
  }
  if (/^[A-Za-z0-9_./:=+-]+$/.test(input)) {
    return input;
  }
  return `"${input}"`;
}
