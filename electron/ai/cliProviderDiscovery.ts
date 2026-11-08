import { spawnSync } from "node:child_process";
import type { AiProviderId, AiProviderStatus } from "../../src/domain/types.js";
import {
  buildExecutableInvocation,
  buildProviderProbeEnv,
  describeExecutableSource,
  resolveAiProviderExecutableCandidates,
  sanitizeProviderVersion,
  shouldProbeExecutableCandidate
} from "./cliRuntime.js";
import type { AiProviderCommand, ResolvedAiProviderExecutable } from "./cliRuntime.js";
import {
  listAiProviderInstallRecipeSummaries,
  providerDefinitions
} from "./cliProviderDefinitions.js";
import type { AiCliProvider } from "./cliProviderDefinitions.js";

export type DetectedAiProviderStatus = AiProviderStatus & {
  readonly executable?: ResolvedAiProviderExecutable;
};

const providerStatusCacheTtlMs = 30_000;
const providerStatusCache = new Map<
  AiProviderId,
  { readonly expiresAt: number; readonly status: DetectedAiProviderStatus }
>();

export function listAiProviderStatuses(options: { readonly forceRefresh?: boolean } = {}): readonly AiProviderStatus[] {
  const statuses = providerDefinitions.map((provider) =>
    detectProviderCached(provider, options.forceRefresh === true)
  );
  return dedupeProviderStatuses(statuses);
}

export function clearAiProviderStatusCache(): void {
  providerStatusCache.clear();
}

export function detectProviderCached(
  provider: AiCliProvider,
  forceRefresh = false
): DetectedAiProviderStatus {
  const cached = providerStatusCache.get(provider.id);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.status;
  }

  const status = detectProvider(provider);
  providerStatusCache.set(provider.id, { expiresAt: Date.now() + providerStatusCacheTtlMs, status });
  return status;
}

function detectProvider(provider: AiCliProvider): DetectedAiProviderStatus {
  const [file, ...args] = provider.versionCommand;
  if (!file) {
    return unavailableStatus(provider, "provider version command is empty");
  }

  const probeEnv = buildProviderProbeEnv();
  const candidates = resolveAiProviderExecutableCandidates(provider.id, file, probeEnv);
  for (const candidate of candidates) {
    const status = probeCandidate(provider, candidate, args, probeEnv);
    if (status) {
      return status;
    }
  }

  return unavailableStatus(provider, `not found on PATH, where.exe, or common npm global paths for ${file}`);
}

function probeCandidate(
  provider: AiCliProvider,
  candidate: ResolvedAiProviderExecutable,
  args: readonly string[],
  probeEnv: NodeJS.ProcessEnv
): DetectedAiProviderStatus | undefined {
  if (!shouldProbeExecutableCandidate(candidate)) {
    return undefined;
  }
  let command: AiProviderCommand;
  try {
    command = buildExecutableInvocation(candidate.file, args);
  } catch {
    return undefined;
  }
  const detected = spawnSync(command.file, [...command.args], {
    encoding: "utf8",
    env: probeEnv,
    shell: command.shell,
    timeout: 5_000,
    ...(command.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    windowsHide: true
  });
  if (detected.status !== 0) {
    return undefined;
  }

  const output = `${detected.stdout ?? ""}\n${detected.stderr ?? ""}`.trim();
  const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0);
  const version = firstLine ? sanitizeProviderVersion(firstLine) : undefined;
  return {
    id: provider.id,
    label: provider.label,
    installed: true,
    installHint: provider.installHint,
    installRecipes: listAiProviderInstallRecipeSummaries(provider.id),
    executable: candidate,
    diagnostic: describeExecutableSource(candidate),
    ...(version ? { version } : {})
  };
}

function unavailableStatus(provider: AiCliProvider, diagnostic: string): DetectedAiProviderStatus {
  return {
    id: provider.id,
    label: provider.label,
    installed: false,
    installHint: provider.installHint,
    installRecipes: listAiProviderInstallRecipeSummaries(provider.id),
    diagnostic
  };
}

function dedupeProviderStatuses(statuses: readonly DetectedAiProviderStatus[]): readonly AiProviderStatus[] {
  const seen = new Set<AiProviderId>();
  const deduped: AiProviderStatus[] = [];
  for (const status of statuses) {
    if (seen.has(status.id)) {
      continue;
    }
    seen.add(status.id);
    const { executable: _executable, ...publicStatus } = status;
    deduped.push(publicStatus);
  }
  return deduped;
}
