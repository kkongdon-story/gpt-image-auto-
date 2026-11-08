import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVideoExportPlan,
  classifyVideoExportFailure,
  isMonotonicProgress,
  sanitizeVideoExportLog,
  videoExportDefaults
} from "./videoExport.js";

describe("buildVideoExportPlan", () => {
  it("creates a fixed 1080x1920 30fps MP4 plan with contained partial output", () => {
    const root = path.join("C:", "exports", "한글 폴더");
    const result = buildVideoExportPlan({
      outputRoot: root,
      outputPath: path.join(root, "카드 뉴스.mp4"),
      pathApi: path.win32
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        width: 1080,
        height: 1920,
        fps: 30,
        partialPath: expect.stringContaining(videoExportDefaults.partialSuffix)
      }
    });
  });

  it("rejects traversal, wrong extensions, and overwrite without explicit confirmation", () => {
    const root = "C:\\exports";

    expect(
      buildVideoExportPlan({
        outputRoot: root,
        outputPath: "C:\\outside\\bad.mp4",
        pathApi: path.win32
      })
    ).toMatchObject({ ok: false, code: "invalid_output_path" });

    expect(
      buildVideoExportPlan({
        outputRoot: root,
        outputPath: "C:\\exports\\bad.mov",
        pathApi: path.win32
      })
    ).toMatchObject({ ok: false, code: "invalid_output_path" });

    expect(
      buildVideoExportPlan({
        outputRoot: root,
        outputPath: "C:\\exports\\exists.mp4",
        outputExists: true,
        pathApi: path.win32
      })
    ).toMatchObject({ ok: false, code: "output_exists" });
  });
});

describe("video export progress and error helpers", () => {
  it("accepts monotonic 0-100 progress only", () => {
    expect(isMonotonicProgress(undefined, { stage: "compile", percent: 0 })).toBe(true);
    expect(isMonotonicProgress({ stage: "preflight", percent: 30 }, { stage: "render", percent: 30 })).toBe(true);
    expect(isMonotonicProgress({ stage: "preflight", percent: 30 }, { stage: "render", percent: 29 })).toBe(false);
    expect(isMonotonicProgress(undefined, { stage: "finalize", percent: 101 })).toBe(false);
  });

  it("redacts absolute paths and classifies common encoder failures", () => {
    expect(sanitizeVideoExportLog('C:\\Users\\me\\deck.mp4 prompt="secret text"')).not.toContain("Users\\me");
    expect(classifyVideoExportFailure("No space left on device")).toBe("disk_full");
    expect(classifyVideoExportFailure("Permission denied")).toBe("permission_denied");
    expect(classifyVideoExportFailure("Invalid data found when processing input")).toBe("corrupt_source");
  });
});
