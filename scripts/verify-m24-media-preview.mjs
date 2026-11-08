import {
  artifactRecords,
  commandLog,
  readText,
  requirePassingGate,
  runVitest,
  sourceContains,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const gate = "G4-media-live-preview";
const command = "node scripts/verify-m24-media-preview.mjs";
const startedAt = new Date().toISOString();
const predecessor = await requirePassingGate("G3-geometry-interactions");
const logs = [predecessor.detail];
const assertions = [{ id: "predecessor-g3", passed: predecessor.passed, detail: predecessor.detail }];

if (predecessor.passed) {
  const tests = [
    "src/storage/mediaLibrary.test.ts",
    "electron/mediaProtocol.test.ts",
    "electron/videoMediaProbe.test.ts",
    "src/render-engine/cardTemplate.test.ts",
    "src/ui/m22MediaUi.test.ts"
  ];
  const test = await runVitest(tests);
  const [library, protocol, renderer, app, main, liteMain] = await Promise.all([
    readText("src/storage/mediaLibrary.ts"),
    readText("electron/mediaProtocol.ts"),
    readText("src/render-engine/cardTemplate.ts"),
    readText("src/ui/App.tsx"),
    readText("electron/main.ts"),
    readText("electron/lite-main.ts")
  ]);
  logs.push(commandLog(test));
  assertions.push(
    { id: "media-preview-tests", passed: test.exitCode === 0, detail: `${tests.length} suites exit=${test.exitCode}` },
    sourceContains("import-limit", library, ["300 * 1024 * 1024"], "Video import limit is explicitly bounded at 300 MiB."),
    sourceContains("streamed-import", library, ["createReadStream"], "Media hashing/copying avoids loading the entire file into renderer memory."),
    sourceContains(
      "secure-range-stream",
      protocol,
      ["protocol.handle", "Accept-Ranges", "Content-Range", "createReadStream"],
      "Managed video preview uses the secure asset protocol with byte-range streaming."
    ),
    sourceContains(
      "pro-real-video-url",
      main,
      ["createMediaAssetUrl(asset.id)", "installMediaProtocolHandler(storageRoot)"],
      "Pro returns controlled playable URLs for managed videos."
    ),
    sourceContains(
      "lite-real-video-url",
      liteMain,
      ["createMediaAssetUrl(asset.id)", "installMediaProtocolHandler(storageRoot)"],
      "Lite returns controlled playable URLs for managed videos."
    ),
    sourceContains("selected-live-video", renderer, ["input.liveVideo === true", "<video", "live-card-video"], "Selected-card preview emits a real video element."),
    sourceContains("inactive-poster", renderer, ["video-poster"], "Inactive cards use posters instead of hidden playback."),
    sourceContains("selected-card-wiring", app, ['liveVideo: videoProjectMode === "video" && card.index === selectedIndex + 1'], "Only the selected video-mode card requests live playback."),
    sourceContains("timeline-seek", app, ["video.currentTime", "clipStartSeconds"], "Timeline seek updates the live video currentTime."),
    sourceContains(
      "assignment-dialog",
      app,
      ["media-assignment-title", 'data-smoke-role="media-assignment-dialog"', "가져온 미디어 적용"],
      "Import and assignment are represented as a separate explicit workflow."
    )
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
      "src/storage/mediaLibrary.ts",
      "electron/mediaProtocol.ts",
      "src/render-engine/cardTemplate.ts",
      "src/ui/App.tsx",
      "electron/main.ts",
      "electron/lite-main.ts",
      "src/storage/mediaLibrary.test.ts",
      "electron/mediaProtocol.test.ts",
      "electron/videoMediaProbe.test.ts",
      "src/render-engine/cardTemplate.test.ts",
      "src/ui/m22MediaUi.test.ts"
    ]))
  ],
  assertions,
  limitations: ["Decoded-frame pixel difference and packaged protocol playback remain portable/installed runtime gates."],
  log: logs.join("\n\n")
});
console.log(JSON.stringify(meta));
if (meta.status !== "pass") process.exitCode = 1;
