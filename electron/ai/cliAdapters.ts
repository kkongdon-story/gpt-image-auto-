import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type {
  AiChatMessage,
  AiChatResult,
  AiProviderId,
  AiProviderStatus,
  CardnewsError,
  CardnewsResult
} from "../../src/domain/types.js";
import { buildMockDraftDocument } from "../../src/edition/pro/ai/aiPrompts.js";

type AiCliProvider = {
  readonly id: AiProviderId;
  readonly label: string;
  readonly versionCommand: string;
  readonly runCommand: string;
  readonly installHint: string;
};

const maxOutputBytes = 10 * 1024 * 1024;
const defaultTimeoutMs = 120_000;

const providerDefinitions: readonly AiCliProvider[] = [
  {
    id: "claude",
    label: "Claude Code",
    versionCommand: "claude --version",
    runCommand: "claude -p",
    installHint: "npm install -g @anthropic-ai/claude-code"
  },
  {
    id: "codex",
    label: "Codex CLI",
    versionCommand: "codex --version",
    runCommand: "codex exec -",
    installHint: "npm install -g @openai/codex"
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    versionCommand: "gemini --version",
    runCommand: "gemini --prompt \"\"",
    installHint: "npm install -g @google/gemini-cli"
  }
];

export function isAiProviderId(input: unknown): input is AiProviderId {
  return typeof input === "string" && providerDefinitions.some((provider) => provider.id === input);
}

export function listAiProviderStatuses(): readonly AiProviderStatus[] {
  return providerDefinitions.map((provider) => detectProvider(provider));
}

export async function runAiProviderChat(
  providerId: AiProviderId,
  messages: readonly AiChatMessage[],
  options: { readonly cwd: string; readonly timeoutMs?: number }
): Promise<CardnewsResult<AiChatResult>> {
  if (process.env["CARDNEWS_MOCK_AI"] === "1") {
    return { providerId, content: buildMockDraftDocument() };
  }

  const provider = providerDefinitions.find((entry) => entry.id === providerId);
  if (!provider) {
    return invalidInput("지원하지 않는 AI provider입니다.");
  }

  const prompt = serializeMessages(messages);
  if (prompt.trim().length === 0) {
    return invalidInput("AI에 보낼 메시지가 비어 있습니다.");
  }

  const status = detectProvider(provider);
  if (!status.installed) {
    return externalServiceFailed(`${provider.label} CLI를 찾지 못했습니다. 설치 안내: ${provider.installHint}`);
  }

  return runProvider(provider, prompt, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? defaultTimeoutMs
  });
}

export function serializeMessages(messages: readonly AiChatMessage[]): string {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n---\n\n");
}

function detectProvider(provider: AiCliProvider): AiProviderStatus {
  const detected = spawnSync(provider.versionCommand, {
    encoding: "utf8",
    shell: true,
    timeout: 5_000,
    windowsHide: true
  });
  const output = `${detected.stdout ?? ""}\n${detected.stderr ?? ""}`.trim();
  const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0);
  return {
    id: provider.id,
    label: provider.label,
    installed: detected.status === 0,
    installHint: provider.installHint,
    ...(firstLine ? { version: firstLine.trim() } : {})
  };
}

function runProvider(
  provider: AiCliProvider,
  prompt: string,
  options: { readonly cwd: string; readonly timeoutMs: number }
): Promise<CardnewsResult<AiChatResult>> {
  return new Promise((resolve) => {
    const child = spawn(provider.runCommand, {
      cwd: path.resolve(options.cwd),
      env: buildCliEnv(),
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolve(externalServiceFailed(`${provider.label} 응답 시간이 초과되었습니다.`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout = appendChunk(stdout, chunk);
      if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        resolve(externalServiceFailed(`${provider.label} 응답이 10MB를 초과했습니다.`));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = appendChunk(stderr, chunk);
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(externalServiceFailed(`${provider.label} 실행 실패: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const message = stderr.trim() || `${provider.label} CLI가 exit ${code ?? "signal"}로 종료되었습니다.`;
        resolve(externalServiceFailed(message));
        return;
      }
      const content = stdout.trim();
      if (!content) {
        resolve(externalServiceFailed(`${provider.label} 응답이 비어 있습니다.`));
        return;
      }
      resolve({ providerId: provider.id, content });
    });

    if (!child.stdin) {
      clearTimeout(timer);
      settled = true;
      child.kill();
      resolve(externalServiceFailed(`${provider.label} stdin을 열지 못했습니다.`));
      return;
    }
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function appendChunk(current: string, chunk: Buffer | string): string {
  return current + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
}

function buildCliEnv(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "ALLUSERSPROFILE",
    "ANTHROPIC_AUTH_TOKEN",
    "APPDATA",
    "CODEX_HOME",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "HOME",
    "LOCALAPPDATA",
    "OPENAI_API_KEY",
    "PATH",
    "PATHEXT",
    "Path",
    "TEMP",
    "TMP",
    "USERPROFILE"
  ] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  env["NO_COLOR"] = "1";
  return env;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}

function externalServiceFailed(message: string): CardnewsError {
  return { ok: false, code: "external_service_failed", message };
}
