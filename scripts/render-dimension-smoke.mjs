// Deterministic Electron harness for the shared PNG renderer.
// Bundle this entry with Vite SSR, then run the bundle with Electron. Example:
// npx vite build --ssr scripts/render-dimension-smoke.mjs --outDir .omc/evidence/v6/m20-dpi-safe-render-dimensions/harness --emptyOutDir
// node node_modules/electron/cli.js --force-device-scale-factor=1.5 .omc/evidence/v6/m20-dpi-safe-render-dimensions/harness/render-dimension-smoke.mjs --edition lite --ratio 4:5 --output-dir .omc/evidence/v6/m20-dpi-safe-render-dimensions/tmp-lite-4x5-150 --result .omc/evidence/v6/m20-dpi-safe-render-dimensions/t01-baseline.meta.json
import { app, nativeImage, protocol } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findAspectRatio } from "../src/domain/aspectRatios.ts";
import { renderDeckOffscreen } from "../src/render-engine/offscreenRenderer.ts";

const args = parseArgs(process.argv.slice(2));

// Match the packaged app runtime: this prevents sandboxed Chromium helper startup
// failures from masking DPI/render-size regressions in Windows QA.
app.commandLine.appendSwitch("no-sandbox");
app.disableHardwareAcceleration();

if (args.help) {
  console.log([
    "Usage: render-dimension-smoke.mjs [options]",
    "  --edition <lite|pro>        Edition metadata for the run.",
    "  --ratio <4:5|1:1|9:16|16:9|4:3> Render ratio (default: 4:5).",
    "  --scale <number>            Expected launch scale metadata.",
    "  --fixture <name>            Content/readiness fixture (default: dark-no-photo).",
    "  --fault <name>              Inject missing-card or wrong-aspect HTML.",
    "  --output-dir <path>         Renderer output directory.",
    "  --result <path>             Structured result JSON path.",
    "  --help                      Show this help."
  ].join("\n"));
  process.exit(0);
}

const edition = args.edition ?? "lite";
const ratioId = args.ratio ?? "4:5";
const fixtureId = args.fixture ?? "dark-no-photo";
const ratio = findAspectRatio(ratioId);
const scale = parsePositiveNumber(
  args.scale ?? app.commandLine.getSwitchValue("force-device-scale-factor") ?? "1",
  "scale"
);
const outputDir = path.resolve(args.outputDir ?? path.join("output", "m20-render-dimension-smoke"));
const resultPath = path.resolve(args.result ?? path.join(outputDir, "render-dimension-result.json"));
const profilePath = path.join(outputDir, ".electron-profile");
const startedAt = new Date().toISOString();

