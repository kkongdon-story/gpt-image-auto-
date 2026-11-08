import fs from "node:fs/promises";
import path from "node:path";
import {
  artifactRecord,
  pathExists,
  runProcess,
  writeGateEvidence
} from "./m24-evidence-helpers.mjs";

const command = "node scripts/verify-m24-red.mjs";
const startedAt = new Date().toISOString();
const sourceFiles = {
  app: path.resolve("src/ui/App.tsx"),
  template: path.resolve("src/render-engine/cardTemplate.ts"),
  domainExport: path.resolve("src/domain/videoExport.ts"),
  exporter: path.resolve("electron/videoExporter.ts"),
  types: path.resolve("src/domain/types.ts")
};

const sourceEntries = await Promise.all(
  Object.entries(sourceFiles).map(async ([key, filePath]) => [key, await fs.readFile(filePath, "utf8")])
);
const source = Object.fromEntries(sourceEntries);
const artifacts = await Promise.all(Object.values(sourceFiles).map(artifactRecord));
const assertions = [];
const lines = [];

function assert(id, passed, detail) {
  assertions.push({ id, passed, detail });
  lines.push(`${passed ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

assert(
  "red-viewport-fixed-semantic-placement",
  source.template.includes("position: fixed !important"),
  "semantic card placement still uses viewport-fixed CSS"
);
assert(
  "red-always-visible-timeline",
  source.app.includes('<section className="m23-timeline"') && !source.app.includes('videoProjectMode === "video"'),
  "timeline is rendered without a persisted video-project-mode guard"
);
assert(
  "red-duplicate-export-entry",
  source.app.includes('"PNG 생성"') && source.app.includes("MP4 영상 내보내기"),
  "PNG top action and MP4 inspector action are separate"
);
assert(
  "red-opaque-prepare-stage",
  source.domainExport.includes('"prepare"') &&
    source.exporter.includes('progress({ phase: "prepare", percent: 10 })'),
  "export can wait at prepare 10 percent before preflight resolves"
);
assert(
  "red-no-export-watchdog",
  !source.exporter.includes("producer_init") &&
    !source.exporter.includes("watchdog") &&
    !source.exporter.includes("heartbeat"),
  "exporter has no producer-init watchdog or active heartbeat"
);
assert(
  "red-no-video-project-mode-schema",
  !source.types.includes("VideoProjectMode"),
  "persisted project shapes have no video project mode"
);

const inventoryStartedAt = new Date().toISOString();
const [statusResult, releaseFilesResult] = await Promise.all([
  runProcess("git", ["status", "--porcelain=v1"], { timeoutMs: 10000 }),
  runProcess(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "if (Test-Path -LiteralPath 'release') { Get-ChildItem -LiteralPath 'release' -Recurse -File | Select-Object -ExpandProperty FullName }"
    ],
    { timeoutMs: 30000 }
  )
]);
const releasePaths = releaseFilesResult.stdout
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);
const releaseArtifacts = [];
for (const filePath of releasePaths) {
  if (await pathExists(filePath)) {
    releaseArtifacts.push(await artifactRecord(filePath));
  }
}
const inventoryAssertions = [
  {
    id: "workspace-status-captured",
    passed: statusResult.exitCode === 0,
    detail: `${statusResult.stdout.split(/\r?\n/).filter(Boolean).length} dirty entries`
  },
  {
    id: "prior-release-inventory-captured",
    passed: releaseFilesResult.exitCode === 0 || releaseFilesResult.exitCode === 1,
    detail:
      releaseArtifacts.length > 0
        ? `${releaseArtifacts.length} release files`
        : "release directory absent or empty; no prior artifact can be overwritten"
  }
];

const inventory = await writeGateEvidence({
  gate: "G0-workspace-inventory",
  command,
  startedAt: inventoryStartedAt,
  exitCode: inventoryAssertions.every((item) => item.passed) ? 0 : 1,
  artifacts: releaseArtifacts,
  assertions: inventoryAssertions,
  log: [
    `command=${command}`,
    `workspaceDirtyEntries=${inventoryAssertions[0].detail}`,
    `releaseFiles=${releaseArtifacts.length}`,
    statusResult.stdout
  ].join("\n")
});

const red = await writeGateEvidence({
  gate: "G1-red-reproduction",
  command,
  startedAt,
  exitCode: assertions.every((item) => item.passed) ? 0 : 1,
  artifacts,
  assertions,
  log: [`command=${command}`, ...lines].join("\n")
});

console.log(JSON.stringify({ inventory, red }, null, 2));
if (inventory.status !== "pass" || red.status !== "pass") {
  process.exitCode = 1;
}
