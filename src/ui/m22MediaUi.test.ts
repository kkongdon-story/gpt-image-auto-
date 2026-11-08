import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Card, MediaAssetRef } from "../domain/types.js";
import {
  assignBackgroundMediaAsset,
  bodyNumberModeLabel,
  buildSceneAudioCandidates,
  buildSemanticSlotDrafts,
  buildVideoExportSummary,
  createVideoLayerFromAsset,
  rectToSemanticSlotPlacement,
  roundM22Percent,
  semanticSlotPlacementToRect,
  setBackgroundMediaMode,
  updateSemanticSlotPlacement,
  updateSemanticSlotText
} from "./m22MediaUi.js";

const appSource = fs.readFileSync(path.join(process.cwd(), "src/ui/App.tsx"), "utf8");

const imageAsset: MediaAssetRef = {
  id: "image-asset",
  kind: "image",
  displayName: "cover.png",
  relativePath: "media/image-asset/cover.png",
  mimeType: "image/png",
  bytes: 100,
  sha256: "a",
  width: 1080,
  height: 1920
};

const videoAsset: MediaAssetRef = {
  id: "video-asset",
  kind: "video",
  displayName: "clip.mp4",
  relativePath: "media/video-asset/clip.mp4",
  mimeType: "video/mp4",
  bytes: 200,
  sha256: "b",
  width: 1080,
  height: 1920,
  durationMs: 3000,
  hasAudio: true
};

const card: Card = {
  index: 1,
  type: "body",
  title: "제목",
  subtitle: "소제목",
  badge: "배지",
  paragraphs: ["문단"],
  bullets: ["불릿"]
};

