import assert from "node:assert/strict";
import test from "node:test";

import { inspectText } from "./verify-package-security.mjs";

test("accepts Lite dev hooks when every env read is production-gated", () => {
  const findings = [];

  inspectText({
    edition: "lite",
    findings,
    relative: "dist-electron/electron/lite-main.js",
    text: `
      const devServerUrl = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
      const smokeAction = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_ACTION"];
      const smokeScreenshotPath = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_SCREENSHOT"];
      const smokeTextPath = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_TEXT"];
      const smokeViewportWidth = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_VIEWPORT_WIDTH"];
      const smokeViewportHeight = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_VIEWPORT_HEIGHT"];
      const styleProfile = !app.isPackaged && process.env["CARDNEWS_MOCK_STYLE_EXTRACTION"] === "1"
        ? { palette: [] }
        : undefined;
      console.log(\`CARDNEWS_SMOKE_ACTION \${smokeAction ?? "none"} PASS\`);
    `
  });

  assert.deepEqual(findings, []);
});

test("accepts bundled Lite guards that compile undefined to void zero", () => {
  const findings = [];

  inspectText({
    edition: "lite",
    findings,
    relative: "dist-electron/electron/main.js",
    text: `
      var devServerUrl = app.isPackaged ? void 0 : process.env["VITE_DEV_SERVER_URL"];
      var smokeAction = app.isPackaged ? void 0 : process.env["CARDNEWS_SMOKE_ACTION"];
      var smokeScreenshotPath = app.isPackaged ? void 0 : process.env["CARDNEWS_SMOKE_SCREENSHOT"];
      var smokeTextPath = app.isPackaged ? void 0 : process.env["CARDNEWS_SMOKE_TEXT"];
    `
  });

  assert.deepEqual(findings, []);
});

test("fails Lite dev hooks when env reads are not production-gated", () => {
  const findings = [];

  inspectText({
    edition: "lite",
    findings,
    relative: "dist-electron/electron/lite-main.js",
    text: `
      const devServerUrl = process.env["VITE_DEV_SERVER_URL"];
      const smokeAction = process.env.CARDNEWS_SMOKE_ACTION;
    `
  });

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.hook]),
    [
      ["lite-unguarded-dev-hook", "CARDNEWS_SMOKE_ACTION"],
      ["lite-unguarded-dev-hook", "VITE_DEV_SERVER_URL"]
    ]
  );
});

test("rejects an env read preceded by an unrelated nearby packaged guard", () => {
  const findings = [];

  inspectText({
    edition: "lite",
    findings,
    relative: "dist-electron/electron/lite-main.js",
    text: `
      const marker = !app.isPackaged && true;
      const smokeAction = process.env["CARDNEWS_SMOKE_ACTION"];
    `
  });

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.hook]),
    [["lite-unguarded-dev-hook", "CARDNEWS_SMOKE_ACTION"]]
  );
});

test("requires every env read in a grouped expression to have its own direct guard", () => {
  const findings = [];

  inspectText({
    edition: "lite",
    findings,
    relative: "dist-electron/electron/lite-main.js",
    text: `
      const hasSmokeWindowSize = !app.isPackaged &&
        (process.env["CARDNEWS_SMOKE_VIEWPORT_WIDTH"] !== undefined ||
          process.env["CARDNEWS_SMOKE_VIEWPORT_HEIGHT"] !== undefined);
    `
  });

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.hook]),
    [["lite-unguarded-dev-hook", "CARDNEWS_SMOKE_VIEWPORT_HEIGHT"]]
  );
});

test("rejects a ternary decoy that does not directly guard the env read", () => {
  const findings = [];

  inspectText({
    edition: "lite",
    findings,
    relative: "dist-electron/electron/lite-main.js",
    text: `
      const smokeAction = (app.isPackaged ? undefined : true, process.env["CARDNEWS_SMOKE_ACTION"]);
    `
  });

  assert.deepEqual(
    findings.map((finding) => [finding.rule, finding.hook]),
    [["lite-unguarded-dev-hook", "CARDNEWS_SMOKE_ACTION"]]
  );
});

test("preserves strict Pro stripping checks for smoke and dev-server hooks", () => {
  const findings = [];

  inspectText({
    edition: "pro",
    findings,
    relative: "dist-electron/electron/main.js",
    text: `
      const devServerUrl = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
      const smokeAction = app.isPackaged ? undefined : process.env["CARDNEWS_SMOKE_ACTION"];
    `
  });

  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["pro-smoke-hook", "pro-dev-server-hook"]
  );
});
