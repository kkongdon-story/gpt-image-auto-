import path from "node:path";
import type {
  AiChatMessage,
  AiChatResult,
  AiProviderId,
  CardnewsResult
} from "../../src/domain/types.js";
import {
  buildProviderCommand,
  getAiProviderDefinition,
  isAiProviderId
} from "./cliProviderDefinitions.js";
import {
  clearAiProviderStatusCache,
  detectProviderCached,
  listAiProviderStatuses
} from "./cliProviderDiscovery.js";
import { externalServiceFailed, invalidInput, mapAiProviderError } from "./cliProviderErrors.js";
import { runProvider } from "./cliProviderProcess.js";

export { buildProviderCommand, clearAiProviderStatusCache, isAiProviderId, listAiProviderStatuses, mapAiProviderError };

export const defaultProviderTimeoutMs = 300_000;
const minProviderTimeoutMs = 30_000;
const maxProviderTimeoutMs = 900_000;

export function resolveAiProviderCwd(input: {
  readonly explicitWorkspaceCwd?: string | undefined;
  readonly processCwd: string;
  readonly storageRoot: string;
}): string {
  const candidates = [input.explicitWorkspaceCwd, input.storageRoot, input.processCwd];
  const selected = candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return path.resolve(selected ?? input.storageRoot);
}

export async function runAiProviderChat(
  providerId: AiProviderId,
  messages: readonly AiChatMessage[],
  options: { readonly cwd: string; readonly timeoutMs?: number; readonly allowMock?: boolean }
): Promise<CardnewsResult<AiChatResult>> {
  const provider = getAiProviderDefinition(providerId);
  const providerLabel = provider?.label ?? "AI";
  if (options.allowMock === true) {
    const mockError = process.env["CARDNEWS_MOCK_AI_ERROR"];
    if (mockError) {
      return externalServiceFailed(mapAiProviderError(providerLabel, mockError));
    }

    if (process.env["CARDNEWS_MOCK_AI"] === "1") {
      const { buildMockAiResponse, waitForMockAiDelay } = await import("./cliMock.js");
      await waitForMockAiDelay();
      return { providerId, content: buildMockAiResponse(messages) };
    }
  }
  if (!provider) {
    return invalidInput("지원하지 않는 AI provider입니다.");
  }

  const prompt = serializeMessages(messages);
  if (prompt.trim().length === 0) {
    return invalidInput("AI에 보낼 메시지가 비어 있습니다.");
  }

  const status = detectProviderCached(provider);
  if (!status.installed) {
    return externalServiceFailed(`${provider.label} CLI를 찾지 못했습니다. 설치 안내: ${provider.installHint}`);
  }

  return runProvider(provider, prompt, {
    cwd: resolveAiProviderCwd({
      explicitWorkspaceCwd: process.env["CARDNEWS_AI_WORKSPACE_CWD"],
      processCwd: process.cwd(),
      storageRoot: options.cwd
    }),
    timeoutMs: options.timeoutMs ?? resolveAiProviderTimeoutMs(),
    ...(status.executable ? { executable: status.executable } : {})
  });
}

export function resolveAiProviderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const rawValue = env["CARDNEWS_AI_TIMEOUT_MS"];
  if (!rawValue) {
    return defaultProviderTimeoutMs;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return defaultProviderTimeoutMs;
  }
  const timeoutMs = Math.trunc(parsed);
  if (timeoutMs < minProviderTimeoutMs || timeoutMs > maxProviderTimeoutMs) {
    return defaultProviderTimeoutMs;
  }
  return timeoutMs;
}

export function serializeMessages(messages: readonly AiChatMessage[]): string {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n---\n\n");
}
