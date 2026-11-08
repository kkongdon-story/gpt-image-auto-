import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { AiChatResult, CardnewsResult } from "../../src/domain/types.js";
import {
  createProviderInvocationContext,
  terminateProviderProcessTree
} from "./cliRuntime.js";
import type { ProviderInvocationContext, ResolvedAiProviderExecutable } from "./cliRuntime.js";
import { buildProviderCommand } from "./cliProviderDefinitions.js";
import type { AiCliProvider } from "./cliProviderDefinitions.js";
import { externalServiceFailed, mapAiProviderError } from "./cliProviderErrors.js";

const maxOutputBytes = 10 * 1024 * 1024;
const maxDiagnosticBytes = 256 * 1024;
const processCloseFallbackMs = 1_000;

export function runProvider(
  provider: AiCliProvider,
  prompt: string,
  options: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly executable?: ResolvedAiProviderExecutable;
  }
): Promise<CardnewsResult<AiChatResult>> {
  return new Promise((resolve) => {
    const command = buildProviderCommand(provider.id, options.executable);
    let invocation: ProviderInvocationContext;
    try {
      invocation = createProviderInvocationContext(provider.id);
    } catch {
      resolve(
        externalServiceFailed(
          `${provider.label} 인증 정보를 안전한 임시 실행 환경에 준비하지 못했습니다. CLI 로그인을 다시 확인해주세요.`
        )
      );
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command.file, [...command.args], {
        cwd: path.resolve(options.cwd),
        detached: process.platform !== "win32",
        env: invocation.env,
        shell: command.shell,
        stdio: ["pipe", "pipe", "pipe"],
        ...(command.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        windowsHide: true
      });
    } catch (error) {
      invocation.cleanup();
      const message = error instanceof Error ? error.message : "CLI 프로세스를 시작하지 못했습니다.";
      resolve(externalServiceFailed(mapAiProviderError(provider.label, `${provider.label} 실행 실패: ${message}`)));
      return;
    }

    observeProviderProcess(child, provider, invocation, prompt, options.timeoutMs, resolve);
  });
}

function observeProviderProcess(
  child: ChildProcessWithoutNullStreams,
  provider: AiCliProvider,
  invocation: ProviderInvocationContext,
  prompt: string,
  timeoutMs: number,
  resolve: (result: CardnewsResult<AiChatResult>) => void
): void {
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let settled = false;
  let terminating = false;
  let timer: NodeJS.Timeout | undefined;

  const complete = (result: CardnewsResult<AiChatResult>): void => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
    }
    invocation.cleanup();
    resolve(result);
  };

  const terminateAndComplete = (result: CardnewsResult<AiChatResult>): void => {
    if (settled || terminating) {
      return;
    }
    terminating = true;
    if (timer) {
      clearTimeout(timer);
    }
    let fallback: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (fallback) {
        clearTimeout(fallback);
      }
      complete(result);
    };
    child.once("close", finish);
    terminateProviderProcessTree(child);
    fallback = setTimeout(() => {
      terminateProviderProcessTree(child);
      finish();
    }, processCloseFallbackMs);
    fallback.unref();
  };

  timer = setTimeout(() => {
    terminateAndComplete(
      externalServiceFailed(`${provider.label} 응답 시간이 ${formatDuration(timeoutMs)}(${timeoutMs}ms)을 초과했습니다.`)
    );
  }, timeoutMs);

  child.stdout.on("data", (chunk: Buffer | string) => {
    if (settled || terminating) {
      return;
    }
    const text = chunkToString(chunk);
    stdoutBytes += Buffer.byteLength(text, "utf8");
    stdout += text;
    if (stdoutBytes > maxOutputBytes) {
      terminateAndComplete(externalServiceFailed(`${provider.label} 응답이 10MB를 초과했습니다.`));
    }
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (!settled && !terminating) {
      stderr = appendBoundedChunk(stderr, chunk, maxDiagnosticBytes);
    }
  });
  child.once("error", (error) => {
    if (settled || terminating) {
      return;
    }
    const result = externalServiceFailed(
      mapAiProviderError(provider.label, `${provider.label} 실행 실패: ${error.message}`)
    );
    if (child.pid) {
      terminateAndComplete(result);
    } else {
      complete(result);
    }
  });
  child.once("close", (code) => {
    if (settled || terminating) {
      return;
    }
    if (code !== 0) {
      const message = stderr.trim() || `${provider.label} CLI가 exit ${code ?? "signal"}로 종료되었습니다.`;
      complete(externalServiceFailed(mapAiProviderError(provider.label, message)));
      return;
    }
    const content = stdout.trim();
    if (!content) {
      complete(externalServiceFailed(`${provider.label} 응답이 비어 있습니다.`));
      return;
    }
    complete({ providerId: provider.id, content });
  });

  writePrompt(child, provider, prompt, terminateAndComplete);
}

function writePrompt(
  child: ChildProcessWithoutNullStreams,
  provider: AiCliProvider,
  prompt: string,
  terminateAndComplete: (result: CardnewsResult<AiChatResult>) => void
): void {
  child.stdin.once("error", (error) => {
    terminateAndComplete(
      externalServiceFailed(mapAiProviderError(provider.label, `${provider.label} 입력 전달 실패: ${error.message}`))
    );
  });
  try {
    child.stdin.write(prompt);
    child.stdin.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "입력을 전달하지 못했습니다.";
    terminateAndComplete(
      externalServiceFailed(mapAiProviderError(provider.label, `${provider.label} 입력 전달 실패: ${message}`))
    );
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) {
    return `${minutes}분 ${seconds}초`;
  }
  if (minutes > 0) {
    return `${minutes}분`;
  }
  return `${seconds}초`;
}

function appendBoundedChunk(current: string, chunk: Buffer | string, maxBytes: number): string {
  const appended = current + chunkToString(chunk);
  if (Buffer.byteLength(appended, "utf8") <= maxBytes) {
    return appended;
  }
  return Buffer.from(appended, "utf8").subarray(-maxBytes).toString("utf8");
}

function chunkToString(chunk: Buffer | string): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8");
}
