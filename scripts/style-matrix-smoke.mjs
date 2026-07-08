// 스타일 프리셋 × 품질 게이트 매트릭스 스모크.
// 저장된 deck을 6개 스타일로 각각 렌더링해 게이트 통과 여부를 확인한다.
// 실행: node node_modules/electron/cli.js scripts/style-matrix-smoke.mjs
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { aspectRatios } from "../dist-electron/src/domain/aspectRatios.js";
import { buildFontFaceCss } from "../dist-electron/src/render-engine/cardTemplate.js";
import { renderDeckOffscreen } from "../dist-electron/src/render-engine/offscreenRenderer.js";
import { stylePresets } from "../dist-electron/src/render-engine/stylePresets.js";
import {
  currentDeckId,
  findLibraryBackground,
  getCardnewsStorageRoot,
  getRenderOutputDirectory,
  listCustomStyles,
  loadDeck
} from "../dist-electron/src/storage/deckStore.js";

app.setPath("userData", path.join(app.getPath("appData"), "gpt-cardnews-auto"));

// 오프스크린 렌더 창이 카드마다 열리고 닫히므로, 창이 모두 닫혀도 앱을 유지한다.
app.on("window-all-closed", () => {});

function isError(result) {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

app.whenReady().then(async () => {
  const storageRoot = getCardnewsStorageRoot(app.getPath("userData"));
  const deck = await loadDeck(storageRoot, currentDeckId);
  if (isError(deck)) {
    console.error(`deck load failed: ${deck.message}`);
    app.exit(1);
    return;
  }

  const backgroundImagePath = deck.backgroundId
    ? (await findLibraryBackground(storageRoot, deck.backgroundId))?.absolutePath
    : undefined;
  const storedCustomStyles = await listCustomStyles(storageRoot);
  const smokeCustomStyle = {
    ...stylePresets[0],
    id: "custom-smoke",
    name: "Smoke Custom",
    accentDefault: "#e8447c",
    bulletShape: "dash",
    titleTracking: 0.01
  };
  const customStyles = [
    smokeCustomStyle,
    ...storedCustomStyles.filter((style) => style.id !== smokeCustomStyle.id)
  ];
  const fontCss = await loadFontCss();

  const combos = [
    ...stylePresets.flatMap((preset) =>
      aspectRatios.map((ratio) => ({ styleId: preset.id, aspectRatio: ratio.id }))
    ),
    ...aspectRatios.map((ratio) => ({ styleId: smokeCustomStyle.id, aspectRatio: ratio.id }))
  ];

  let failures = 0;
  for (const combo of combos) {
    const matrixDeck = { ...deck };
    delete matrixDeck.chrome;
    const styledDeck = {
      ...matrixDeck,
      styleId: combo.styleId,
      aspectRatio: combo.aspectRatio,
      accentColor: undefined
    };
    const jobId = `style-smoke-${combo.styleId}-${combo.aspectRatio.replace(":", "x")}`;
    const result = await renderDeckOffscreen({
      backgroundImagePath,
      customStyles,
      deck: styledDeck,
      ...(fontCss ? { fontCss } : {}),
      jobId,
      outputDir: getRenderOutputDirectory(storageRoot, jobId)
    });

    if (isError(result)) {
      console.log(`${combo.styleId}@${combo.aspectRatio}: RENDER FAIL — ${result.message}`);
      failures += 1;
      continue;
    }

    console.log(
      `${combo.styleId}@${combo.aspectRatio}: hardGate=${result.gateReport.status === "fail" ? "fail" : "pass"} status=${result.gateReport.status} issues=${result.gateReport.issues.length}`
    );
    for (const issue of result.gateReport.issues.slice(0, 4)) {
      console.log(`  - card${issue.cardIndex} ${issue.slot} ${issue.gate}: ${issue.message}`);
    }

    if (result.gateReport.status === "fail") {
      failures += 1;
    }
  }

  app.exit(failures === 0 ? 0 : 1);
});

async function loadFontCss() {
  try {
    const fontPath = path.join(process.cwd(), "fonts", "PretendardVariable.woff2");
    const fontBase64 = (await fs.readFile(fontPath)).toString("base64");
    return buildFontFaceCss(`data:font/woff2;base64,${fontBase64}`);
  } catch {
    return undefined;
  }
}
