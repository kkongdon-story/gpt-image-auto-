import { spawn, spawnSync } from "node:child_process";
import type {
  AiProviderId,
  AiProviderInstallResult,
  AiProviderStatus
} from "../../src/domain/types.js";
import {
  getAiProviderInstallRecipe,
  type AiProviderInstallRecipe
} from "./cliProviderDefinitions.js";
import {
  clearAiProviderStatusCache,
  listAiProviderStatuses
} from "./cliProviderDiscovery.js";

export type InstallerCommandResult = {
  readonly exitCode: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly errorMessage?: string;
};

export type VisibleTerminalInvocation = {
  readonly file: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly windowsHide: false;
};

export type AiProviderInstallerDependencies = {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly confirm: (recipe: AiProviderInstallRecipe) => Promise<boolean>;
  readonly runPreflight?: (
    command: readonly string[],
    env: NodeJS.ProcessEnv
  ) => InstallerCommandResult;
  readonly runVisibleTerminal?: (
    invocation: VisibleTerminalInvocation,
    env: NodeJS.ProcessEnv
  ) => Promise<InstallerCommandResult>;
  readonly runVerify?: (
    command: readonly string[],
    env: NodeJS.ProcessEnv
  ) => InstallerCommandResult;
  readonly refreshStatuses?: () => readonly AiProviderStatus[];
};

export async function installAiProviderRecipe(
  providerId: AiProviderId,
  recipeId: string,
  dependencies: AiProviderInstallerDependencies
): Promise<AiProviderInstallResult> {
  const recipe = getAiProviderInstallRecipe(providerId, recipeId);
  if (!recipe) {
    return failedResult("허용되지 않은 AI CLI 설치 방식입니다.");
  }
  if ((dependencies.platform ?? process.platform) !== "win32") {
    return failedResult("AI CLI 안전 설치는 현재 Windows에서만 지원합니다.");
  }

  if (!(await dependencies.confirm(recipe))) {
    return {
      ok: false,
      outcome: "cancelled",
      message: "AI CLI 설치가 취소되었습니다."
    };
  }

  const env = dependencies.env ?? process.env;
  const preflightCommand = getInstallPreflightCommand(recipe);
  const preflight = (dependencies.runPreflight ?? runCommandHidden)(preflightCommand, env);
  if (preflight.exitCode !== 0) {
    return failedResult(
      `설치 사전 조건을 확인하지 못했습니다. ${recipe.prerequisites.join(" ")}`,
      preflight.exitCode
    );
  }

  const invocation = buildVisibleTerminalInvocation(recipe.command, env);
  const execution = await (dependencies.runVisibleTerminal ?? runVisibleTerminal)(invocation, env);
  if (execution.exitCode !== 0) {
    return failedResult(
      execution.errorMessage
        ? `AI CLI 설치 명령을 실행하지 못했습니다: ${execution.errorMessage}`
        : "AI CLI 설치가 완료되지 않았습니다. 열린 터미널의 오류를 확인해 주세요.",
      execution.exitCode
    );
  }

  const verification = (dependencies.runVerify ?? runCommandHidden)(recipe.verifyCommand, env);
  const statuses = (
    dependencies.refreshStatuses ??
    (() => {
      clearAiProviderStatusCache();
      return listAiProviderStatuses({ forceRefresh: true });
    })
  )();
  const providerStatus = statuses.find((status) => status.id === providerId);
  if (verification.exitCode !== 0 && !providerStatus?.installed) {
    return failedResult(
      `설치 명령은 종료되었지만 ${recipe.verifyCommand.join(" ")} 검증에 실패했습니다. 터미널을 다시 연 뒤 확인해 주세요.`,
      verification.exitCode
    );
  }
  if (!providerStatus) {
    return failedResult("설치 후 AI CLI 상태를 다시 확인하지 못했습니다.");
  }

  return {
    ok: true,
    outcome: "installed",
    message: `${providerStatus.label} 설치와 실행 파일 확인을 완료했습니다.`,
    providerStatus: {
      ...providerStatus,
      installed: true
    }
  };
}

export function buildVisibleTerminalInvocation(
  command: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): VisibleTerminalInvocation {
  if (command.length === 0) {
    throw new Error("Installer command is empty.");
  }
  const commandLine = command.map(quoteCmdArgument).join(" ");
  return {
    file: env["ComSpec"] || env["COMSPEC"] || "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      `start "Cardnews Studio AI CLI 설치" /wait ${commandLine}`
    ],
    shell: false,
    windowsHide: false
  };
}

export function getInstallPreflightCommand(
  recipe: AiProviderInstallRecipe
): readonly string[] {
  switch (recipe.method) {
    case "npm":
      return ["npm.cmd", "--version"];
    case "powershell-native":
      return [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.ToString()"
      ];
    case "winget":
      return ["winget", "--version"];
  }
}

function runCommandHidden(
  command: readonly string[],
  env: NodeJS.ProcessEnv
): InstallerCommandResult {
  const [file, ...args] = command;
  if (!file) {
    return { exitCode: null, errorMessage: "command is empty" };
  }
  const result = spawnSync(file, args, {
    env,
    encoding: "utf8",
    shell: false,
    timeout: 15_000,
    windowsHide: true
  });
  return {
    exitCode: result.status,
    signal: result.signal,
    ...(result.error ? { errorMessage: result.error.message } : {})
  };
}

function runVisibleTerminal(
  invocation: VisibleTerminalInvocation,
  env: NodeJS.ProcessEnv
): Promise<InstallerCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.file, [...invocation.args], {
      env,
      shell: invocation.shell,
      stdio: "ignore",
      windowsHide: invocation.windowsHide
    });
    child.once("error", (error) => {
      resolve({ exitCode: null, errorMessage: error.message });
    });
    child.once("exit", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

function quoteCmdArgument(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function failedResult(message: string, exitCode?: number | null): AiProviderInstallResult {
  return {
    ok: false,
    outcome: "failed",
    message,
    ...(typeof exitCode === "number" ? { exitCode } : {})
  };
}