describe("M22 UI media helpers", () => {
  it("keeps background media segmented state explicit", () => {
    expect(setBackgroundMediaMode(undefined, "inherit")).toEqual({ mode: "inherit" });
    expect(setBackgroundMediaMode(undefined, "none")).toEqual({ mode: "none" });
    expect(setBackgroundMediaMode(undefined, "asset", "video-asset")).toEqual({
      mode: "asset",
      mediaId: "video-asset"
    });
    expect(assignBackgroundMediaAsset(" image-asset ")).toEqual({ mode: "asset", mediaId: "image-asset" });
  });

  it("creates video layers and primary-audio candidates from audio-bearing sources", () => {
    const layer = createVideoLayerFromAsset(videoAsset, "layer-video");
    expect(layer).toMatchObject({ kind: "video", mediaId: "video-asset", volume: 1 });
    expect(
      buildSceneAudioCandidates(1, { mode: "asset", mediaId: "video-asset" }, [layer], [imageAsset, videoAsset])
    ).toEqual([
      { sourceId: "background:1", label: "배경 영상 · clip.mp4", mediaId: "video-asset" },
      { sourceId: "layer:layer-video", label: "영상 레이어 · clip.mp4", mediaId: "video-asset" }
    ]);
  });

  it("builds semantic slot drafts without changing standard content fields", () => {
    const drafts = buildSemanticSlotDrafts(card, "kkongdon_story", undefined);
    expect(drafts.map((draft) => draft.kind)).toEqual([
      "title",
      "subtitle",
      "badge-text",
      "footer",
      "paragraph",
      "bullet"
    ]);
    expect(drafts.find((draft) => draft.kind === "paragraph")?.text).toBe("문단");
    expect(drafts.find((draft) => draft.kind === "bullet")?.text).toBe("불릿");
    expect(drafts.every((draft) => draft.placement.mode === "flow")).toBe(true);
    expect(drafts.find((draft) => draft.kind === "footer")?.placement.anchor).toBe("top-right");
  });

  it("updates semantic slot text and placement for direct overlay editing", () => {
    expect(updateSemanticSlotText(card, "old_footer", "footer", "new_footer")).toEqual({
      footerAccount: "new_footer"
    });
    expect(updateSemanticSlotText(card, "footer", "body", "첫 문단\n- 첫 불릿").card).toMatchObject({
      paragraphs: ["첫 문단"],
      bullets: ["첫 불릿"]
    });

    const override = updateSemanticSlotPlacement(
      {},
      "title",
      rectToSemanticSlotPlacement({ x: 12.345, y: 22.345, width: 44.444, height: 12.222 }, "top-center")
    );
    const titlePlacement = override.semanticSlots?.title;
    expect(titlePlacement).toMatchObject({ anchor: "top-center", width: 44.444, height: 12.222 });
    const rect = titlePlacement ? semanticSlotPlacementToRect(titlePlacement) : undefined;
    expect(rect?.x).toBeCloseTo(12.345);
    expect(rect?.y).toBeCloseTo(22.345);
    expect(rect?.width).toBeCloseTo(44.444);
    expect(rect?.height).toBeCloseTo(12.222);
  });

  it.each(["99", "A", "첫 번째", ""])(
    "persists %j as a custom body-number override instead of restoring the automatic number",
    (text) => {
      const placement = {
        mode: "card" as const,
        x: 12,
        y: 18,
        width: 20,
        height: 10,
        anchor: "top-left" as const
      };
      const result = updateSemanticSlotText(
        card,
        "kkongdon_story",
        "card-1:body-number",
        text,
        {
          bodyNumberMode: "inherit",
          semanticItemPlacements: {
            "card-1:body-number": placement
          }
        }
      );

      expect(result).toMatchObject({
        override: {
          bodyNumberMode: "show",
          bodyNumberText: text,
          semanticItemPlacements: {
            "card-1:body-number": placement
          }
        }
      });
    }
  );

  it("rounds percent geometry deterministically for persisted semantic slots", () => {
    expect(roundM22Percent(12.34567)).toBe(12.346);
    expect(roundM22Percent(-1)).toBe(0);
    expect(roundM22Percent(101)).toBe(100);
    expect(rectToSemanticSlotPlacement({ x: 10.11119, y: 20.22229, width: 30.33339, height: 40.44449 })).toMatchObject({
      x: 10.111,
      y: 20.222,
      width: 30.333,
      height: 40.444
    });
  });

  it("summarizes MP4 export from the compiled timeline contract", () => {
    const summary = buildVideoExportSummary({
      cards: [card],
      mediaAssets: [videoAsset],
      backgroundMedia: { mode: "asset", mediaId: "video-asset" }
    });
    expect(summary).toMatchObject({ durationMs: 3000, frameCount: 90, warningCount: 0 });
    expect(summary.label).toContain("1080x1920");
    expect(bodyNumberModeLabel("hide", "inherit")).toBe("전역 따름: 숨김");
  });

  it("wires M22 media UI to the actual cardnews catalog and MP4 API names", () => {
    expect(appSource).toContain("listMediaCatalog");
    expect(appSource).toContain("exportVideoMp4({ workspace: buildWorkspaceState() })");
    expect(appSource).toContain("cancelVideoExport(activeVideoExportJobId)");
    expect(appSource).toContain("onVideoExportProgress");
    expect(appSource).not.toContain("listMediaAssets?:");
    expect(appSource).not.toContain("exportVideoDeck");
  });

  it("synchronizes semantic placements when every left-rail thumbnail iframe loads", () => {
    const thumbnailTitle = 'title={`card-${index + 1}`}';
    const thumbnailStart = appSource.indexOf(thumbnailTitle);
    expect(thumbnailStart).toBeGreaterThan(-1);

    const thumbnailIframe = appSource.slice(thumbnailStart, thumbnailStart + 1_500);
    expect(thumbnailIframe).toContain("onLoad");
    expect(thumbnailIframe).toContain("prepareSemanticItemPlacements");
  });

  it("routes body-number deletion and toolbar actions through persisted overrides", () => {
    expect(appSource).toContain("onDeleteSemanticSlot(selectedSemanticSlot.id)");
    expect(appSource).toContain("deleteBodyNumber(currentOverride)");
    expect(appSource).toContain('data-toolbar-target="body-number"');
    expect(appSource).toContain('data-smoke-action="delete-body-number"');
    expect(appSource).toContain('data-smoke-action="reset-body-number-automatic"');
    expect(appSource).toContain('data-smoke-action="duplicate-body-number"');
  });

  it("commits the final IME composition value for layer and semantic text editors", () => {
    expect(appSource).toContain("onEditingTextChange(event.currentTarget.value)");
    expect(appSource).toContain("onEditingSemanticTextChange(event.currentTarget.value)");
    expect(appSource).toContain("onInput={(event) => onEditingTextChange(event.currentTarget.value)}");
    expect(appSource).toContain("onInput={(event) => onEditingSemanticTextChange(event.currentTarget.value)}");
  });

  it("exposes MP4 export and Pro-only AI default instruction controls", () => {
    expect(appSource).toContain('data-smoke-role="mp4-export-panel"');
    expect(appSource).toContain('data-smoke-action="export-mp4-choice"');
    expect(appSource).toContain('data-smoke-action="cancel-video-export"');
    expect(appSource).toContain('data-smoke-role="mp4-export-progress"');
    expect(appSource).toContain('data-smoke-role="ai-default-instruction-editor"');
    expect(appSource).toContain('data-smoke-action="save-ai-default-instruction"');
    expect(appSource).toContain('data-smoke-action="reset-ai-default-instruction"');

    const aiProBlock = appSource.slice(appSource.indexOf("{hasProTools ? ("), appSource.indexOf('data-smoke-role="ai-thread"'));
    expect(aiProBlock).toContain('data-smoke-role="ai-default-instruction-editor"');
  });
});
