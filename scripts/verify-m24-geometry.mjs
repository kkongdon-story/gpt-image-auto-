import {
  artifactRecords,
  commandLog,
  readText,
  requirePassingGate,
  runVitest,
  sourceContains,
  sourceExcludes,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const gate = "G3-geometry-interactions";
const command = "node scripts/verify-m24-geometry.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G2-schema-duration-migration");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g2", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const tests = [
    "src/domain/m23Semantic.test.ts",
    "src/domain/media.test.ts",
    "src/ui/m22MediaUi.test.ts",
    "src/render-engine/cardTemplate.test.ts"
  ];
  const test = await runVitest(tests);
  const [app, renderer, rendererTests] = await Promise.all([
    readText("src/ui/App.tsx"),
    readText("src/render-engine/cardTemplate.ts"),
    readText("src/render-engine/cardTemplate.test.ts")
  ]);
  logs.push(commandLog(test));
  assertions.push(
    { id: "geometry-tests", passed: test.exitCode === 0, detail: `${tests.length} suites exit=${test.exitCode}` },
    sourceContains("drag-threshold", app, ["dragActivationThresholdPx = 4", "hasExceededDragActivationThreshold"], "Click/drag uses the 4 CSS px activation threshold."),
    sourceContains("eight-resize-handles", app, ['["nw", "n", "ne", "e", "se", "s", "sw", "w"]'], "Semantic and layer boxes expose eight resize handles."),
    sourceContains("semantic-owner-id", renderer, ["data-semantic-item-id", "createSemanticItemId"], "Renderer emits stable semantic ownership IDs."),
    sourceContains("card-relative-placement", renderer, ["position: absolute !important"], "Saved semantic placement is card-relative."),
    sourceExcludes("no-viewport-fixed-placement", renderer, ["position: fixed !important"], "Viewport-fixed semantic placement is prohibited."),
    sourceContains("renderer-regression-assertion", rendererTests, ['not.toContain("position: fixed !important")'], "Renderer regression test rejects fixed placement."),
    sourceContains("gesture-history", app, ["undo", "redo", "pointerId"], "Editor retains gesture lifecycle and history controls.")
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
      "src/render-engine/cardTemplate.ts",
      "src/render-engine/cardTemplate.test.ts",
      "src/domain/m23Semantic.test.ts",
      "src/ui/m22MediaUi.test.ts"
    ]))
  ],
  assertions,
  limitations: ["Zoom/DPI rectangle and board-versus-PNG/MP4 pixel parity require the later runtime visual harness."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
