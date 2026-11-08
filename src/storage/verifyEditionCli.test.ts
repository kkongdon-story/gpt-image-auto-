import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("verify-edition explicit scan targets", () => {
  it("fails when an explicit scan target does not exist", () => {
    const missingPath = path.join(".tmp", "missing-lite-package", "resources", "app.asar");
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-edition.mjs", "--edition", "lite", "--scan", missingPath],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Scan target does not exist");
  });

  it("allows shared media and MP4 API symbols in Lite scan targets", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cardnews-edition-shared-"));
    try {
      const target = path.join(tempRoot, "shared.js");
      fs.writeFileSync(
        target,
        [
          "window.cardnews.importMediaAsset",
          "window.cardnews.listMediaCatalog",
          "window.cardnews.getMediaPreview",
          "window.cardnews.deleteMediaAsset",
          "window.cardnews.exportVideoMp4",
          "window.cardnews.cancelVideoExport",
          "window.cardnews.onVideoExportProgress"
        ].join("\n"),
        "utf8"
      );

      const result = spawnSync(
        process.execPath,
        ["scripts/verify-edition.mjs", "--edition", "lite", "--scan", target],
        { cwd: process.cwd(), encoding: "utf8" }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("verify-edition passed");
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("still rejects Pro AI, CLI, and bulk symbols in Lite scan targets", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cardnews-edition-pro-"));
    try {
      const target = path.join(tempRoot, "pro.js");
      fs.writeFileSync(target, "runAiChat\nrenderBulkCsv\ncardnews:ai:chat", "utf8");

      const result = spawnSync(
        process.execPath,
        ["scripts/verify-edition.mjs", "--edition", "lite", "--scan", target],
        { cwd: process.cwd(), encoding: "utf8" }
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("runAiChat");
      expect(`${result.stdout}\n${result.stderr}`).toContain("renderBulkCsv");
    } finally {
      fs.rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
