import {
  artifactRecords,
  commandLog,
  existingPaths,
  readText,
  requirePassingGate,
  runVitest,
  sourceContains,
  sourceExcludes,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const gate = "G6-cli-safety-lite-stripping";
const command = "node scripts/verify-m24-cli-safety.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G5-export-liveness");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g5", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const tests = await existingPaths([
    "electron/ai/cliAdapters.test.ts",
    "electron/ai/cliAdapters.lifecycle.test.ts",
    "electron/ai/cliRuntime.test.ts",
    "electron/ai/cliProviderInstaller.test.ts",
    "src/storage/verifyEditionCli.test.ts"
  ]);
  const test = await runVitest(tests);
  const [registry, installer, main, preload, liteMain, litePreload] = await Promise.all([
    readText("electron/ai/cliProviderDefinitions.ts"),
    readText("electron/ai/cliProviderInstaller.ts"),
    readText("electron/main.ts"),
    readText("electron/preload.cts"),
    readText("electron/lite-main.ts"),
    readText("electron/preload-lite.cts")
  ]);
  logs.push(commandLog(test));
  assertions.push(
    { id: "cli-safety-tests", passed: test.exitCode === 0, detail: `${tests.length} suites exit=${test.exitCode}` },
    sourceContains("fixed-install-registry", registry, ["AiProviderInstallRecipe", "providerInstallRecipes", "officialUrl"], "Pro install commands come from a typed fixed registry."),
    sourceContains("official-provider-recipes", registry, ["@openai/codex", "claude.ai/install.ps1", "Anthropic.ClaudeCode"], "Codex and Claude official Windows recipes are present."),
    sourceExcludes("no-gemini-install-recipe", registry.slice(0, registry.indexOf("providerDefinitions")), ['provider: "gemini"'], "Gemini discovery remains without a new install recipe."),
    sourceContains("main-install-dispatch", main, ["installAiProviderRecipe", "recipeId"], "Main process accepts only provider and recipe identifiers."),
    sourceContains("installer-allowlist", installer, ["getAiProviderInstallRecipe", "recipeId"], "Installer resolves the recipe ID through the fixed registry."),
    sourceContains("pro-install-bridge", preload, ["installAiProvider"], "Pro preload exposes only the typed install operation."),
    sourceExcludes("lite-no-install-bridge", `${liteMain}\n${litePreload}`, ["installAiProvider", "providerInstallRecipes", "cardnews:ai:install"], "Lite source contains no installer IPC or recipe bridge."),
    sourceExcludes("lite-no-ai-process-bridge", litePreload, ["runAiChat", "listAiProviders"], "Lite preload contains no executable AI provider bridge.")
  );
}

const exitCode = assertions.every((item) => item.passed) ? 0 : 1;
const meta = await writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode,
  edition: "lite+pro",
  status: predecessor.passed ? undefined : "blocked",
  artifacts: [
    ...(predecessor.artifact ? [predecessor.artifact] : []),
    ...(await artifactRecords([
      "electron/ai/cliProviderDefinitions.ts",
      "electron/ai/cliProviderInstaller.ts",
      "electron/main.ts",
      "electron/preload.cts",
      "electron/lite-main.ts",
      "electron/preload-lite.cts",
      "electron/ai/cliAdapters.test.ts",
      "electron/ai/cliAdapters.lifecycle.test.ts",
      "electron/ai/cliRuntime.test.ts",
      "electron/ai/cliProviderInstaller.test.ts",
      "src/storage/verifyEditionCli.test.ts"
    ]))
  ],
  assertions,
  limitations: ["Official recipe freshness must be rechecked at release time; bundle/app.asar stripping is enforced again after Lite build."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
