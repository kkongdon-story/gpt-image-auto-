import {
  artifactRecords,
  commandLog,
  readText,
  requirePassingGate,
  runVitest,
  sourceContains,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const gate = "G7-menu-accessibility-performance";
const command = "node scripts/verify-m24-ux.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G6-cli-safety-lite-stripping");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g6", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const tests = [
    "src/ui/m24UiContract.test.ts",
    "src/ui/m22MediaUi.test.ts",
    "src/ui/m21UiContract.test.ts",
    "src/ui/m13UiContract.test.ts",
    "src/ui/editorToolbar.test.ts",
    "src/domain/pageOperations.test.ts"
  ];
  const test = await runVitest(tests);
  const [app, styles] = await Promise.all([
    readText("src/ui/App.tsx"),
    readText("src/ui/styles.css")
  ]);
  const exportEntryCount = app.split('data-smoke-action="open-export-dialog"').length - 1;
  logs.push(commandLog(test));
  assertions.push(
    { id: "ux-regression-tests", passed: test.exitCode === 0, detail: `${tests.length} suites exit=${test.exitCode}` },
    sourceContains("primary-tabs", app, ['"content"', '"design"', '"media"', '"export"'], "Inspector retains the four primary information-architecture groups."),
    sourceContains("accessible-dialogs", app, ['role="dialog"', 'aria-modal="true"', "aria-labelledby"], "Export and assignment dialogs expose accessible modal semantics."),
    sourceContains(
      "export-focus-loop",
      app,
      ['event.key === "Escape"', 'event.key !== "Tab"', "previouslyFocused?.focus()"],
      "Export dialog supports Escape, keyboard focus looping, and focus restoration."
    ),
    sourceContains(
      "pro-installer-disclosure",
      app,
      ['data-smoke-role="ai-install-panel"', "recipe.officialUrl", "installSelectedAiProvider(recipe.id)"],
      "Missing Pro providers expose fixed recipes and official documentation."
    ),
    sourceContains("video-mode-control", app, ["영상 만들기", 'videoProjectMode === "video"'], "Timeline visibility is tied to an explicit video-project control."),
    sourceContains("memoized-timeline", app, ["useMemo(() => compileVideoTimeline(previewDeck), [previewDeck])"], "Timeline compilation is memoized instead of recomputed during unrelated renders."),
    sourceContains("responsive-panels", styles, ["@media", "overflow"], "Editor styles define responsive/overflow behavior."),
    {
      id: "single-primary-export-entry",
      passed: exportEntryCount === 1,
      detail: `Expected one top-level Export entry; found ${exportEntryCount}.`
    },
    sourceContains("format-specific-png-option", app, ["현재 카드 PNG", "전체 ZIP", "MP4 영상"], "PNG and MP4 remain format options inside the unified flow.")
  );
}

const exitCode = assertions.every((item) => item.passed) ? 0 : 1;
const meta = await writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode,
  status: predecessor.passed ? undefined : "blocked",
  artifacts: [
    ...(predecessor.artifact ? [predecessor.artifact] : []),
    ...(await artifactRecords([
      "src/ui/App.tsx",
      "src/ui/styles.css",
      "src/ui/m24UiContract.test.ts",
      "src/ui/m22MediaUi.test.ts",
      "src/ui/m21UiContract.test.ts",
      "src/ui/m13UiContract.test.ts",
      "src/ui/editorToolbar.test.ts",
      "src/domain/pageOperations.test.ts"
    ]))
  ],
  assertions,
  limitations: ["Screen-reader focus trapping, narrow-viewport clipping, and quantitative latency require the interactive runtime profile."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