validateEdition(edition);
validateRatioId(ratioId, ratio.id);
validateFixtureId(fixtureId);
app.setPath("userData", profilePath);
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const expectedFailure = expectedRenderFailure(args.fault, fixtureId);
  if (args.fault) {
    await installFaultFixture(args.fault, outputDir, ratio);
  }

  let exitCode = 1;
  let payload;
  try {
    const fixture = await buildFixture(fixtureId, ratio.id, outputDir);
    const result = await renderDeckOffscreen({
      appVersion: "2.0.0",
      backgroundImagePath: fixture.backgroundImagePath,
      deck: fixture.deck,
      edition,
      ...(fixture.fontCss ? { fontCss: fixture.fontCss } : {}),
      jobId: `m20-${edition}-${ratio.id.replace(":", "x")}-${String(scale).replace(".", "p")}`,
      outputDir
    });

    if (isCardnewsError(result)) {
      const actual = parseDimensions(result.message);
      const diagnostic = await readRenderError(outputDir);
      const failurePassed =
        expectedFailure !== undefined &&
        diagnostic?.code === expectedFailure.code &&
        (expectedFailure.internalErrorName === undefined ||
          diagnostic?.internalError?.name === expectedFailure.internalErrorName);
      payload = buildPayload({
        actual,
        code: typeof diagnostic?.code === "string" ? diagnostic.code : result.code,
        edition,
        expected: { width: ratio.width, height: ratio.height },
        fixture: fixtureId,
        ...(typeof diagnostic?.internalError?.name === "string"
          ? { internalErrorName: diagnostic.internalError.name }
          : {}),
        message: result.message,
        outputDir,
        ratio: ratio.id,
        result: failurePassed ? "pass" : "fail",
        scale,
        startedAt
      });
      exitCode = failurePassed ? 0 : 1;
    } else {
      const pngPath = path.join(outputDir, result.cards[0]?.fileName ?? "card-01.png");
      const actual = readPngDimensions(await fs.readFile(pngPath));
      const exact =
        expectedFailure === undefined &&
        actual.width === ratio.width &&
        actual.height === ratio.height;
      payload = buildPayload({
        actual,
        code: exact ? "ok" : "size_mismatch",
        edition,
        expected: { width: ratio.width, height: ratio.height },
        fixture: fixtureId,
        message: exact ? "Shared renderer produced the exact PNG dimensions." : "PNG dimensions differ from the ratio contract.",
        outputDir,
        pngPath,
        ratio: ratio.id,
        result: exact ? "pass" : "fail",
        scale,
        startedAt
      });
      exitCode = exact ? 0 : 1;
    }
  } catch (error) {
    payload = buildPayload({
      code: "harness_error",
      edition,
      expected: { width: ratio.width, height: ratio.height },
      fixture: fixtureId,
      message: error instanceof Error ? error.message : "Unknown harness error.",
      outputDir,
      ratio: ratio.id,
      result: "fail",
      scale,
      startedAt
    });
  }

  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload));
  app.exit(exitCode);
});

async function buildFixture(fixture, aspectRatio, targetDirectory) {
  const deck = buildFixtureDeck(aspectRatio, fixture);
  if (fixture === "dark-photo") {
    return {
      backgroundImagePath: await writeFixtureBackground(targetDirectory),
      deck
    };
  }
  if (fixture === "bundled-korean-font") {
    return {
      backgroundImagePath: undefined,
      deck,
      fontCss: await buildEmbeddedFontCss(
        path.resolve("fonts", "PretendardVariable.woff2"),
        "Pretendard",
        "woff2-variations"
      )
    };
  }
  if (fixture === "user-ttf") {
    return {
      backgroundImagePath: undefined,
      deck,
      fontCss: await buildEmbeddedFontCss(await findWindowsTtf(), "Cardnews User Font", "truetype")
    };
  }
  if (fixture === "missing-image") {
    return {
      backgroundImagePath: path.join(targetDirectory, "missing-background.png"),
      deck
    };
  }
  if (fixture === "missing-font") {
    const missingFontUrl = pathToFileURL(path.join(targetDirectory, "missing-user-font.ttf")).toString();
    return {
      backgroundImagePath: undefined,
      deck,
      fontCss: `@font-face { font-family: "Cardnews User Font"; src: url("${missingFontUrl}") format("truetype"); font-display: block; }`
    };
  }
  return { backgroundImagePath: undefined, deck };
}

