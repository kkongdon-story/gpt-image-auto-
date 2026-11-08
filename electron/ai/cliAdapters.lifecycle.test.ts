import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearAiProviderStatusCache, runAiProviderChat } from "./cliAdapters";
import { waitForProcessExit, withEnvAsync, writeFakeCli } from "./cliTestHelpers";

describe("AI CLI adapter process lifecycle", () => {
  it("runs Codex with only transient auth state and removes that state after exit", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cardnews-ai-isolated-home-"));
    const fakeBin = path.join(tempRoot, "bin");
    const sourceCodexHome = path.join(tempRoot, "source-codex-home");
    fs.mkdirSync(sourceCodexHome, { recursive: true });
    fs.writeFileSync(path.join(sourceCodexHome, "auth.json"), '{"test":"auth"}');
    const fakeCli = writeFakeCli(fakeBin, "codex", { version: "codex-cli 9.9.9" });
    const runnerPath = path.join(fakeBin, "codex-runner.js");
    fs.writeFileSync(
      runnerPath,
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const codexHome = process.env["CODEX_HOME"] ?? "";',
        'console.log(JSON.stringify({ authExists: fs.existsSync(path.join(codexHome, "auth.json")), codexHome }));'
      ].join("\n")
    );
    expect(fakeCli).toBeTruthy();

    clearAiProviderStatusCache();
    const result = await withEnvAsync(
      {
        CODEX_HOME: sourceCodexHome,
        PATH: fakeBin,
        Path: fakeBin,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        CARDNEWS_MOCK_AI: undefined,
        CARDNEWS_MOCK_AI_ERROR: undefined
      },
      () => runAiProviderChat("codex", [{ role: "user", content: "격리 실행 테스트" }], { cwd: tempRoot })
    );

    expect("content" in result).toBe(true);
    if ("content" in result) {
      const evidence = JSON.parse(result.content) as { readonly authExists: boolean; readonly codexHome: string };
      expect(evidence.authExists).toBe(true);
      expect(path.resolve(evidence.codexHome)).not.toBe(path.resolve(sourceCodexHome));
      expect(fs.existsSync(evidence.codexHome)).toBe(false);
    }
  });

  it("includes the configured timeout duration and cleans up the provider process", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cardnews-ai-timeout-"));
    const fakeBin = path.join(tempRoot, "bin");
    const metadataPath = path.join(tempRoot, "process.json");
    writeFakeCli(fakeBin, "codex", {
      version: "codex-cli 9.9.9",
      delaySeconds: 5,
      metadataPath
    });

    clearAiProviderStatusCache();
    const result = await withEnvAsync(
      {
        PATH: fakeBin,
        Path: fakeBin,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        CARDNEWS_MOCK_AI: undefined
      },
      () =>
        runAiProviderChat("codex", [{ role: "user", content: "느린 응답 테스트" }], {
          cwd: tempRoot,
          timeoutMs: 500
        })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toContain("500ms");
      expect(result.message).toContain("응답 시간이");
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      readonly pid: number;
      readonly codexHome: string;
    };
    await expect(waitForProcessExit(metadata.pid, 5_000)).resolves.toBe(true);
    expect(metadata.codexHome).not.toBe("");
    expect(fs.existsSync(metadata.codexHome)).toBe(false);
  }, 10_000);
});
