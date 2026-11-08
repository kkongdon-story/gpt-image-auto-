import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Card, Deck, MediaAssetRef } from "../domain/types.js";
import { buildCardHtml } from "../render-engine/cardTemplate.js";

const appSource = fs.readFileSync(path.join(process.cwd(), "src/ui/App.tsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(process.cwd(), "src/ui/styles.css"), "utf8");

const videoAsset: MediaAssetRef = {
  id: "video-preview",
  kind: "video",
  displayName: "preview.mp4",
  relativePath: "media/video-preview/preview.mp4",
  mimeType: "video/mp4",
  bytes: 1024,
  sha256: "video-preview-sha",
  width: 1080,
  height: 1920,
  durationMs: 5000,
  hasAudio: true
};

const card: Card = {
  index: 1,
  type: "cover",
  title: "영상 미리보기",
  paragraphs: [],
  bullets: []
};

function videoDeck(): Deck {
  return {
    id: "m24-video-preview",
    headerLabel: "CARDNEWS",
    footerAccount: "@kkongdon_story",
    cards: [card],
    mediaAssets: [videoAsset],
    backgroundMedia: { mode: "asset", mediaId: videoAsset.id }
  };
}

describe("M24 UI contract", () => {
  it("keeps one primary export action and the four inspector destinations", () => {
    expect(appSource).toContain('{isRendering || isVideoExporting ? "내보내는 중..." : "내보내기"}');
    expect(appSource).toContain('type InspectorTab = "design" | "content" | "media" | "export"');
    expect(appSource).toContain('id="export-dialog-title"');
    expect(appSource).toContain("현재 카드 PNG");
    expect(appSource).toContain("전체 ZIP");
    expect(appSource).toContain("MP4 영상");
    expect(appSource).not.toContain('isRendering ? "생성 중..." : "PNG 생성"');
  });

  it("separates importing a media asset from assigning its destination", () => {
    expect(appSource).toContain("importMediaForSelection");
    expect(appSource).toContain("setPendingMediaAsset(importedRef)");
    expect(appSource).toContain("적용 위치를 선택하세요.");
    expect(appSource).toContain('className="media-assignment-grid"');
    expect(appSource).toContain("보관함에만 추가");
  });

  it("shows a readable export stage, elapsed time, failure detail, and retry action", () => {
    expect(appSource).toContain('case "producer_init"');
    expect(appSource).toContain('return "영상 프레임 준비"');
    expect(appSource).toContain("formatElapsedMs(videoExportProgress.elapsedMs)");
    expect(appSource).toContain('data-smoke-role="mp4-export-error"');
    expect(appSource).toContain("오류 코드:");
    expect(appSource).toContain("다시 시도");
  });

  it("shows fixed Pro installer recipes instead of accepting shell text", () => {
    expect(appSource).toContain('data-smoke-role="ai-install-panel"');
    expect(appSource).toContain("selectedAiProvider.installRecipes.map");
    expect(appSource).toContain("installSelectedAiProvider(recipe.id)");
    expect(appSource).toContain("recipe.officialUrl");
  });

  it("renders a real video element only for the selected live preview card", () => {
    const liveHtml = buildCardHtml({
      assetCssUrls: { [videoAsset.id]: "cardnews-media://asset/video-preview" },
      backgroundCssUrl: "",
      card,
      deck: videoDeck(),
      liveVideo: true
    });
    const passiveHtml = buildCardHtml({
      assetCssUrls: { [videoAsset.id]: "cardnews-media://asset/video-preview" },
      backgroundCssUrl: "",
      card,
      deck: videoDeck(),
      liveVideo: false
    });

    expect(liveHtml).toContain('<video class="photo live-card-video"');
    expect(liveHtml).toContain('src="cardnews-media://asset/video-preview"');
    expect(liveHtml).toContain("autoplay muted playsinline");
    expect(passiveHtml).not.toContain('<video class="photo live-card-video"');
    expect(passiveHtml).toContain('class="photo video-poster"');
  });

  it("keeps editor overlays at the measured DOMRect height without a screen-space floor", () => {
    expect(stylesSource).not.toMatch(
      /\.edit-layer-box,\s*\.edit-semantic-box\s*\{[^}]*min-height/s
    );
  });
});
