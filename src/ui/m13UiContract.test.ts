import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.join(process.cwd(), "src/ui/App.tsx"), "utf8");
const guideSource = fs.readFileSync(path.join(process.cwd(), "docs/gpts-template-pack-builder-guide.html"), "utf8");

describe("M13 UI contract", () => {
  it("keeps next-hint and typography controls in separate visible groups", () => {
    const nextHintStart = appSource.indexOf('data-smoke-role="next-hint-controls"');
    const typographyStart = appSource.indexOf('data-smoke-role="typography-controls"');
    expect(nextHintStart).toBeGreaterThan(0);
    expect(typographyStart).toBeGreaterThan(nextHintStart);

    const nextHintBlock = appSource.slice(nextHintStart, typographyStart);
    expect(nextHintBlock).toContain("넘김 기호");
    expect(nextHintBlock).toContain('data-smoke-role="next-hint-kind"');
    expect(nextHintBlock).toContain('data-smoke-role="next-hint-height"');
    expect(nextHintBlock).not.toContain("텍스트 크기");
    expect(nextHintBlock).not.toContain("굵기");

    const typographyEnd = appSource.indexOf("<span>밝기</span>", typographyStart);
    expect(typographyEnd).toBeGreaterThan(typographyStart);
    const typographyBlock = appSource.slice(typographyStart, typographyEnd);
    expect(typographyBlock).toContain("타이포그래피");
    expect(typographyBlock).toContain('data-smoke-role="typography-color-control"');
    expect(typographyBlock).toContain("글자색");
    expect(typographyBlock).toContain("텍스트 크기");
    expect(typographyBlock).toContain("굵기");
    expect(typographyBlock).toContain("타이포 적용 범위");
  });

  it("exposes the M15 floating toolbar and image library management affordances", () => {
    expect(appSource).toContain('data-smoke-role="floating-editor-toolbar"');
    expect(appSource).toContain('data-toolbar-target="text-layer"');
    expect(appSource).toContain('data-toolbar-target="card-typography"');
    expect(appSource).toContain("이미지 관리");
    expect(appSource).toContain('data-smoke-role="image-picker-search"');
    expect(appSource).toContain('data-smoke-action="image-picker-delete"');
  });

  it("exposes searchable background management with safe delete and apply actions", () => {
    expect(appSource).toContain('data-smoke-action="background-manager-open"');
    expect(appSource).toContain('data-smoke-role="background-manager-modal"');
    expect(appSource).toContain('data-smoke-role="background-manager-search"');
    expect(appSource).toContain('data-smoke-action="background-manager-delete"');
    expect(appSource).toContain('data-smoke-action="background-manager-apply"');
    expect(appSource).toContain("사용 중인 배경은 전역/카드/레이어에서 먼저 해제해야 합니다.");
  });

  it("uses scoped action grids for template management and layer buttons", () => {
    const templateStart = appSource.indexOf("양식 관리");
    const templateEnd = appSource.indexOf("포인트 색상", templateStart);
    expect(templateStart).toBeGreaterThan(0);
    expect(templateEnd).toBeGreaterThan(templateStart);
    const templateBlock = appSource.slice(templateStart, templateEnd);
    expect(templateBlock).toContain("inspector-action-grid");
    expect(templateBlock).not.toContain('className="row"');

    const layerStart = appSource.indexOf('data-smoke-role="layer-controls"');
    const layerEnd = appSource.indexOf("{selectedLayer ?", layerStart);
    expect(layerStart).toBeGreaterThan(0);
    expect(layerEnd).toBeGreaterThan(layerStart);
    const layerBlock = appSource.slice(layerStart, layerEnd);
    expect(layerBlock).toContain("inspector-action-grid four");
    expect(layerBlock).not.toContain('className="row"');
  });

  it("shows separate template and style management affordances", () => {
    expect(appSource).toContain("양식 관리");
    expect(appSource).toContain("템플릿팩 ZIP 불러오기");
    expect(appSource).toContain("스타일 관리");
    expect(appSource).toContain('data-smoke-role="gpts-shortcut"');
    expect(appSource).toContain("GPTs 열기");
  });

  it("ships the required GPTs builder guide sections", () => {
    for (const required of [
      "Purpose",
      "Inputs",
      "Reference analysis checklist",
      "Text removal background instructions",
      "Template-pack JSON schema",
      "Style JSON schema",
      "Asset naming rules",
      "Quality rules",
      "Safety/copyright caution",
      "Example GPTs instructions",
      "Example package",
      "Lite/Pro import steps"
    ]) {
      expect(guideSource).toContain(required);
    }
    expect(guideSource).toContain("editable text");
    expect(guideSource).toContain("kkongdon.cardnews.template-pack.v1");
  });
});
