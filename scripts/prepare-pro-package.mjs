import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";

const sourcePath = path.resolve("dist-electron/electron/main.js");
const outputPath = sourcePath;
const adaptersPath = path.resolve("dist-electron/electron/ai/cliAdapters.js");
const deckStorePath = path.resolve("dist-electron/src/storage/deckStore.js");
const aiPromptsPath = path.resolve("dist-electron/src/edition/pro/ai/aiPrompts.js");
const rendererAssetsDirectory = path.resolve("dist/assets");

let source = await fs.readFile(sourcePath, "utf8");
const sourceBoundary = 'const devServerUrl = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];';
const forbiddenPatterns = [
  /CARDNEWS_SMOKE/,
  /VITE_DEV_SERVER_URL/,
  /CARDNEWS_MOCK_STYLE_EXTRACTION/,
  /run[A-Za-z0-9]*Smoke/,
  /SmokeCaptureError/
];

if (source.includes(sourceBoundary)) {
  source = replaceBounded(
    source,
    sourceBoundary,
    "let selectedStyleReferenceImages = [];",
    "let selectedStyleReferenceImages = [];"
  );

  source = replaceBounded(
    source,
    "class SmokeCaptureError extends Error {",
    "function createWindow() {",
    "function createWindow() {"
  );

  source = replaceBounded(
    source,
    "function createWindow() {",
    "function notImplemented(message) {",
    `function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 880,
        minWidth: 1080,
        minHeight: 720,
        title: "Cardnews Studio",
        backgroundColor: "#f4f7f5",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    void mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
}
function notImplemented(message) {`
  );
}

if (source.includes("CARDNEWS_MOCK_STYLE_EXTRACTION")) {
  source = replaceBounded(
    source,
    '    ipcMain.handle("cardnews:extractStyle",',
    '    ipcMain.handle("cardnews:approveStyle",',
    `    ipcMain.handle("cardnews:extractStyle", () =>
        styleExtractionFailed("스타일 분석을 완료하지 못했습니다. 기본 newsprint 스타일로 계속 만들 수 있습니다."));
    ipcMain.handle("cardnews:approveStyle",`
  );
}

source = source
  .replace("purgeImageLibrarySmokeFixtures, ", "")
  .replace(", smokeFixtureImageAttribution, internalSmokeImageAttribution", "")
  .replace(
    "listImageLibrary(storageRoot(), { includeSmokeFixtures: Boolean(smokeAction) })",
    "listImageLibrary(storageRoot())"
  )
  .replace(
    "found.entry.attribution === smokeFixtureImageAttribution ? smokeFixtureImageAttribution : undefined",
    "undefined"
  )
  .replace(",\n            allowMock: !app.isPackaged", "");

source = removeOptionalBlock(
  source,
  '        if (smokeAction === "render-export") {',
  "        const result = await dialog.showSaveDialog({"
);
source = removeOptionalBlock(
  source,
  '        if (smokeAction === "render-export") {',
  "        const result = await dialog.showSaveDialog({"
);

assertProductionOnly(source);

await fs.writeFile(outputPath, source, "utf8");

let adapters = await fs.readFile(adaptersPath, "utf8");
if (adapters.includes('process.env["CARDNEWS_MOCK_AI')) {
  adapters = replaceBounded(
    adapters,
    "    if (options.allowMock === true) {",
    "    if (!provider) {",
    "    if (!provider) {"
  );
}
for (const pattern of [/CARDNEWS_MOCK_AI/, /cliMock\.js/]) {
  if (pattern.test(adapters)) {
    throw new Error(`Pro package AI adapter still contains forbidden QA code: ${pattern}`);
  }
}
await fs.writeFile(adaptersPath, adapters, "utf8");

let deckStore = await fs.readFile(deckStorePath, "utf8");
if (deckStore.includes("internalSmokeImageAttribution")) {
  deckStore = replaceBounded(
    deckStore,
    "export const internalSmokeImageAttribution",
    "export async function addImageToLibrary",
    `export async function listImageLibrary(storageRoot) {
    const entries = await readImageIndex(storageRoot);
    return entries.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        ...(entry.attribution ? { attribution: entry.attribution } : {})
    }));
}
export async function addImageToLibrary`
  );

  deckStore = removeOptionalBlock(
    deckStore,
    "    if (attribution === internalSmokeImageAttribution) {",
    "    const entries = await readImageIndex(storageRoot);"
  );
}
if (/smoke/i.test(deckStore)) {
  throw new Error("Pro package deck store still contains QA smoke code");
}
await fs.writeFile(deckStorePath, deckStore, "utf8");

let aiPrompts = await fs.readFile(aiPromptsPath, "utf8");
if (aiPrompts.includes("buildMockDraftDocument")) {
  aiPrompts = replaceBounded(
    aiPrompts,
    "export function buildMockDraftDocument() {",
    "function looksLikeTemplateDocument(text) {",
    "function looksLikeTemplateDocument(text) {"
  );
}
if (/mock/i.test(aiPrompts)) {
  throw new Error("Pro package AI prompts still contain mock helpers");
}
await fs.writeFile(aiPromptsPath, aiPrompts, "utf8");

const rendererAssets = await fs.readdir(rendererAssetsDirectory);
for (const assetName of rendererAssets.filter((name) => name.endsWith(".js"))) {
  const assetPath = path.join(rendererAssetsDirectory, assetName);
  const original = await fs.readFile(assetPath, "utf8");
  const prepared = original.replaceAll("data-smoke-", "data-cardnews-");
  if (/smoke/i.test(prepared)) {
    throw new Error(`Pro renderer asset still contains smoke markers: ${assetName}`);
  }
  await fs.writeFile(assetPath, prepared, "utf8");
}
for (const assetName of rendererAssets.filter((name) => name.endsWith(".css"))) {
  const assetPath = path.join(rendererAssetsDirectory, assetName);
  const original = await fs.readFile(assetPath, "utf8");
  const root = postcss.parse(original, { from: assetPath });
  root.walkRules((rule) => {
    if (rule.selector.includes(".lite-")) {
      rule.remove();
    }
  });
  const prepared = root.toString();
  if (/\.lite-/i.test(prepared)) {
    throw new Error(`Pro renderer stylesheet still contains Lite selectors: ${assetName}`);
  }
  await fs.writeFile(assetPath, prepared, "utf8");
}

console.log(`Prepared production-only Pro entries: ${path.relative(process.cwd(), outputPath)}, ${path.relative(process.cwd(), adaptersPath)}, ${path.relative(process.cwd(), deckStorePath)}, ${path.relative(process.cwd(), aiPromptsPath)}, renderer assets`);

function replaceBounded(input, startMarker, endMarker, replacement) {
  const start = input.indexOf(startMarker);
  const end = input.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Could not find package-strip boundary: ${startMarker} -> ${endMarker}`);
  }
  return `${input.slice(0, start)}${replacement}${input.slice(end + endMarker.length)}`;
}

function removeOptionalBlock(input, startMarker, endMarker) {
  if (!input.includes(startMarker)) {
    return input;
  }
  return replaceBounded(input, startMarker, endMarker, endMarker);
}

function assertProductionOnly(input) {
  if (/smoke/i.test(input)) {
    throw new Error("Pro package main still contains QA smoke code");
  }
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(input)) {
      throw new Error(`Pro package main still contains forbidden QA code: ${pattern}`);
    }
  }
}
