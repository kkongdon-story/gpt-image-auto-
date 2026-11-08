import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AiProviderStatus } from "../../src/domain/types.js";
import {
  getAiProviderInstallRecipe,
  listAiProviderInstallRecipeSummaries,
  providerInstallRecipes
} from "./cliProviderDefinitions.js";
import {
  buildVisibleTerminalInvocation,
  installAiProviderRecipe
} from "./cliProviderInstaller.js";

const installedCodexStatus: AiProviderStatus = {
  id: "codex",
  label: "Codex CLI",
  installed: true,
  installHint: "npm install -g @openai/codex",
  version: "codex-cli 1.0.0"
};

describe("AI CLI fixed install recipes", () => {
  it("exposes only fixed Windows recipes for Codex and Claude", () => {
    expect(providerInstallRecipes.map((recipe) => recipe.id)).toEqual([
      "codex-npm",
      "claude-powershell-native",
      "claude-winget"
    ]);
    expect(listAiProviderInstallRecipeSummaries("gemini")).toEqual([]);
    expect(getAiProviderInstallRecipe("gemini", "codex-npm")).toBeUndefined();
    expect(providerInstallRecipes.every((recipe) => recipe.officialUrl.startsWith("https://"))).toBe(true);
  });

  it("rejects a provider and recipe mismatch before confirmation or execution", async () => {
    const confirm = vi.fn(async () => true);
    const runVisibleTerminal = vi.fn(async () => ({ exitCode: 0 }));

    const result = await installAiProviderRecipe("claude", "codex-npm", {
      platform: "win32",
      confirm,
      runVisibleTerminal
    });

    expect(result).toMatchObject({ ok: false, outcome: "failed" });
    expect(confirm).not.toHaveBeenCalled();
    expect(runVisibleTerminal).not.toHaveBeenCalled();
  });

  it("returns cancellation without running preflight or opening a terminal", async () => {
    const runPreflight = vi.fn(() => ({ exitCode: 0 }));
    const runVisibleTerminal = vi.fn(async () => ({ exitCode: 0 }));

    const result = await installAiProviderRecipe("codex", "codex-npm", {
      platform: "win32",
      confirm: async () => false,
      runPreflight,
      runVisibleTerminal
    });

    expect(result).toEqual({
      ok: false,
      outcome: "cancelled",
      message: "AI CLI 설치가 취소되었습니다."
    });
    expect(runPreflight).not.toHaveBeenCalled();
    expect(runVisibleTerminal).not.toHaveBeenCalled();
  });

  it("runs the allowlisted Codex recipe visibly and refreshes discovery", async () => {
    const runPreflight = vi.fn(() => ({ exitCode: 0 }));
    const runVisibleTerminal = vi.fn(async () => ({ exitCode: 0 }));
    const runVerify = vi.fn(() => ({ exitCode: 0 }));
    const refreshStatuses = vi.fn(() => [installedCodexStatus]);

    const result = await installAiProviderRecipe("codex", "codex-npm", {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      confirm: async () => true,
      runPreflight,
      runVisibleTerminal,
      runVerify,
      refreshStatuses
    });

    expect(runPreflight).toHaveBeenCalledWith(
      ["npm.cmd", "--version"],
      expect.any(Object)
    );
    expect(runVisibleTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "C:\\Windows\\System32\\cmd.exe",
        shell: false,
        windowsHide: false
      }),
      expect.any(Object)
    );
    const invocation = runVisibleTerminal.mock.calls[0]?.[0];
    expect(invocation?.args.join(" ")).toContain("@openai/codex");
    expect(invocation?.args.join(" ").toLowerCase()).not.toContain("runas");
    expect(runVerify).toHaveBeenCalledWith(["codex", "--version"], expect.any(Object));
    expect(refreshStatuses).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, outcome: "installed" });
  });

  it("returns the non-zero terminal exit code and does not report success", async () => {
    const result = await installAiProviderRecipe("claude", "claude-winget", {
      platform: "win32",
      confirm: async () => true,
      runPreflight: () => ({ exitCode: 0 }),
      runVisibleTerminal: async () => ({ exitCode: 23 }),
      runVerify: () => ({ exitCode: 0 }),
      refreshStatuses: () => []
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      exitCode: 23
    });
  });

  it("builds a visible, non-elevated, shell-free terminal invocation", () => {
    const invocation = buildVisibleTerminalInvocation(
      ["npm.cmd", "install", "-g", "@openai/codex"],
      { ComSpec: "cmd.exe" }
    );

    expect(invocation).toEqual(
      expect.objectContaining({
        file: "cmd.exe",
        shell: false,
        windowsHide: false
      })
    );
    expect(invocation.args.join(" ")).toContain("start");
    expect(invocation.args.join(" ").toLowerCase()).not.toContain("runas");
  });

  it("keeps the install IPC out of both Lite entry points", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..");
    const litePreload = fs.readFileSync(path.join(repoRoot, "electron", "preload-lite.cts"), "utf8");
    const liteMain = fs.readFileSync(path.join(repoRoot, "electron", "lite-main.ts"), "utf8");

    expect(litePreload).not.toContain("cardnews:ai:install");
    expect(liteMain).not.toContain("cardnews:ai:install");
  });
});
