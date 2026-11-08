import type {
  AiProviderId,
  AiProviderInstallMethod,
  AiProviderInstallRecipeSummary,
  AiProviderInstallableId
} from "../../src/domain/types.js";
import { buildExecutableInvocation } from "./cliRuntime.js";
import type { AiProviderCommand, ResolvedAiProviderExecutable } from "./cliRuntime.js";

export type AiCliProvider = {
  readonly id: AiProviderId;
  readonly label: string;
  readonly versionCommand: readonly string[];
  readonly runCommand: readonly string[];
  readonly installHint: string;
};

export type AiProviderInstallRecipe = {
  readonly id: string;
  readonly provider: AiProviderInstallableId;
  readonly platform: "windows";
  readonly method: AiProviderInstallMethod;
  readonly command: readonly string[];
  readonly verifyCommand: readonly string[];
  readonly doctorCommand?: readonly string[];
  readonly officialUrl: string;
  readonly prerequisites: readonly string[];
  readonly recommended: boolean;
};

export const providerInstallRecipes: readonly AiProviderInstallRecipe[] = [
  {
    id: "codex-npm",
    provider: "codex",
    platform: "windows",
    method: "npm",
    command: ["npm.cmd", "install", "-g", "@openai/codex"],
    verifyCommand: ["codex", "--version"],
    officialUrl: "https://help.openai.com/en/articles/11096431",
    prerequisites: ["Node.js와 npm이 설치되어 있어야 합니다."],
    recommended: true
  },
  {
    id: "claude-powershell-native",
    provider: "claude",
    platform: "windows",
    method: "powershell-native",
    command: [
      "powershell.exe",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "irm https://claude.ai/install.ps1 | iex"
    ],
    verifyCommand: ["claude", "--version"],
    doctorCommand: ["claude", "doctor"],
    officialUrl: "https://code.claude.com/docs/en/installation",
    prerequisites: ["Windows PowerShell과 인터넷 연결이 필요합니다."],
    recommended: true
  },
  {
    id: "claude-winget",
    provider: "claude",
    platform: "windows",
    method: "winget",
    command: ["winget", "install", "--id", "Anthropic.ClaudeCode", "--exact", "--source", "winget"],
    verifyCommand: ["claude", "--version"],
    doctorCommand: ["claude", "doctor"],
    officialUrl: "https://code.claude.com/docs/en/installation",
    prerequisites: ["Windows 패키지 관리자(winget)와 인터넷 연결이 필요합니다."],
    recommended: false
  }
];

export const providerDefinitions: readonly AiCliProvider[] = [
  {
    id: "claude",
    label: "Claude Code",
    versionCommand: ["claude", "--version"],
    runCommand: ["claude", "-p"],
    installHint: "irm https://claude.ai/install.ps1 | iex"
  },
  {
    id: "codex",
    label: "Codex CLI",
    versionCommand: ["codex", "--version"],
    runCommand: [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "hooks",
      "--disable",
      "plugins",
      "--disable",
      "memories",
      "--disable",
      "multi_agent",
      "--disable",
      "apps",
      "--disable",
      "image_generation",
      "--disable",
      "computer_use",
      "--disable",
      "in_app_browser",
      "--disable",
      "goals",
      "--disable",
      "workspace_dependencies",
      "-"
    ],
    installHint: "npm install -g @openai/codex"
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    versionCommand: ["gemini", "--version"],
    runCommand: ["gemini", "--prompt", ""],
    installHint: "npm install -g @google/gemini-cli"
  }
];

export function isAiProviderId(input: unknown): input is AiProviderId {
  return typeof input === "string" && providerDefinitions.some((provider) => provider.id === input);
}

export function getAiProviderDefinition(providerId: AiProviderId): AiCliProvider | undefined {
  return providerDefinitions.find((entry) => entry.id === providerId);
}

export function getAiProviderInstallRecipe(
  providerId: AiProviderId,
  recipeId: string
): AiProviderInstallRecipe | undefined {
  return providerInstallRecipes.find(
    (recipe) => recipe.provider === providerId && recipe.id === recipeId
  );
}

export function listAiProviderInstallRecipeSummaries(
  providerId: AiProviderId
): readonly AiProviderInstallRecipeSummary[] {
  return providerInstallRecipes
    .filter((recipe) => recipe.provider === providerId)
    .map((recipe) => ({
      id: recipe.id,
      provider: recipe.provider,
      platform: recipe.platform,
      method: recipe.method,
      commandDisplay: recipe.command.join(" "),
      verifyCommandDisplay: recipe.verifyCommand.join(" "),
      ...(recipe.doctorCommand
        ? { doctorCommandDisplay: recipe.doctorCommand.join(" ") }
        : {}),
      officialUrl: recipe.officialUrl,
      prerequisites: recipe.prerequisites,
      recommended: recipe.recommended
    }));
}

export function buildProviderCommand(
  providerId: AiProviderId,
  resolvedExecutable?: Pick<ResolvedAiProviderExecutable, "file">
): AiProviderCommand {
  const provider = getAiProviderDefinition(providerId);
  if (!provider) {
    throw new Error(`Unsupported AI provider: ${providerId}`);
  }

  const [file, ...args] = provider.runCommand;
  const executableFile = resolvedExecutable?.file ?? file;
  if (!executableFile) {
    throw new Error(`AI provider command is empty: ${providerId}`);
  }
  return buildExecutableInvocation(executableFile, args);
}
