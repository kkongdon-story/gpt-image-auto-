import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExecutableInvocation,
  buildProviderProbeEnv,
  buildProviderRunEnv,
  cleanupStaleCodexHomes,
  sanitizeProviderVersion,
  shouldProbeExecutableCandidate
} from "./cliRuntime";

describe("AI CLI runtime security boundaries", () => {
  it("keeps provider discovery free of credentials and auth-home overrides", () => {
    const env = buildProviderProbeEnv({
      PATH: "safe-path",
      CARDNEWS_CODEX_PATH: "codex",
      OPENAI_API_KEY: "openai-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      ANTHROPIC_AUTH_TOKEN: "anthropic-token",
      GEMINI_API_KEY: "gemini-secret",
      GOOGLE_API_KEY: "google-secret",
      CODEX_HOME: "private-home"
    });

    expect(env.PATH).toBe("safe-path");
    expect(env.CARDNEWS_CODEX_PATH).toBe("codex");
    expect(env.NO_COLOR).toBe("1");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_API_KEY).toBeUndefined();
    expect(env.CODEX_HOME).toBeUndefined();
  });

  it("passes only the selected provider credentials to a chat process", () => {
    const source = {
      PATH: "safe-path",
      OPENAI_API_KEY: "openai-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      ANTHROPIC_AUTH_TOKEN: "anthropic-token",
      GEMINI_API_KEY: "gemini-secret",
      GOOGLE_API_KEY: "google-secret"
    };

    const codexEnv = buildProviderRunEnv("codex", source);
    expect(codexEnv.OPENAI_API_KEY).toBe("openai-secret");
    expect(codexEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(codexEnv.GEMINI_API_KEY).toBeUndefined();

    const claudeEnv = buildProviderRunEnv("claude", source);
    expect(claudeEnv.ANTHROPIC_API_KEY).toBe("anthropic-secret");
    expect(claudeEnv.ANTHROPIC_AUTH_TOKEN).toBe("anthropic-token");
    expect(claudeEnv.OPENAI_API_KEY).toBeUndefined();

    const geminiEnv = buildProviderRunEnv("gemini", source);
    expect(geminiEnv.GEMINI_API_KEY).toBe("gemini-secret");
    expect(geminiEnv.GOOGLE_API_KEY).toBe("google-secret");
    expect(geminiEnv.OPENAI_API_KEY).toBeUndefined();
  });

  it("accepts ordinary version text and drops control-like output", () => {
    expect(sanitizeProviderVersion("codex-cli 1.2.3")).toBe("codex-cli 1.2.3");
    expect(sanitizeProviderVersion("\u001b[31mcodex-cli 1.2.3\u001b[0m")).toBe("codex-cli 1.2.3");
    expect(sanitizeProviderVersion("<script>alert(1)</script>")).toBeUndefined();
    expect(sanitizeProviderVersion("version\nsecond line")).toBeUndefined();
  });

  it("only probes non-PATH candidates that exist", () => {
    const missingPath = path.join(os.tmpdir(), "cardnews-missing-cli", "codex.cmd");
    expect(shouldProbeExecutableCandidate({ file: "codex", source: "path" })).toBe(true);
    expect(shouldProbeExecutableCandidate({ file: missingPath, source: "env" })).toBe(false);
  });

  it.runIf(process.platform === "win32")("rejects command-script metacharacter injection", () => {
    expect(() =>
      buildExecutableInvocation(path.join(os.tmpdir(), "safe&echo-injected.cmd"), ["--version"])
    ).toThrow("Unsafe Windows command script path or argument");
    expect(() => buildExecutableInvocation(path.join(os.tmpdir(), "safe-cli.cmd"), ["ok&echo-injected"])).toThrow(
      "Unsafe Windows command script path or argument"
    );
  });

  it("removes only stale prefixed temporary Codex homes", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cardnews-stale-cleanup-"));
    const staleDirectory = path.join(tempRoot, "cardnews-codex-stale");
    const freshDirectory = path.join(tempRoot, "cardnews-codex-fresh");
    const unrelatedDirectory = path.join(tempRoot, "unrelated-auth");
    fs.mkdirSync(staleDirectory);
    fs.mkdirSync(freshDirectory);
    fs.mkdirSync(unrelatedDirectory);
    const now = Date.now();
    const staleTime = new Date(now - 25 * 60 * 60 * 1_000);
    fs.utimesSync(staleDirectory, staleTime, staleTime);

    cleanupStaleCodexHomes({ now, tempRoot });

    expect(fs.existsSync(staleDirectory)).toBe(false);
    expect(fs.existsSync(freshDirectory)).toBe(true);
    expect(fs.existsSync(unrelatedDirectory)).toBe(true);
  });
});