function buildFixtureDeck(aspectRatio, fixture) {
  const chromeFixture = fixture === "chrome-elements";
  const userFontFixture = fixture === "user-ttf" || fixture === "missing-font";
  const cards = [
    {
      index: 1,
      type: "cover",
      badge: chromeFixture ? "CHECK" : "M20",
      title: "DPI 렌더 크기 검증",
      subtitle: "같은 카드가 모든 Windows 배율에서 같은 PNG 크기로 생성되어야 합니다.",
      paragraphs: [],
      bullets: []
    }
  ];
  if (chromeFixture) {
    cards.push({
      index: 2,
      type: "body",
      badge: "02",
      title: "크롬 요소 확인",
      subtitle: "배지, 페이지 번호, 푸터와 넘김 기호를 함께 검증합니다.",
      paragraphs: ["두 번째 카드도 같은 프레임 계약을 사용합니다."],
      bullets: ["헤더와 페이지 번호", "푸터와 넘김 기호"]
    });
  }
  const deck = {
    id: "m20-dpi-smoke",
    headerLabel: "CARDNEWS",
    footerAccount: "kkongdon_story",
    styleId: fixture === "light-no-photo" ? "minimal" : fixture === "dark-photo" ? "newsprint" : "darkinfo",
    aspectRatio,
    cards,
    ...(userFontFixture ? { fontId: "m20-user-font" } : {}),
    ...(chromeFixture ? { nextHint: { kind: "arrows", height: 46 } } : {})
  };

  const titleMatch = /^m21-title-(0|50|100)$/.exec(fixture);
  if (titleMatch) {
    return {
      ...deck,
      accentColor: "#12abef",
      overrides: {
        "1": {
          layout: {
            align: "left",
            offsetY: 0,
            gapBadge: 1,
            gapSubtitle: 1,
            titlePlacement: { mode: "card-y", y: Number(titleMatch[1]) }
          }
        }
      }
    };
  }

  const footerOffsets = {
    "m21-footer-negative": [-32, -24],
    "m21-footer-zero": [0, 0],
    "m21-footer-positive": [32, 24]
  }[fixture];
  if (footerOffsets) {
    return {
      ...deck,
      accentColor: "#12abef",
      chrome: {
        header: { visible: true, color: "#ffffff", fontSize: 30, fontWeight: 800, offsetX: 0, offsetY: 0, useDeckFont: true },
        footer: { visible: true, color: "#ffffff", fontSize: 30, fontWeight: 800, offsetX: footerOffsets[0], offsetY: footerOffsets[1], useDeckFont: true },
        pageNumber: { visible: true, color: "#ffffff", fontSize: 30, fontWeight: 700, offsetX: 0, offsetY: 0, useDeckFont: true, template: "{n} / {total}" }
      }
    };
  }

  const customMatch = /^m21-custom-(transparent|filled)-(0|50|100)$/.exec(fixture);
  if (customMatch) {
    return {
      ...deck,
      accentColor: "#12abef",
      overrides: {
        "1": {
          layers: [
            {
              id: "m21-text",
              kind: "text",
              x: 10,
              y: 20,
              width: 50,
              height: 12,
              text: "M21 geometry",
              color: "#ffffff",
              backgroundColor: customMatch[1] === "transparent" ? "transparent" : "#123456",
              textOpacity: Number(customMatch[2])
            }
          ]
        }
      }
    };
  }

  return deck;
}

async function writeFixtureBackground(targetDirectory) {
  const width = 96;
  const height = 96;
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      bitmap[offset] = Math.round((x / (width - 1)) * 180) + 30;
      bitmap[offset + 1] = Math.round((y / (height - 1)) * 140) + 40;
      bitmap[offset + 2] = x < width / 2 ? 48 : 188;
      bitmap[offset + 3] = 255;
    }
  }
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
  if (image.isEmpty()) {
    throw new Error("Unable to create the deterministic photo fixture.");
  }
  const fixturePath = path.join(targetDirectory, "fixture-background.png");
  await fs.writeFile(fixturePath, image.toPNG());
  return fixturePath;
}

async function buildEmbeddedFontCss(fontPath, family, format) {
  const extension = path.extname(fontPath).slice(1).toLowerCase();
  const bytes = await fs.readFile(fontPath);
  return `@font-face { font-family: "${family}"; src: url("data:font/${extension};base64,${bytes.toString("base64")}") format("${format}"); font-weight: 100 900; font-style: normal; font-display: block; }`;
}

async function findWindowsTtf() {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  const candidates = ["malgun.ttf", "arial.ttf", "segoeui.ttf"].map((name) =>
    path.join(systemRoot, "Fonts", name)
  );
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next standard Windows font.
    }
  }
  throw new Error("No deterministic Windows TTF fixture is available.");
}

