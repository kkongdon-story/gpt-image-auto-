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

const gate = "G5-export-liveness";
const command = "node scripts/verify-m24-export-watchdog.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G4-media-live-preview");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g4", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const tests = [
    "src/domain/videoExport.test.ts",
    "electron/videoExporter.test.ts",
    "electron/videoFrameProducer.test.ts",
    "electron/ffmpegPreflight.test.ts"
  ];
  const test = await runVitest(tests);
  const [domain, exporter, exporterTests, app] = await Promise.all([
    readText("src/domain/videoExport.ts"),
    readText("electron/videoExporter.ts"),
    readText("electron/videoExporter.test.ts"),
    readText("src/ui/App.tsx")
  ]);
  logs.push(commandLog(test));
  assertions.push(
    { id: "export-watchdog-tests", passed: test.exitCode === 0, detail: `${tests.length} suites exit=${test.exitCode}` },
    sourceContains("canonical-stages", domain, ['"compile"', '"preflight"', '"producer_init"', '"render"', '"encode"', '"finalize"'], "Canonical export stage union contains all six phases."),
    sourceExcludes("no-canonical-phase-field", domain, ["readonly phase:"], "Domain progress does not expose a competing phase field."),
    sourceContains("watchdog-thresholds", domain, ["30_000", "45_000", "60_000"], "Watchdog defaults cover preflight, producer, render, encode, and finalize."),
    sourceContains("stage-timeouts", exporter, ["withStageTimeout", "renderNoProgressMs", "producerInitMs", "finalizeMs"], "Exporter wraps blocking phases in bounded timeouts."),
    sourceContains("partial-cleanup", exporter, ["cleanupPartial", 'child?.kill("SIGTERM")'], "Timeout/cancel paths terminate the encoder and clean partial output."),
    sourceContains("fault-injection-tests", exporterTests, ["stalled preflight", "frame production stalls", "cancels the encoder process"], "Unit tests inject stalls and cancellation."),
    sourceContains("unified-export-entry", app, ['data-smoke-action="open-export-dialog"', "export-dialog-title"], "One primary Export action opens the format dialog."),
    sourceExcludes("no-top-png-primary", app.slice(0, app.indexOf("function InspectorPanel")), ['>PNG 생성<'], "Top-level PNG-only primary action is absent.")
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
      "src/domain/videoExport.ts",
      "electron/videoExporter.ts",
      "src/ui/App.tsx",
      "src/domain/videoExport.test.ts",
      "electron/videoExporter.test.ts",
      "electron/videoFrameProducer.test.ts",
      "electron/ffmpegPreflight.test.ts"
    ]))
  ],
  assertions,
  limitations: ["OS-level orphan-process inventory and real FFmpeg termination timing remain packaged fault-injection gates."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
