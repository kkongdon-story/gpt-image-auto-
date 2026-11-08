import { extractAll } from "@electron/asar";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  if (process.argv.includes("--help")) {
    console.log([
      "Usage: node scripts/verify-package-security.mjs --lite-asar <path> --pro-asar <path> --lite-exe <path> --pro-exe <path> --lite-installer <path> --pro-installer <path> --output <path>",
      "",
      "Scans packaged payloads for QA hooks, secrets, local paths, and records SHA-256 hashes."
    ].join("\n"));
    process.exit(0);
  }

  const options = parseArgs(process.argv.slice(2));
  const artifacts = {
    liteAsar: path.resolve(requiredOption(options, "liteAsar")),
    liteExecutable: path.resolve(requiredOption(options, "liteExe")),
    liteInstaller: path.resolve(requiredOption(options, "liteInstaller")),
    proAsar: path.resolve(requiredOption(options, "proAsar")),
    proExecutable: path.resolve(requiredOption(options, "proExe")),
    proInstaller: path.resolve(requiredOption(options, "proInstaller"))
  };
  const outputPath = path.resolve(requiredOption(options, "output"));
  const startedAt = new Date().toISOString();
  const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cardnews-package-security-"));
  const findings = [];

  try {
    await Promise.all(Object.values(artifacts).map((artifactPath) => fs.access(artifactPath)));
    assertIdentity(artifacts.liteExecutable, "Cardnews Studio Lite.exe", "lite executable");
    assertIdentity(artifacts.proExecutable, "Cardnews Studio Pro.exe", "pro executable");
    assertIdentity(artifacts.liteInstaller, "Cardnews-Studio-Lite-Setup-2.0.0.exe", "lite installer");
    assertIdentity(artifacts.proInstaller, "Cardnews-Studio-Pro-Setup-2.0.0.exe", "pro installer");

    const extracted = {
      lite: path.join(extractionRoot, "lite"),
      pro: path.join(extractionRoot, "pro")
    };
    await extractAll(artifacts.liteAsar, extracted.lite);
    await extractAll(artifacts.proAsar, extracted.pro);

    const packageStats = {};
    for (const edition of ["lite", "pro"]) {
      const files = await findFiles(extracted[edition]);
      packageStats[edition] = {
        files: files.length,
        projectFiles: files.filter((file) => isProjectPayload(relativePath(extracted[edition], file))).length
      };
      for (const file of files) {
        const relative = relativePath(extracted[edition], file);
        if (edition === "pro" && isProjectPayload(relative) && /(^|\/)([^/]*(smoke|fixture|mock)[^/]*)$/i.test(relative)) {
          findings.push({ edition, file: relative, rule: "pro-qa-file" });
        }
        if (!isTextFile(file)) {
          continue;
        }
        const text = await fs.readFile(file, "utf8");
        inspectText({ edition, findings, relative, text });
      }
    }

    const hashes = {};
    for (const [name, artifactPath] of Object.entries(artifacts)) {
      hashes[name] = {
        bytes: (await fs.stat(artifactPath)).size,
        path: artifactPath,
        sha256: await sha256(artifactPath)
      };
    }

    const result = {
      artifacts: hashes,
      completedAt: new Date().toISOString(),
      findings,
      packageStats,
      result: findings.length === 0 ? "pass" : "fail",
      schemaVersion: 1,
      startedAt
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    if (findings.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await fs.rm(extractionRoot, { recursive: true, force: true });
  }
}

export function inspectText({ edition, findings: output, relative, text }) {
  const sharedRules = [
    ["fixed-debug-port", /--remote-debugging-port(?:=|\b)/i],
    ["qa-driver", /verify-packaged-render|run-packaged-render-matrix/i],
    ["project-evidence-path", /\.om[ctx][\\/]evidence|M20-QA/i],
    ["local-project-path", /C:[\\/]Users[\\/]js480|OneDrive[\\/].*1_Projects/i],
    ["openai-secret", /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
    ["google-secret", /AIza[0-9A-Za-z_-]{30,}/],
    ["github-secret", /ghp_[0-9A-Za-z]{30,}/]
  ];
  for (const [rule, pattern] of sharedRules) {
    if (pattern.test(text)) {
      output.push({ edition, file: relative, rule });
    }
  }

  if (!isProjectPayload(relative)) {
    return;
  }

  if (edition === "lite") {
    inspectLiteHooks({ edition, output, relative, text });
    return;
  }

  if (edition !== "pro") {
    return;
  }

  const proRules = [
    ["pro-smoke-hook", /CARDNEWS_SMOKE|data-smoke-|smokeFixture/i],
    ["pro-mock-hook", /CARDNEWS_MOCK|cliMock|buildMockDraftDocument/i],
    ["pro-dev-server-hook", /VITE_DEV_SERVER_URL/i]
  ];
  for (const [rule, pattern] of proRules) {
    if (pattern.test(text)) {
      output.push({ edition, file: relative, rule });
    }
  }
}

function inspectLiteHooks({ edition, output, relative, text }) {
  const liteDevHookNames = [
    "CARDNEWS_MOCK_STYLE_EXTRACTION",
    "CARDNEWS_SMOKE_ACTION",
    "CARDNEWS_SMOKE_SCREENSHOT",
    "CARDNEWS_SMOKE_TEXT",
    "CARDNEWS_SMOKE_VIEWPORT_HEIGHT",
    "CARDNEWS_SMOKE_VIEWPORT_WIDTH",
    "VITE_DEV_SERVER_URL"
  ];

  for (const hookName of liteDevHookNames) {
    const hookPattern = new RegExp(
      `process\\.env(?:\\[\\s*["']${escapeRegExp(hookName)}["']\\s*\\]|\\.${escapeRegExp(hookName)}\\b)`,
      "g"
    );
    for (const match of text.matchAll(hookPattern)) {
      if (!isLiteHookPackagedGuarded(text, match.index ?? 0)) {
        output.push({ edition, file: relative, hook: hookName, rule: "lite-unguarded-dev-hook" });
      }
    }
  }
}

function isLiteHookPackagedGuarded(text, matchIndex) {
  const prefix = text.slice(Math.max(0, matchIndex - 96), matchIndex);
  return (
    /app\.isPackaged\s*\?\s*(?:undefined|void\s+0)\s*:\s*$/.test(prefix) ||
    /!\s*app\.isPackaged\s*&&\s*(?:\(\s*)?$/.test(prefix)
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findFiles(directory) {
  const found = [];
  const queue = [directory];
  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.isFile()) {
        found.push(absolute);
      }
    }
  }
  return found;
}

function isProjectPayload(relative) {
  return relative === "package.json" || relative.startsWith("dist/") || relative.startsWith("dist-electron/");
}

function isTextFile(file) {
  return new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".txt"]).has(
    path.extname(file).toLowerCase()
  );
}

function relativePath(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function assertIdentity(file, expectedName, label) {
  if (path.basename(file) !== expectedName) {
    throw new Error(`Unexpected ${label} identity: ${path.basename(file)}`);
  }
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2).replaceAll(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const value = tokens[index + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function requiredOption(parsed, key) {
  const value = parsed[key];
  if (!value) {
    throw new Error(`Missing required option: --${key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return value;
}