function buildPayload(input) {
  return {
    schemaVersion: 1,
    result: input.result,
    code: input.code,
    edition: input.edition,
    fixture: input.fixture,
    ratio: input.ratio,
    scale: input.scale,
    expected: input.expected,
    ...(input.actual ? { actual: input.actual } : {}),
    ...(input.internalErrorName ? { internalErrorName: input.internalErrorName } : {}),
    message: input.message,
    outputDir: displayPath(input.outputDir),
    ...(input.pngPath ? { pngPath: displayPath(input.pngPath) } : {}),
    startedAt: input.startedAt,
    completedAt: new Date().toISOString()
  };
}

function displayPath(absolutePath) {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative && !relative.startsWith("..") ? relative.replaceAll("\\", "/") : path.basename(absolutePath);
}

function isCardnewsError(result) {
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false;
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help") {
      parsed.help = true;
      continue;
    }
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = tokens[index + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function parseDimensions(message) {
  const match = message.match(/(\d+)x(\d+)/);
  if (!match) {
    return undefined;
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function installFaultFixture(fault, targetDirectory, targetRatio) {
  if (fault !== "missing-card" && fault !== "wrong-aspect") {
    throw new Error(`Unsupported fault: ${fault}`);
  }

  const fixturePath = path.join(targetDirectory, `fault-${fault}.html`);
  const cardMarkup = fault === "missing-card" ? "<main>missing card fixture</main>" : '<main class="card"></main>';
  const cardHeight = fault === "wrong-aspect" ? targetRatio.width : targetRatio.height;
  await fs.writeFile(
    fixturePath,
    [
      "<!doctype html>",
      "<html><head><meta charset=\"utf-8\"><style>",
      `html,body{margin:0;width:${targetRatio.width}px;height:${targetRatio.height}px;overflow:hidden;background:#111}`,
      `.card{width:${targetRatio.width}px;height:${cardHeight}px;background:#222}`,
      "</style></head><body>",
      cardMarkup,
      "</body></html>"
    ].join(""),
    "utf8"
  );

  protocol.interceptFileProtocol("file", (request, callback) => {
    try {
      const requestedPath = fileURLToPath(request.url);
      callback({ path: path.basename(requestedPath) === "card-01.html" ? fixturePath : requestedPath });
    } catch {
      callback({ error: -6 });
    }
  });
}

async function readRenderError(targetDirectory) {
  try {
    return JSON.parse(await fs.readFile(path.join(targetDirectory, "render-error.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function expectedRenderFailure(fault, fixture) {
  if (fault === "missing-card") {
    return { code: "RENDER_CARD_RECT_MISSING" };
  }
  if (fault === "wrong-aspect") {
    return { code: "RENDER_CARD_RECT_INVALID" };
  }
  if (fixture === "missing-image") {
    return { code: "RENDER_INTERNAL_ERROR", internalErrorName: "RenderImageReadinessError" };
  }
  if (fixture === "missing-font") {
    return { code: "RENDER_INTERNAL_ERROR", internalErrorName: "RenderFontReadinessError" };
  }
  return undefined;
}

function parsePositiveNumber(rawValue, label) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

function readPngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.byteLength < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("Renderer output is not a valid PNG file.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateEdition(value) {
  if (value !== "lite" && value !== "pro") {
    throw new Error(`Unsupported edition: ${value}`);
  }
}

function validateRatioId(requested, resolved) {
  if (requested !== resolved) {
    throw new Error(`Unsupported ratio: ${requested}`);
  }
}

function validateFixtureId(value) {
  const fixtures = new Set([
    "dark-no-photo",
    "dark-photo",
    "light-no-photo",
    "chrome-elements",
    "bundled-korean-font",
    "user-ttf",
    "missing-image",
    "missing-font",
    "m21-title-0",
    "m21-title-50",
    "m21-title-100",
    "m21-footer-negative",
    "m21-footer-zero",
    "m21-footer-positive",
    "m21-custom-transparent-0",
    "m21-custom-transparent-50",
    "m21-custom-transparent-100",
    "m21-custom-filled-50"
  ]);
  if (!fixtures.has(value)) {
    throw new Error(`Unsupported fixture: ${value}`);
  }
}
