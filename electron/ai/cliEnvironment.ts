import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiProviderId } from "../../src/domain/types.js";

export type ProviderInvocationContext = {
  readonly env: NodeJS.ProcessEnv;
  readonly cleanup: () => void;
};

const temporaryCodexHomePrefix = "cardnews-codex-";
const staleCodexHomeAgeMs = 24 * 60 * 60 * 1_000;
let defaultStaleCleanupCompleted = false;

const baseEnvironmentKeys = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "ComSpec",
  "COMSPEC",
  "HOME",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "Path",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR"
] as const;

const discoveryEnvironmentKeys = [
  "CARDNEWS_CLAUDE_PATH",
  "CARDNEWS_CODEX_PATH",
  "CARDNEWS_GEMINI_PATH",
  "CARDNEWS_NPM_GLOBAL_PREFIX"
] as const;

const providerCredentialKeys: Readonly<Record<AiProviderId, readonly string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CONFIG_DIR"],
  codex: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
};

export function buildProviderProbeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return pickEnvironment(source, [...baseEnvironmentKeys, ...discoveryEnvironmentKeys]);
}

export function buildProviderRunEnv(
  providerId: AiProviderId,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return pickEnvironment(source, [...baseEnvironmentKeys, ...providerCredentialKeys[providerId]]);
}

export function createProviderInvocationContext(
  providerId: AiProviderId,
  sourceEnv: NodeJS.ProcessEnv = process.env,
  tempRoot = os.tmpdir()
): ProviderInvocationContext {
  const env = buildProviderRunEnv(providerId, sourceEnv);
  if (providerId !== "codex") {
    return { env, cleanup: () => undefined };
  }

  cleanStaleHomesOnce(tempRoot);
  const sourceCodexHome = sourceEnv["CODEX_HOME"]?.trim() || path.join(os.homedir(), ".codex");
  const temporaryCodexHome = fs.mkdtempSync(path.join(tempRoot, temporaryCodexHomePrefix));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    removeTemporaryCodexHome(temporaryCodexHome);
  };

  try {
    fs.chmodSync(temporaryCodexHome, 0o700);
    copyCodexAuthentication(sourceCodexHome, temporaryCodexHome);
    env["CODEX_HOME"] = temporaryCodexHome;
    return { env, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function cleanupStaleCodexHomes(options: {
  readonly now?: number;
  readonly tempRoot?: string;
} = {}): void {
  const now = options.now ?? Date.now();
  const tempRoot = options.tempRoot ?? os.tmpdir();
  let names: readonly string[];
  try {
    names = fs.readdirSync(tempRoot);
  } catch {
    return;
  }

  for (const name of names) {
    if (!name.startsWith(temporaryCodexHomePrefix)) {
      continue;
    }
    removeStaleCodexHome(path.join(tempRoot, name), now);
  }
}

function cleanStaleHomesOnce(tempRoot: string): void {
  if (path.resolve(tempRoot) !== path.resolve(os.tmpdir())) {
    cleanupStaleCodexHomes({ tempRoot });
    return;
  }
  if (defaultStaleCleanupCompleted) {
    return;
  }
  cleanupStaleCodexHomes({ tempRoot });
  defaultStaleCleanupCompleted = true;
}

function copyCodexAuthentication(sourceCodexHome: string, temporaryCodexHome: string): void {
  const sourceAuth = path.join(sourceCodexHome, "auth.json");
  if (!fs.existsSync(sourceAuth)) {
    return;
  }
  const temporaryAuth = path.join(temporaryCodexHome, "auth.json");
  fs.copyFileSync(sourceAuth, temporaryAuth);
  fs.chmodSync(temporaryAuth, 0o600);
}

function removeStaleCodexHome(candidate: string, now: number): void {
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory() || now - stat.mtimeMs < staleCodexHomeAgeMs) {
      return;
    }
    removeTemporaryCodexHome(candidate);
  } catch {
    console.warn("A stale Codex temporary authentication directory could not be inspected.");
  }
}

function pickEnvironment(source: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = source[key];
    if (value) {
      env[key] = value;
    }
  }
  env["NO_COLOR"] = "1";
  return env;
}

function removeTemporaryCodexHome(directory: string): void {
  try {
    fs.rmSync(directory, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100
    });
  } catch {
    console.warn("Codex temporary authentication cleanup did not complete.");
  }
}
