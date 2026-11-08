// noqa: SIZE_OK - v4 release keeps Electron bootstrap and IPC registration together; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import AdmZip from "adm-zip";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aspectRatios } from "../src/domain/aspectRatios.js";
import { parseCardText } from "../src/domain/cardParser.js";
import { parseBulkCsv } from "../src/domain/csvBulk.js";
import { isAllowedExternalUrl, isAllowedGptsTemplateBuilderUrl } from "../src/domain/externalLinks.js";
import { createPixabayApiUrl, createPixabayFallbackUrl, parsePixabayImages } from "../src/domain/imageProviders.js";
import { buildFontFaceCss } from "../src/render-engine/cardTemplate.js";
import { removeBackground } from "../src/render-engine/backgroundRemoval.js";
import { renderDeckOffscreen } from "../src/render-engine/offscreenRenderer.js";
import { isSafeStylePresetRecord } from "../src/render-engine/styleSafety.js";
import { stylePresets } from "../src/render-engine/stylePresets.js";
import { addBackgroundToLibrary, addImageToLibrary, buildDeckFromDraft, copyImageToDeckAssets, currentDeckId, deleteCustomStyle, deleteDeckPresetFromStore, findLibraryBackground, findLibraryFont, findLibraryImage, fontCssFormatForExtension, fontMimeTypeForExtension, getCardnewsStorageRoot, getRenderOutputDirectory, isRenderJobId, importFontToLibrary, isDeckPreset, isWorkspaceState, listCustomStyles, listBackgroundLibrary, listDeckPresets, listFontLibrary, listImageLibrary, loadAppSettings, loadDeck, loadWorkspaceState, purgeImageLibrarySmokeFixtures, removeImageFromLibrary, removeBackgroundFromLibrary, saveAppSettings, saveCustomStyle, saveDeckDraft, saveDeckPresetToStore, saveImageBufferToLibrary, saveWorkspaceState, smokeFixtureImageAttribution, internalSmokeImageAttribution } from "../src/storage/deckStore.js";
import { exportProjectArchive, importProjectArchive } from "../src/storage/projectArchive.js";
import { isAiProviderId, listAiProviderStatuses, runAiProviderChat } from "./ai/cliAdapters.js";
import { createStockDownloadPath, fetchAllowedPixabayImage, isSafeStockImageDownloadInput, readResponseBytesWithLimit } from "./stockImageDownload.js";
import { importTemplatePackArchive } from "./templatePackImporter.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let selectedStyleReferenceImages = [];
let approvedStyleProfile;
function createWindow() {
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
function notImplemented(message) {
    return { ok: false, code: "not_implemented", message };
}
function invalidInput(message) {
    return { ok: false, code: "invalid_input", message };
}
function styleExtractionFailed(message) {
    return { ok: false, code: "style_extraction_failed", message };
}
function externalServiceFailed(message) {
    return { ok: false, code: "external_service_failed", message };
}
function isCardnewsError(result) {
    return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}
async function writeDeckZip(outputDir, targetPath) {
    const zip = new AdmZip();
    for (const entry of await fs.readdir(outputDir)) {
        if (entry.endsWith(".png")) {
            zip.addLocalFile(path.join(outputDir, entry));
        }
    }
    zip.writeZip(targetPath);
}
function storageRoot() {
    return getCardnewsStorageRoot(app.getPath("userData"));
}
let cachedBundledFont;
async function loadFontData(fontId) {
    if (fontId) {
        const font = await findLibraryFont(storageRoot(), fontId);
        if (!font) {
            return undefined;
        }
        const base64 = (await fs.readFile(font.absolutePath)).toString("base64");
        return {
            base64,
            cssFamily: "Cardnews User Font",
            cssFormat: fontCssFormatForExtension(font.entry.extension),
            displayName: font.entry.displayName,
            mimeType: fontMimeTypeForExtension(font.entry.extension) ?? "application/octet-stream"
        };
    }
    if (cachedBundledFont !== undefined) {
        return cachedBundledFont ?? undefined;
    }
    try {
        const fontPath = path.join(app.getAppPath(), "fonts", "PretendardVariable.woff2");
        cachedBundledFont = {
            base64: (await fs.readFile(fontPath)).toString("base64"),
            cssFamily: "Pretendard",
            cssFormat: "woff2-variations",
            displayName: "Pretendard Variable",
            mimeType: "font/woff2"
        };
        return cachedBundledFont;
    }
    catch {
        cachedBundledFont = null;
        return undefined;
    }
}
function createRenderJobId() {
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    return `render-${stamp}`;
}
function isDeckDraft(input) {
    if (typeof input !== "object" || input === null) {
        return false;
    }
    if (!("headerLabel" in input) || typeof input.headerLabel !== "string") {
        return false;
    }
    if (!("footerAccount" in input) || typeof input.footerAccount !== "string") {
        return false;
    }
    if (!("cards" in input) || !Array.isArray(input.cards)) {
        return false;
    }
    if ("styleId" in input && input.styleId !== undefined && typeof input.styleId !== "string") {
        return false;
    }
    if ("accentColor" in input &&
        input.accentColor !== undefined &&
        typeof input.accentColor !== "string") {
        return false;
    }
    if ("backgroundDim" in input &&
        input.backgroundDim !== undefined &&
        typeof input.backgroundDim !== "number") {
        return false;
    }
    if ("aspectRatio" in input &&
        input.aspectRatio !== undefined &&
        typeof input.aspectRatio !== "string") {
        return false;
    }
    if ("backgroundId" in input &&
        input.backgroundId !== undefined &&
        typeof input.backgroundId !== "string") {
        return false;
    }
    if ("fontId" in input && input.fontId !== undefined && typeof input.fontId !== "string") {
        return false;
    }
    if ("chrome" in input && input.chrome !== undefined && !isChromeConfigCandidate(input.chrome)) {
        return false;
    }
    if ("overrides" in input && input.overrides !== undefined && !isCardOverrideMap(input.overrides)) {
        return false;
    }
    return input.cards.every(isDeckDraftCard);
}
function isChromeConfigCandidate(input) {
    return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isDeckDraftCard(input) {
    if (typeof input !== "object" || input === null) {
        return false;
    }
    return ("index" in input &&
        typeof input.index === "number" &&
        "rawText" in input &&
        typeof input.rawText === "string");
}
function isCardOverrideMap(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    return Object.entries(input).every(([key, value]) => /^\d+$/.test(key) && isCardOverride(value));
}
function isCardOverride(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const record = input;
    return ((record["backgroundId"] === undefined ||
        record["backgroundId"] === null ||
        typeof record["backgroundId"] === "string") &&
        (record["dim"] === undefined || typeof record["dim"] === "number") &&
        (record["adjust"] === undefined || isAdjustOverride(record["adjust"])) &&
        (record["layout"] === undefined || isLayoutOverride(record["layout"])) &&
        (record["typography"] === undefined || isTypographyOverride(record["typography"])) &&
        (record["layers"] === undefined ||
            (Array.isArray(record["layers"]) && record["layers"].every(isCardLayer))));
}
function isAdjustOverride(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const record = input;
    return (typeof record["brightness"] === "number" &&
        typeof record["contrast"] === "number" &&
        typeof record["saturation"] === "number");
}
function isLayoutOverride(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const record = input;
    return ((record["align"] === "left" || record["align"] === "center") &&
        typeof record["offsetY"] === "number" &&
        typeof record["gapBadge"] === "number" &&
        typeof record["gapSubtitle"] === "number");
}
function isTypographyOverride(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const record = input;
    return ((record["sizeScale"] === undefined || typeof record["sizeScale"] === "number") &&
        (record["weight"] === undefined || typeof record["weight"] === "number") &&
        (record["italic"] === undefined || typeof record["italic"] === "boolean"));
}
function isCardLayer(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const record = input;
    const hasCommon = typeof record["id"] === "string" &&
        (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
        (record["opacity"] === undefined || typeof record["opacity"] === "number");
    if (!hasCommon) {
        return false;
    }
    if (record["kind"] === "line") {
        return isEndpointLineLayer(record) || isLegacyLineLayer(record);
    }
    const hasBox = typeof record["x"] === "number" &&
        typeof record["y"] === "number" &&
        typeof record["width"] === "number" &&
        typeof record["height"] === "number";
    if (!hasBox) {
        return false;
    }
    switch (record["kind"]) {
        case "text":
            return (typeof record["text"] === "string" &&
                (record["color"] === undefined || typeof record["color"] === "string") &&
                (record["backgroundColor"] === undefined || typeof record["backgroundColor"] === "string") &&
                (record["fontSize"] === undefined || typeof record["fontSize"] === "number") &&
                (record["fontWeight"] === undefined || typeof record["fontWeight"] === "number") &&
                (record["italic"] === undefined || typeof record["italic"] === "boolean") &&
                (record["align"] === undefined ||
                    record["align"] === "left" ||
                    record["align"] === "center" ||
                    record["align"] === "right"));
        case "shape":
            return ((record["shape"] === "rect" || record["shape"] === "ellipse") &&
                typeof record["fill"] === "string" &&
                (record["stroke"] === undefined || typeof record["stroke"] === "string") &&
                (record["strokeWidth"] === undefined || typeof record["strokeWidth"] === "number") &&
                (record["radius"] === undefined || typeof record["radius"] === "number"));
        case "image":
            return (typeof record["backgroundId"] === "string" &&
                (record["objectFit"] === undefined ||
                    record["objectFit"] === "cover" ||
                    record["objectFit"] === "contain"));
        default:
            return false;
    }
}
function isEndpointLineLayer(record) {
    return (record["kind"] === "line" &&
        typeof record["id"] === "string" &&
        typeof record["x1"] === "number" &&
        typeof record["y1"] === "number" &&
        typeof record["x2"] === "number" &&
        typeof record["y2"] === "number" &&
        typeof record["thickness"] === "number" &&
        typeof record["color"] === "string" &&
        (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
        (record["opacity"] === undefined || typeof record["opacity"] === "number"));
}
function isLegacyLineLayer(record) {
    return (record["kind"] === "line" &&
        typeof record["id"] === "string" &&
        typeof record["x"] === "number" &&
        typeof record["y"] === "number" &&
        typeof record["width"] === "number" &&
        typeof record["height"] === "number" &&
        typeof record["color"] === "string" &&
        (record["strokeWidth"] === undefined || typeof record["strokeWidth"] === "number") &&
        (record["rotation"] === undefined || typeof record["rotation"] === "number") &&
        (record["zIndex"] === undefined || typeof record["zIndex"] === "number") &&
        (record["opacity"] === undefined || typeof record["opacity"] === "number"));
}
function isStyleProfile(input) {
    if (typeof input !== "object" || input === null) {
        return false;
    }
    return ("id" in input &&
        typeof input.id === "string" &&
        "name" in input &&
        typeof input.name === "string" &&
        "palette" in input &&
        Array.isArray(input.palette) &&
        "layoutMood" in input &&
        typeof input.layoutMood === "string" &&
        "fontMood" in input &&
        typeof input.fontMood === "string" &&
        "approved" in input &&
        typeof input.approved === "boolean");
}
function isStylePresetRecord(input) {
    return isSafeStylePresetRecord(input);
}
function isAppSettings(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const record = input;
    return ((record["pixabayApiKey"] === undefined || typeof record["pixabayApiKey"] === "string") &&
        (record["aiDefaultProviderId"] === undefined || isAiProviderId(record["aiDefaultProviderId"])) &&
        (record["gptsTemplateBuilderUrl"] === undefined ||
            (typeof record["gptsTemplateBuilderUrl"] === "string" &&
                isAllowedGptsTemplateBuilderUrl(record["gptsTemplateBuilderUrl"]))));
}
function isAiChatMessages(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > 16) {
        return false;
    }
    return input.every((message) => {
        if (typeof message !== "object" || message === null || Array.isArray(message)) {
            return false;
        }
        const record = message;
        return (isAiChatRole(record["role"]) &&
            typeof record["content"] === "string" &&
            record["content"].trim().length > 0 &&
            record["content"].length <= 20_000);
    });
}
function isAiChatRole(input) {
    return input === "system" || input === "user" || input === "assistant";
}
async function chooseImageFiles(allowsMultipleSelection) {
    const result = await dialog.showOpenDialog({
        filters: [{ extensions: ["png", "jpg", "jpeg", "webp"], name: "Images" }],
        properties: allowsMultipleSelection ? ["openFile", "multiSelections"] : ["openFile"]
    });
    return result.canceled ? undefined : result.filePaths;
}
async function chooseFontFile() {
    const result = await dialog.showOpenDialog({
        filters: [{ extensions: ["ttf", "otf", "woff2"], name: "Fonts" }],
        properties: ["openFile"]
    });
    return result.canceled ? undefined : result.filePaths[0];
}
async function chooseCsvFile() {
    const result = await dialog.showOpenDialog({
        filters: [{ extensions: ["csv"], name: "CSV" }],
        properties: ["openFile"]
    });
    return result.canceled ? undefined : result.filePaths[0];
}
async function chooseTemplatePackFile() {
    const result = await dialog.showOpenDialog({
        filters: [{ extensions: ["zip"], name: "Kkongdon Template Pack" }],
        properties: ["openFile"]
    });
    return result.canceled ? undefined : result.filePaths[0];
}
function validateImageDecode(filePath) {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
        return invalidInput("이미지를 디코딩할 수 없습니다.");
    }
    return undefined;
}
async function searchPixabayImages(query, page) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
        return invalidInput("검색어를 입력하세요.");
    }
    const settings = await loadAppSettings(storageRoot());
    const apiKey = settings.pixabayApiKey?.trim();
    const fallbackUrl = createPixabayFallbackUrl(trimmedQuery);
    if (!apiKey) {
        await shell.openExternal(fallbackUrl);
        return {
            mode: "browser-fallback",
            provider: "pixabay",
            query: trimmedQuery,
            images: [],
            fallbackUrl
        };
    }
    const endpoint = createPixabayApiUrl(apiKey, trimmedQuery, page);
    try {
        const response = await fetch(endpoint);
        if (!response.ok) {
            return externalServiceFailed(`Pixabay 응답 오류: HTTP ${response.status}`);
        }
        const parsed = await response.json();
        const images = parsePixabayImages(parsed);
        return { mode: "api", provider: "pixabay", query: trimmedQuery, images };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
        return externalServiceFailed(`Pixabay 검색 실패: ${message}`);
    }
}
async function downloadStockImageToLibrary(input) {
    let filePath;
    try {
        const response = await fetchAllowedPixabayImage(input.imageUrl);
        if (!response.ok) {
            return externalServiceFailed(`이미지 다운로드 실패: HTTP ${response.status}`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        const extension = extensionForContentType(contentType) ?? extensionForPath(new URL(input.imageUrl).pathname);
        if (!extension) {
            return invalidInput("지원하지 않는 이미지 형식입니다.");
        }
        const bytes = await readResponseBytesWithLimit(response);
        const downloadDir = path.join(storageRoot(), "stock-downloads");
        await fs.mkdir(downloadDir, { recursive: true });
        filePath = createStockDownloadPath(downloadDir, extension);
        await fs.writeFile(filePath, bytes);
        const decodeResult = validateImageDecode(filePath);
        if (isCardnewsError(decodeResult)) {
            return decodeResult;
        }
        return addBackgroundToLibrary(storageRoot(), filePath, `Pixabay / ${input.author} / ${input.pageUrl}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
        return externalServiceFailed(`이미지 다운로드 실패: ${message}`);
    }
    finally {
        if (filePath) {
            await fs.rm(filePath, { force: true }).catch(() => undefined);
        }
    }
}
function extensionForContentType(contentType) {
    const normalized = contentType.toLowerCase();
    if (normalized.includes("image/png")) {
        return "png";
    }
    if (normalized.includes("image/jpeg")) {
        return "jpg";
    }
    if (normalized.includes("image/webp")) {
        return "webp";
    }
    return undefined;
}
function extensionForPath(pathname) {
    const extension = path.extname(pathname).slice(1).toLowerCase();
    return ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : undefined;
}
async function renderDeckToOutput(deck, jobId, outputDir, customStyles) {
    const renderAssets = await resolveDeckRenderAssets(deck);
    const fontCss = await buildRenderFontCss(deck.fontId);
    if (isCardnewsError(fontCss)) {
        return fontCss;
    }
    return renderDeckOffscreen({
        ...renderAssets,
        customStyles,
        deck,
        jobId,
        outputDir,
        ...(fontCss ? { fontCss } : {})
    });
}
async function resolveDeckRenderAssets(deck) {
    const libraryBackground = deck.backgroundId
        ? await findLibraryBackground(storageRoot(), deck.backgroundId)
        : undefined;
    const backgroundImagePath = libraryBackground?.absolutePath;
    const backgroundImagePathByCardIndex = {};
    const assetImagePathById = {};
    if (deck.backgroundId && backgroundImagePath) {
        assetImagePathById[deck.backgroundId] = backgroundImagePath;
    }
    if (deck.nextHint?.kind === "image" && deck.nextHint.imageId) {
        const nextHintImage = await findLibraryImage(storageRoot(), deck.nextHint.imageId);
        if (nextHintImage) {
            assetImagePathById[deck.nextHint.imageId] = nextHintImage.absolutePath;
        }
    }
    for (const [cardIndex, override] of Object.entries(deck.overrides ?? {})) {
        if (override.backgroundId === null) {
            backgroundImagePathByCardIndex[cardIndex] = null;
        }
        else if (override.backgroundId) {
            const overrideBackground = await findLibraryBackground(storageRoot(), override.backgroundId);
            backgroundImagePathByCardIndex[cardIndex] = overrideBackground?.absolutePath ?? null;
            if (overrideBackground) {
                assetImagePathById[override.backgroundId] = overrideBackground.absolutePath;
            }
        }
        if (override.badge?.imageId && !assetImagePathById[override.badge.imageId]) {
            const badgeImage = await findLibraryImage(storageRoot(), override.badge.imageId);
            if (badgeImage) {
                assetImagePathById[override.badge.imageId] = badgeImage.absolutePath;
            }
        }
        for (const layer of override.layers ?? []) {
            if (layer.kind !== "image" || assetImagePathById[layer.backgroundId]) {
                continue;
            }
            const layerBackground = await findLibraryBackground(storageRoot(), layer.backgroundId);
            if (layerBackground) {
                assetImagePathById[layer.backgroundId] = layerBackground.absolutePath;
                continue;
            }
            const layerImage = await findLibraryImage(storageRoot(), layer.backgroundId);
            if (layerImage) {
                assetImagePathById[layer.backgroundId] = layerImage.absolutePath;
            }
        }
    }
    return { assetImagePathById, backgroundImagePath, backgroundImagePathByCardIndex };
}
async function buildRenderFontCss(fontId) {
    const fontData = await loadFontData(fontId);
    if (fontId && !fontData) {
        return invalidInput("선택한 폰트를 라이브러리에서 찾지 못했습니다.");
    }
    return fontData
        ? buildFontFaceCss(`data:${fontData.mimeType};base64,${fontData.base64}`, {
            family: fontData.cssFamily,
            format: fontData.cssFormat
        })
        : undefined;
}
async function renderBulkCsvText(csvText) {
    if (csvText.trim().length === 0) {
        return invalidInput("CSV 내용이 비어 있습니다.");
    }
    const customStyles = await listCustomStyles(storageRoot());
    const styleIds = [...stylePresets.map((style) => style.id), ...customStyles.map((style) => style.id)];
    const parsed = parseBulkCsv(csvText, styleIds, aspectRatios.map((ratio) => ratio.id));
    if (isCardnewsError(parsed)) {
        return parsed;
    }
    const jobId = `bulk-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
    const outputDir = getRenderOutputDirectory(storageRoot(), jobId);
    await fs.mkdir(outputDir, { recursive: true });
    const rowResults = parsed.issues.map((issue) => ({
        rowNumber: issue.rowNumber,
        outputName: `row-${issue.rowNumber}`,
        status: "failed",
        cardCount: 0,
        message: issue.message
    }));
    for (const row of parsed.rows) {
        const referenceError = await validateBulkReferences(row.deckDraft);
        if (isCardnewsError(referenceError)) {
            rowResults.push({
                rowNumber: row.rowNumber,
                outputName: row.outputName,
                status: "failed",
                cardCount: 0,
                message: referenceError.message
            });
            continue;
        }
        const deck = buildDeckFromDraft(`${jobId}-${row.rowNumber}`, row.deckDraft, approvedStyleProfile);
        if (isCardnewsError(deck)) {
            rowResults.push({
                rowNumber: row.rowNumber,
                outputName: row.outputName,
                status: "failed",
                cardCount: 0,
                message: deck.message
            });
            continue;
        }
        const rowOutputDir = path.join(outputDir, safeOutputName(row.outputName, row.rowNumber));
        const rendered = await renderDeckToOutput(deck, `${jobId}-${row.rowNumber}`, rowOutputDir, customStyles);
        if (isCardnewsError(rendered)) {
            rowResults.push({
                rowNumber: row.rowNumber,
                outputName: row.outputName,
                status: "failed",
                cardCount: 0,
                outputDir: rowOutputDir,
                message: rendered.message
            });
            continue;
        }
        rowResults.push({
            rowNumber: row.rowNumber,
            outputName: row.outputName,
            status: "rendered",
            cardCount: rendered.cardCount,
            outputDir: rendered.outputDir
        });
    }
    rowResults.sort((first, second) => first.rowNumber - second.rowNumber);
    const renderedCount = rowResults.filter((row) => row.status === "rendered").length;
    const failedCount = rowResults.length - renderedCount;
    const zipPath = path.join(outputDir, "bulk-output.zip");
    const result = {
        failedCount,
        jobId,
        outputDir,
        renderedCount,
        rows: rowResults,
        totalRows: rowResults.length,
        zipPath
    };
    await writeBulkReports(outputDir, result);
    const zip = new AdmZip();
    zip.addLocalFolder(outputDir);
    zip.writeZip(zipPath);
    return result;
}
async function validateBulkReferences(input) {
    if (input.backgroundId && !(await findLibraryBackground(storageRoot(), input.backgroundId))) {
        return invalidInput(`배경 id를 찾을 수 없습니다: ${input.backgroundId}`);
    }
    if (input.fontId && !(await findLibraryFont(storageRoot(), input.fontId))) {
        return invalidInput(`폰트 id를 찾을 수 없습니다: ${input.fontId}`);
    }
    return undefined;
}
async function writeBulkReports(outputDir, result) {
    await fs.writeFile(path.join(outputDir, "bulk-report.json"), JSON.stringify(result, null, 2), "utf8");
    const header = "rowNumber,outputName,status,cardCount,outputDir,message";
    const rows = result.rows.map((row) => [
        String(row.rowNumber),
        row.outputName,
        row.status,
        String(row.cardCount),
        row.outputDir ?? "",
        row.message ?? ""
    ]
        .map(escapeCsvValue)
        .join(","));
    // BOM: Excel에서 한글 리포트가 깨지지 않도록.
    await fs.writeFile(path.join(outputDir, "bulk-report.csv"), `\uFEFF${[header, ...rows].join("\n")}`, "utf8");
}
function safeOutputName(value, rowNumber) {
    const normalized = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-");
    return normalized.length > 0 ? normalized.slice(0, 80) : `row-${rowNumber}`;
}
function escapeCsvValue(value) {
    if (!/[",\r\n]/.test(value)) {
        return value;
    }
    return `"${value.replaceAll("\"", "\"\"")}"`;
}
app.whenReady().then(() => {
    ipcMain.handle("cardnews:getEdition", () => ({ edition: "pro", productName: "Cardnews Studio Pro" }));
    ipcMain.handle("cardnews:requestLockedFeature", () => undefined);
    ipcMain.handle("cardnews:chooseStyleReferenceImages", async () => {
        const filePaths = await chooseImageFiles(true);
        if (!filePaths || filePaths.length === 0) {
            return invalidInput("스타일 참고 이미지 선택이 취소되었습니다.");
        }
        const copiedImages = [];
        for (const filePath of filePaths.slice(0, 6)) {
            const decodeResult = validateImageDecode(filePath);
            if (isCardnewsError(decodeResult)) {
                return decodeResult;
            }
            const copied = await copyImageToDeckAssets(storageRoot(), filePath, "style-reference", copiedImages.length + 1);
            if (isCardnewsError(copied)) {
                return copied;
            }
            copiedImages.push(copied);
        }
        selectedStyleReferenceImages = copiedImages;
        return copiedImages.map((image) => image.ref);
    });
    ipcMain.handle("cardnews:loadDeck", () => loadDeck(storageRoot(), currentDeckId));
    ipcMain.handle("cardnews:saveDeck", (_event, input) => {
        if (!isDeckDraft(input)) {
            return invalidInput("Deck 입력 형식이 올바르지 않습니다.");
        }
        return saveDeckDraft(storageRoot(), input, approvedStyleProfile);
    });
    ipcMain.handle("cardnews:parseCard", (_event, rawText, index) => {
        if (typeof rawText !== "string") {
            return invalidInput("카드 원문은 문자열이어야 합니다.");
        }
        if (typeof index !== "number") {
            return invalidInput("카드 번호는 숫자여야 합니다.");
        }
        return parseCardText(rawText, index);
    });
    ipcMain.handle("cardnews:extractStyle", () => !app.isPackaged && process.env["CARDNEWS_MOCK_STYLE_EXTRACTION"] === "1"
        ? {
            palette: ["#1d1d1b", "#f8f1e3", "#123c3a", "#a53d2d"],
            layoutMood: "newsprint editorial",
            fontMood: "bold Korean sans-serif"
        }
        : styleExtractionFailed("스타일 분석을 완료하지 못했습니다. 기본 newsprint 스타일로 계속 만들 수 있습니다."));
    ipcMain.handle("cardnews:approveStyle", (_event, profile) => {
        if (!isStyleProfile(profile)) {
            return invalidInput("스타일 프로필 형식이 올바르지 않습니다.");
        }
        approvedStyleProfile = { ...profile, approved: true };
        return approvedStyleProfile;
    });
    ipcMain.handle("cardnews:renderDeck", async (_event, deckId) => {
        if (typeof deckId !== "string") {
            return invalidInput("deck id는 문자열이어야 합니다.");
        }
        const deck = await loadDeck(storageRoot(), deckId);
        if (isCardnewsError(deck)) {
            return deck;
        }
        const jobId = createRenderJobId();
        const customStyles = await listCustomStyles(storageRoot());
        return renderDeckToOutput(deck, jobId, getRenderOutputDirectory(storageRoot(), jobId), customStyles);
    });
    ipcMain.handle("cardnews:importDeckDocument", async () => {
        const result = await dialog.showOpenDialog({
            filters: [{ extensions: ["md", "txt"], name: "카드뉴스 양식" }],
            properties: ["openFile"]
        });
        const filePath = result.canceled ? undefined : result.filePaths[0];
        if (!filePath) {
            return invalidInput("양식 파일 선택이 취소되었습니다.");
        }
        try {
            const stat = await fs.stat(filePath);
            if (stat.size > 1024 * 1024) {
                return invalidInput("양식 파일은 1MB 이하만 불러올 수 있습니다.");
            }
            const text = await fs.readFile(filePath, "utf8");
            return { fileName: path.basename(filePath), text };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`양식 파일을 읽지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:importCustomStyleFile", async () => {
        const result = await dialog.showOpenDialog({
            filters: [{ extensions: ["json"], name: "스타일 JSON" }],
            properties: ["openFile"]
        });
        const filePath = result.canceled ? undefined : result.filePaths[0];
        if (!filePath) {
            return invalidInput("스타일 JSON 파일 선택이 취소되었습니다.");
        }
        try {
            const stat = await fs.stat(filePath);
            if (stat.size > 256 * 1024) {
                return invalidInput("스타일 JSON 파일은 256KB 이하만 불러올 수 있습니다.");
            }
            const text = await fs.readFile(filePath, "utf8");
            return { fileName: path.basename(filePath), text };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`스타일 JSON 파일을 읽지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:exportTemplateFile", async (_event, content) => {
        if (typeof content !== "string" || content.length === 0) {
            return invalidInput("양식 내용이 비어 있습니다.");
        }
        const result = await dialog.showSaveDialog({
            defaultPath: "카드뉴스-양식.md",
            filters: [{ extensions: ["md"], name: "Markdown" }]
        });
        if (result.canceled || !result.filePath) {
            return invalidInput("양식 저장이 취소되었습니다.");
        }
        await fs.writeFile(result.filePath, content, "utf8");
        return result.filePath;
    });
    ipcMain.handle("cardnews:importBulkCsvFile", async () => {
        const filePath = await chooseCsvFile();
        if (!filePath) {
            return invalidInput("CSV 파일 선택이 취소되었습니다.");
        }
        try {
            const stat = await fs.stat(filePath);
            if (stat.size > 2 * 1024 * 1024) {
                return invalidInput("CSV 파일은 2MB 이하만 불러올 수 있습니다.");
            }
            const text = await fs.readFile(filePath, "utf8");
            return { fileName: path.basename(filePath), text };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`CSV 파일을 읽지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:exportBulkCsvTemplate", async (_event, content) => {
        if (typeof content !== "string" || content.length === 0) {
            return invalidInput("CSV 템플릿 내용이 비어 있습니다.");
        }
        const result = await dialog.showSaveDialog({
            defaultPath: "cardnews-bulk-template.csv",
            filters: [{ extensions: ["csv"], name: "CSV" }]
        });
        if (result.canceled || !result.filePath) {
            return invalidInput("CSV 템플릿 저장이 취소되었습니다.");
        }
        // Excel이 UTF-8 CSV를 CP949로 열어 한글이 깨지는 것을 막는 BOM.
        await fs.writeFile(result.filePath, `\uFEFF${content}`, "utf8");
        return result.filePath;
    });
    ipcMain.handle("cardnews:renderBulkCsv", (_event, csvText) => {
        if (typeof csvText !== "string") {
            return invalidInput("CSV 내용은 문자열이어야 합니다.");
        }
        return renderBulkCsvText(csvText);
    });
    ipcMain.handle("cardnews:listBackgroundLibrary", () => listBackgroundLibrary(storageRoot()));
    ipcMain.handle("cardnews:listImageLibrary", () => listImageLibrary(storageRoot(), { includeSmokeFixtures: Boolean(smokeAction) }));
    ipcMain.handle("cardnews:listFontLibrary", () => listFontLibrary(storageRoot()));
    ipcMain.handle("cardnews:importFontToLibrary", async () => {
        const filePath = await chooseFontFile();
        if (!filePath) {
            return invalidInput("폰트 파일 선택이 취소되었습니다.");
        }
        return importFontToLibrary(storageRoot(), filePath);
    });
    ipcMain.handle("cardnews:addBackgroundToLibrary", async () => {
        const filePaths = await chooseImageFiles(false);
        const filePath = filePaths?.[0];
        if (!filePath) {
            return invalidInput("배경 이미지 선택이 취소되었습니다.");
        }
        const decodeResult = validateImageDecode(filePath);
        if (isCardnewsError(decodeResult)) {
            return decodeResult;
        }
        return addBackgroundToLibrary(storageRoot(), filePath);
    });
    ipcMain.handle("cardnews:removeBackgroundFromLibrary", (_event, backgroundId) => {
        if (typeof backgroundId !== "string" || backgroundId.length === 0) {
            return invalidInput("배경 이미지 id가 올바르지 않습니다.");
        }
        return removeBackgroundFromLibrary(storageRoot(), backgroundId);
    });
    ipcMain.handle("cardnews:addImageToLibrary", async () => {
        const filePaths = await chooseImageFiles(false);
        const filePath = filePaths?.[0];
        if (!filePath) {
            return invalidInput("이미지 선택이 취소되었습니다.");
        }
        const decodeResult = validateImageDecode(filePath);
        if (isCardnewsError(decodeResult)) {
            return decodeResult;
        }
        return addImageToLibrary(storageRoot(), filePath);
    });
    ipcMain.handle("cardnews:removeImageFromLibrary", (_event, imageId) => {
        if (typeof imageId !== "string" || imageId.length === 0) {
            return invalidInput("이미지 id가 올바르지 않습니다.");
        }
        return removeImageFromLibrary(storageRoot(), imageId);
    });
    ipcMain.handle("cardnews:searchStockImages", (_event, query, page) => {
        if (typeof query !== "string") {
            return invalidInput("검색어는 문자열이어야 합니다.");
        }
        if (typeof page !== "number") {
            return invalidInput("페이지 번호는 숫자여야 합니다.");
        }
        return searchPixabayImages(query, page);
    });
    ipcMain.handle("cardnews:downloadStockImage", (_event, input) => {
        if (!isSafeStockImageDownloadInput(input)) {
            return invalidInput("이미지 다운로드 입력 형식이 올바르지 않습니다.");
        }
        return downloadStockImageToLibrary(input);
    });
    ipcMain.handle("cardnews:importTemplatePack", async () => {
        const filePath = await chooseTemplatePackFile();
        if (!filePath) {
            return invalidInput("템플릿팩 가져오기가 취소되었습니다.");
        }
        return importTemplatePackArchive(storageRoot(), filePath);
    });
    ipcMain.handle("cardnews:loadSettings", () => loadAppSettings(storageRoot()));
    ipcMain.handle("cardnews:saveSettings", async (_event, settings) => {
        if (!isAppSettings(settings)) {
            return invalidInput("설정 형식이 올바르지 않습니다.");
        }
        await saveAppSettings(storageRoot(), settings);
        return undefined;
    });
    ipcMain.handle("cardnews:ai:listProviders", (_event, forceRefresh) => listAiProviderStatuses({ forceRefresh: forceRefresh === true }));
    ipcMain.handle("cardnews:ai:chat", async (_event, providerId, messages) => {
        if (!isAiProviderId(providerId)) {
            return invalidInput("AI provider는 claude, codex, gemini 중 하나여야 합니다.");
        }
        if (!isAiChatMessages(messages)) {
            return invalidInput("AI 대화 메시지 형식이 올바르지 않습니다.");
        }
        return runAiProviderChat(providerId, messages, {
            cwd: storageRoot(),
            allowMock: !app.isPackaged
        });
    });
    ipcMain.handle("cardnews:listCustomStyles", () => listCustomStyles(storageRoot()));
    ipcMain.handle("cardnews:saveCustomStyle", (_event, style) => {
        if (!isStylePresetRecord(style)) {
            return invalidInput("커스텀 스타일 형식이 올바르지 않습니다.");
        }
        return saveCustomStyle(storageRoot(), style);
    });
    ipcMain.handle("cardnews:deleteCustomStyle", (_event, styleId) => {
        if (typeof styleId !== "string" || !styleId.startsWith("custom-")) {
            return invalidInput("삭제할 커스텀 스타일 id가 올바르지 않습니다.");
        }
        return deleteCustomStyle(storageRoot(), styleId);
    });
    ipcMain.handle("cardnews:listDeckPresets", () => listDeckPresets(storageRoot()));
    ipcMain.handle("cardnews:saveDeckPreset", (_event, preset) => {
        if (!isDeckPreset(preset)) {
            return invalidInput("양식 프리셋 형식이 올바르지 않습니다.");
        }
        return saveDeckPresetToStore(storageRoot(), preset);
    });
    ipcMain.handle("cardnews:deleteDeckPreset", (_event, name) => {
        if (typeof name !== "string" || name.trim().length === 0) {
            return invalidInput("삭제할 양식 이름이 올바르지 않습니다.");
        }
        return deleteDeckPresetFromStore(storageRoot(), name);
    });
    ipcMain.handle("cardnews:saveWorkspace", async (_event, state) => {
        if (!isWorkspaceState(state)) {
            return invalidInput("작업 상태 형식이 올바르지 않습니다.");
        }
        await saveWorkspaceState(storageRoot(), state);
        return undefined;
    });
    ipcMain.handle("cardnews:loadWorkspace", () => loadWorkspaceState(storageRoot()));
    ipcMain.handle("cardnews:exportCardPng", async (_event, jobId, fileName) => {
        if (!isRenderJobId(jobId)) {
            return invalidInput("렌더 작업 id가 올바르지 않습니다.");
        }
        if (typeof fileName !== "string" || !/^card-\d+\.png$/.test(fileName)) {
            return invalidInput("카드 파일 이름이 올바르지 않습니다.");
        }
        const sourcePath = path.join(getRenderOutputDirectory(storageRoot(), jobId), fileName);
        if (smokeAction === "render-export") {
            const targetDir = path.join(getRenderOutputDirectory(storageRoot(), jobId), "smoke-exports");
            const targetPath = path.join(targetDir, fileName);
            await fs.mkdir(targetDir, { recursive: true });
            await fs.copyFile(sourcePath, targetPath);
            return targetPath;
        }
        const result = await dialog.showSaveDialog({
            defaultPath: fileName,
            filters: [{ extensions: ["png"], name: "PNG" }]
        });
        if (result.canceled || !result.filePath) {
            return invalidInput("PNG 저장이 취소되었습니다.");
        }
        try {
            await fs.copyFile(sourcePath, result.filePath);
            return result.filePath;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`PNG를 저장하지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:exportDeckZip", async (_event, jobId) => {
        if (!isRenderJobId(jobId)) {
            return invalidInput("렌더 작업 id가 올바르지 않습니다.");
        }
        const outputDir = getRenderOutputDirectory(storageRoot(), jobId);
        const stamp = new Date().toISOString().slice(0, 10);
        if (smokeAction === "render-export") {
            const targetDir = path.join(outputDir, "smoke-exports");
            const targetPath = path.join(targetDir, `cardnews-${stamp}.zip`);
            await fs.mkdir(targetDir, { recursive: true });
            await writeDeckZip(outputDir, targetPath);
            return targetPath;
        }
        const result = await dialog.showSaveDialog({
            defaultPath: `cardnews-${stamp}.zip`,
            filters: [{ extensions: ["zip"], name: "ZIP" }]
        });
        if (result.canceled || !result.filePath) {
            return invalidInput("ZIP 저장이 취소되었습니다.");
        }
        try {
            await writeDeckZip(outputDir, result.filePath);
            return result.filePath;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 압축 오류";
            return invalidInput(`ZIP을 만들지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:exportProject", async () => {
        const stamp = new Date().toISOString().slice(0, 10);
        const result = await dialog.showSaveDialog({
            defaultPath: `cardnews-project-${stamp}.cardnews`,
            filters: [{ extensions: ["cardnews"], name: "Cardnews Project" }]
        });
        if (result.canceled || !result.filePath) {
            return invalidInput("프로젝트 저장이 취소되었습니다.");
        }
        const targetPath = result.filePath.toLowerCase().endsWith(".cardnews")
            ? result.filePath
            : `${result.filePath}.cardnews`;
        return exportProjectArchive(storageRoot(), targetPath, app.getVersion());
    });
    ipcMain.handle("cardnews:importProject", async () => {
        const result = await dialog.showOpenDialog({
            filters: [{ extensions: ["cardnews"], name: "Cardnews Project" }],
            properties: ["openFile"]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return invalidInput("프로젝트 열기가 취소되었습니다.");
        }
        return importProjectArchive(storageRoot(), result.filePaths[0] ?? "");
    });
    ipcMain.handle("cardnews:getFontData", async (_event, fontId) => {
        if (fontId !== undefined && fontId !== null && typeof fontId !== "string") {
            return invalidInput("폰트 id가 올바르지 않습니다.");
        }
        return (await loadFontData(fontId ?? null)) ?? invalidInput("폰트를 찾지 못했습니다.");
    });
    ipcMain.handle("cardnews:getBackgroundPreview", async (_event, backgroundId) => {
        if (typeof backgroundId !== "string" || backgroundId.length === 0) {
            return invalidInput("배경 id가 올바르지 않습니다.");
        }
        const found = await findLibraryBackground(storageRoot(), backgroundId);
        const assetPath = found?.absolutePath;
        if (!assetPath) {
            return invalidInput("라이브러리에서 배경 이미지를 찾지 못했습니다.");
        }
        try {
            const image = nativeImage.createFromPath(assetPath);
            if (image.isEmpty()) {
                return invalidInput("배경 이미지를 디코딩할 수 없습니다.");
            }
            // 라이브 미리보기 iframe에 매번 실릴 payload라서 1080px 폭 JPEG로 줄인다.
            const { width } = image.getSize();
            const resized = width > 1080 ? image.resize({ width: 1080 }) : image;
            return `data:image/jpeg;base64,${resized.toJPEG(82).toString("base64")}`;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`배경 이미지를 읽지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:getImagePreview", async (_event, imageId) => {
        if (typeof imageId !== "string" || imageId.length === 0) {
            return invalidInput("이미지 id가 올바르지 않습니다.");
        }
        const found = await findLibraryImage(storageRoot(), imageId);
        const assetPath = found?.absolutePath;
        if (!assetPath) {
            return invalidInput("라이브러리에서 이미지를 찾지 못했습니다.");
        }
        try {
            const image = nativeImage.createFromPath(assetPath);
            if (image.isEmpty()) {
                return invalidInput("이미지를 디코딩할 수 없습니다.");
            }
            const { width } = image.getSize();
            const resized = width > 512 ? image.resize({ width: 512 }) : image;
            return `data:image/jpeg;base64,${resized.toJPEG(82).toString("base64")}`;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`이미지를 읽지 못했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:removeImageBackground", async (_event, imageId, tolerance) => {
        if (typeof imageId !== "string" || imageId.length === 0) {
            return invalidInput("이미지 id가 올바르지 않습니다.");
        }
        if (typeof tolerance !== "number") {
            return invalidInput("배경 제거 허용치는 숫자여야 합니다.");
        }
        const found = await findLibraryImage(storageRoot(), imageId);
        const assetPath = found?.absolutePath;
        if (!assetPath) {
            return invalidInput("라이브러리에서 이미지를 찾지 못했습니다.");
        }
        try {
            const image = nativeImage.createFromPath(assetPath);
            if (image.isEmpty()) {
                return invalidInput("이미지를 디코딩할 수 없습니다.");
            }
            const { width, height } = image.getSize();
            const bitmap = image.toBitmap();
            const clampedTolerance = Math.min(96, Math.max(1, tolerance));
            const processed = removeBackground(Uint8Array.from(bitmap), width, height, clampedTolerance);
            const processedImage = nativeImage.createFromBitmap(Buffer.from(processed), { width, height });
            if (processedImage.isEmpty()) {
                return invalidInput("배경 제거 결과 이미지를 생성하지 못했습니다.");
            }
            const sourceName = found.entry.displayName.replace(/\.[^.]+$/, "");
            return saveImageBufferToLibrary(storageRoot(), processedImage.toPNG(), `${sourceName}-no-bg-t${clampedTolerance}.png`, found.entry.attribution === smokeFixtureImageAttribution ? smokeFixtureImageAttribution : undefined);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 파일 오류";
            return invalidInput(`배경 제거에 실패했습니다: ${message}`);
        }
    });
    ipcMain.handle("cardnews:openOutputFolder", async (_event, jobId) => {
        if (!isRenderJobId(jobId)) {
            return invalidInput("렌더 작업 id가 올바르지 않습니다.");
        }
        const error = await shell.openPath(getRenderOutputDirectory(storageRoot(), jobId));
        return error.length > 0 ? invalidInput(error) : undefined;
    });
    ipcMain.handle("cardnews:openExternalLink", async (_event, url) => {
        if (typeof url !== "string" || !isAllowedExternalUrl(url)) {
            return invalidInput("허용되지 않은 외부 링크입니다.");
        }
        await shell.openExternal(url);
        return undefined;
    });
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
