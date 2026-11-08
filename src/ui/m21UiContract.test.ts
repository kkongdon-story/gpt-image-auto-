import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = fs.readFileSync(path.join(process.cwd(), "src/ui/App.tsx"), "utf8");
const styleSource = fs.readFileSync(path.join(process.cwd(), "src/ui/styles.css"), "utf8");

describe("M21 editor UI contract", () => {
  it("hides only the matching iframe text foreground during transparent inline editing", () => {
    expect(appSource).toContain('querySelectorAll<HTMLElement>("[data-layer-text]")');
    expect(appSource).toContain('foreground.style.visibility = "hidden"');
    expect(appSource).toContain('background: editingLayer.backgroundColor ?? "transparent"');
    expect(appSource).toContain("event.nativeEvent.isComposing || composingRef.current");
    expect(styleSource).toContain(".layer-inline-textarea");
    expect(styleSource).toContain("background: transparent");
  });

  it("exposes an accessible page context menu and restores thumbnail focus", () => {
    expect(appSource).toContain('event.shiftKey && event.key === "F10"');
    expect(appSource).toContain('event.key === "ContextMenu"');
    expect(appSource).toContain('role="menu"');
    expect(appSource).toContain('role="menuitem"');
    expect(appSource).toContain("thumbnailRefs.current[invokingIndex]?.focus()");
    expect(appSource).toContain("Math.max(8, Math.min(pageContextMenu.x");
    expect(appSource).toContain("이 작업은 되돌릴 수 없습니다.");
  });

  it("keeps bulk execution Pro-only while allowing editable key and display labels", () => {
    const bulkPanel = appSource.slice(appSource.indexOf('className="bulk-panel"'));
    expect(appSource).toContain("CSV 변수 키");
    expect(appSource).toContain("표시 이름");
    expect(appSource).toContain('aria-invalid={invalidKey || duplicateKey}');
    expect(bulkPanel).toContain("renderBulkBindingControl");
    expect(appSource).toContain("saveEditionBulkTemplate");
    expect(appSource).toContain("runEditionBulkRender");
    expect(appSource).toContain('renderEditionLock("bulk_csv"');
  });
});
