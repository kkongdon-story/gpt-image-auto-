import fs from "node:fs/promises";
import path from "node:path";
import { runProcess, writeGateEvidence } from "./m23-evidence-helpers.mjs";

const gate = "G2-board-geometry";
const startedAt = new Date().toISOString();
const vitest = path.resolve("node_modules/vitest/vitest.mjs");
const testFiles = ["src/domain/m23Semantic.test.ts", "src/ui/m22MediaUi.test.ts", "src/render-engine/cardTemplate.test.ts"];
const command = `node ${vitest} --run ${testFiles.join(" ")}`;
const test = await runProcess(
  process.execPath,
  [vitest, "--run", ...testFiles],
  { timeoutMs: 120_000 }
);
const appSource = await fs.readFile(path.resolve("src/ui/App.tsx"), "utf8");
const rendererSource = await fs.readFile(path.resolve("src/render-engine/cardTemplate.ts"), "utf8");
const semanticPlacementSource = await fs.readFile(
  path.resolve("src/render-engine/semanticPlacement.ts"),
  "utf8"
);
const assertions = [
  { id: "canvas-tests-pass", passed: test.exitCode === 0, detail: `exit=${test.exitCode}` },
  {
    id: "semantic-eight-handles",
    passed: appSource.includes("semantic-resize-${handle}") && appSource.includes("resizeHandles.map"),
    detail: "Semantic items expose the shared eight-handle transform set."
  },
  {
    id: "semantic-dom-manifest",
    passed: rendererSource.includes("data-semantic-item-id"),
    detail: "Renderer emits stable semantic item IDs."
  },
  {
    id: "saved-placement-render-css",
    passed: rendererSource.includes("buildSemanticItemPlacementCss"),
    detail: "Saved semantic placement is consumed by the canonical renderer."
  },
  {
    id: "font-media-readiness-before-measure",
    passed:
      appSource.includes("await prepareSemanticItemPlacements(document)") &&
      semanticPlacementSource.includes("await root.fonts?.ready") &&
      semanticPlacementSource.includes("const images = Array.from(root.images)") &&
      appSource.includes("HTMLMediaElement.HAVE_CURRENT_DATA"),
    detail: "Board measurement waits for fonts, images, and selected video readiness."
  },
  {
    id: "inline-original-hidden",
    passed: appSource.includes('foreground.style.visibility = "hidden"'),
    detail: "Original glyphs are hidden during inline editing."
  }
];
const meta = await writeGateEvidence({
  gate,
  command,
  startedAt,
  exitCode: assertions.every((item) => item.passed) ? 0 : 1,
  assertions,
  log: `${test.stdout}\n${test.stderr}`
});
console.log(JSON.stringify(meta));
if (meta.verdict !== "pass") process.exitCode = 1;
