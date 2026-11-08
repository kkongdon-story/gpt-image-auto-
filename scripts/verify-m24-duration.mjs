import {
  artifactRecords,
  commandLog,
  readText,
  requirePassingGate,
  runVitest,
  sourceContains,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const gate = "G2-schema-duration-migration";
const command = "node scripts/verify-m24-duration.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G1-red-reproduction");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g1", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const tests = [
    "src/domain/media.test.ts",
    "src/domain/videoTimeline.test.ts",
    "src/domain/editionFilter.test.ts",
    "src/storage/projectArchive.test.ts"
  ];
  const test = await runVitest(tests);
  const [media, timeline, app, types, archiveTests] = await Promise.all([
    readText("src/domain/media.ts"),
    readText("src/domain/videoTimeline.ts"),
    readText("src/ui/App.tsx"),
    readText("src/domain/types.ts"),
    readText("src/storage/projectArchive.test.ts")
  ]);
  logs.push(commandLog(test));
  assertions.push(
    { id: "duration-migration-tests", passed: test.exitCode === 0, detail: `${tests.length} suites exit=${test.exitCode}` },
    sourceContains("duration-bounds", media, ["500", "180000"], "Scene duration is normalized to 0.5s..180s."),
    sourceContains("legacy-duration", media, ["durationMs: 3000"], "Legacy/default card duration remains 3000ms."),
    sourceContains("video-mode-normalizer", media, ["normalizeVideoProjectMode"], "Legacy video-project mode migration is centralized."),
    sourceContains("canonical-timeline", timeline, ["compileVideoTimeline", "durationMs", "frame"], "Timeline compiles duration and frame authority."),
    sourceContains("persisted-video-mode", types, ["VideoProjectMode", "videoProjectMode"], "Persisted project schema includes video-project mode."),
    sourceContains("conditional-timeline", app, ['videoProjectMode === "video"', "compiledTimeline"], "Timeline UI is guarded by persisted video mode."),
    sourceContains("archive-duration-coverage", archiveTests, ["durationMs: 3000", "durationMs: 5000"], "Archive tests cover default and explicit durations.")
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
      "src/domain/media.ts",
      "src/domain/videoTimeline.ts",
      "src/domain/types.ts",
      "src/ui/App.tsx",
      "src/domain/media.test.ts",
      "src/domain/videoTimeline.test.ts",
      "src/domain/editionFilter.test.ts",
      "src/storage/projectArchive.test.ts"
    ]))
  ],
  assertions,
  limitations: ["Packaged archive round-trip and frame-accurate MP4 duration remain later package/runtime gates."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
