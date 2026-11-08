import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildProviderCommand,
  clearAiProviderStatusCache,
  defaultProviderTimeoutMs,
  listAiProviderStatuses,
  mapAiProviderError,
  resolveAiProviderCwd,
  resolveAiProviderTimeoutMs
} from "./cliAdapters";
import { withEnv, writeFakeCli } from "./cliTestHelpers";

describe("AI CLI adapter command construction", () => {
  it("runs Codex through stdin with isolated user config and no persistent session", () => {
    const command = buildProviderCommand("codex");

    expect(command.file).toBe("codex");
    expect(command.args).toEqual([
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
    ]);
    expect(command.shell).toBe(false);
  });

  it("prefers an explicit workspace cwd over AppData storage roots", () => {
    const tempRoot = path.join(os.tmpdir(), "cardnews-cwd-precedence");
    const workspace = path.join(tempRoot, "workspace");
    const processCwd = path.join(tempRoot, "packaged-process");
    const storageRoot = path.join(tempRoot, "storage");
    expect(
      resolveAiProviderCwd({
        explicitWorkspaceCwd: workspace,
        processCwd,
        storageRoot
      })
    ).toBe(path.resolve(workspace));
  });

  it("uses the writable storage root before a packaged process cwd", () => {
    const tempRoot = path.join(os.tmpdir(), "cardnews-cwd-storage");
    const processCwd = path.join(tempRoot, "packaged-process");
    const storageRoot = path.join(tempRoot, "storage");
    expect(
      resolveAiProviderCwd({
        processCwd,
        storageRoot
      })
    ).toBe(path.resolve(storageRoot));
  });

  it("maps Codex trusted-directory failures without exposing CLI implementation details", () => {
    const mapped = mapAiProviderError(
      "Codex CLI",
      "Not inside a trusted directory and --skip-git-repo-check was not specified."
    );

    expect(mapped).toContain("작업 폴더");
    expect(mapped).toContain("새로고침");
    expect(mapped).not.toContain("--skip-git-repo-check");
  });

  it("maps unsupported model logs without leaking paths, prompts, or raw stderr", () => {
    const mapped = mapAiProviderError(
      "Codex CLI",
      [
        "workdir: C:\\Users\\private\\release",
        "USER SYSTEM: secret prompt",
        "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI."
      ].join("\n")
    );

    expect(mapped).toContain("현재 설치된 CLI와 호환되지 않습니다");
    expect(mapped).not.toContain("C:\\Users");
    expect(mapped).not.toContain("secret prompt");
    expect(mapped).not.toContain("gpt-5.6-sol");
  });

  it("maps authentication failures to one actionable login message", () => {
    const mapped = mapAiProviderError("Codex CLI", "AuthRequiredError: No access token was provided in the request");

    expect(mapped).toContain("로그인이 필요합니다");
    expect(mapped).not.toContain("AuthRequiredError");
  });

  it("detects Codex from the Windows npm AppData fallback when PATH misses it", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cardnews-ai-provider-"));
    const appData = path.join(tempRoot, "AppData", "Roaming");
    const emptyPath = path.join(tempRoot, "empty-bin");
    writeFakeCli(path.join(appData, "npm"), "codex", { version: "codex-cli 9.9.9" });

    clearAiProviderStatusCache();
    const statuses = withEnv(
      {
        APPDATA: appData,
        PATH: emptyPath,
        Path: emptyPath,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        CARDNEWS_MOCK_AI: undefined
      },
      () => listAiProviderStatuses()
    );

    const codexStatus = statuses.find((status) => status.id === "codex");
    expect(codexStatus?.installed).toBe(true);
    expect(codexStatus?.version).toContain("codex-cli 9.9.9");
    expect(statuses.filter((status) => status.id === "codex")).toHaveLength(1);
  });

  it("keeps Codex prompt content out of command arguments when using a resolved executable", () => {
    const command = buildProviderCommand("codex", {
      file: path.join(os.tmpdir(), "cardnews-cli-path", "codex.cmd")
    });

    expect(command.args.join(" ")).toContain("--skip-git-repo-check");
    expect(command.args.join(" ")).not.toContain("오늘 수업 후기글");
    expect(command.shell).toBe(false);
  });

  it("resolves default and overridden provider timeouts within the documented range", () => {
    expect(resolveAiProviderTimeoutMs({})).toBe(defaultProviderTimeoutMs);
    expect(resolveAiProviderTimeoutMs({ CARDNEWS_AI_TIMEOUT_MS: "450000" })).toBe(450_000);
    expect(resolveAiProviderTimeoutMs({ CARDNEWS_AI_TIMEOUT_MS: "1000" })).toBe(defaultProviderTimeoutMs);
    expect(resolveAiProviderTimeoutMs({ CARDNEWS_AI_TIMEOUT_MS: "99999999" })).toBe(defaultProviderTimeoutMs);
    expect(resolveAiProviderTimeoutMs({ CARDNEWS_AI_TIMEOUT_MS: "abc" })).toBe(defaultProviderTimeoutMs);
  });

});
