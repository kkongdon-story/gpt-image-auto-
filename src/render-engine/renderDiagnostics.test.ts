import { describe, expect, it } from "vitest";
import {
  createRenderCaptureReport,
  createRenderDiagnostic,
  createRenderUserMessage,
  type RenderDiagnosticCode
} from "./renderDiagnostics.js";

describe("render diagnostics", () => {
  it("records only sanitized runtime and geometry facts", () => {
    const diagnostic = createRenderDiagnostic({
      appVersion: "2.0.0 C:\\private\\project",
      aspectRatioId: "4:5",
      capturedBitmap: { width: 1620, height: 2025 },
      code: "RENDER_CAPTURE_ASPECT_MISMATCH",
      edition: "lite",
      expected: { width: 1080, height: 1350 },
      cardIndex: 1,
      geometry: {
        cardExists: true,
        computedHeight: 1350,
        computedWidth: 1080,
        contentHeight: 1350,
        contentWidth: 1080,
        devicePixelRatio: 1.5,
        documentHeight: 1350,
        documentWidth: 1080,
        fontsReady: true,
        imagesReady: true,
        rect: { x: 0, y: 0, width: 1080, height: 1350 },
        zoomFactor: 1
      },
      normalization: {
        decision: "rejected",
        reason: "The captured bitmap dimensions do not imply one uniform scale factor. C:\\private\\secret.txt",
        scale: null
      },
      timestamp: "2026-07-13T15:00:00.000Z"
    });

    expect(diagnostic).toMatchObject({
      schemaVersion: 1,
      timestamp: "2026-07-13T15:00:00.000Z",
      code: "RENDER_CAPTURE_ASPECT_MISMATCH",
      edition: "lite",
      appVersion: "2.0.0_C__private_project",
      aspectRatio: { id: "4:5", expected: { width: 1080, height: 1350 } },
      cardIndex: 1,
      cardRect: { x: 0, y: 0, width: 1080, height: 1350 },
      capturedBitmap: { width: 1620, height: 2025 },
      finalBitmap: null,
      devicePixelRatio: 1.5,
      zoomFactor: 1,
      contentBounds: { width: 1080, height: 1350 },
      readiness: { fonts: true, images: true },
      normalization: { decision: "rejected", scale: null }
    });

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("C:\\private");
    expect(serialized).not.toContain("card body");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("apiKey");
  });

  it("records a sanitized success report including the normalization decision", () => {
    const report = createRenderCaptureReport({
      appVersion: "2.0.0",
      aspectRatioId: "4:5",
      capturedBitmap: { width: 1080, height: 1351 },
      cardIndex: 1,
      edition: "lite",
      expected: { width: 1080, height: 1350 },
      finalBitmap: { width: 1080, height: 1350 },
      geometry: {
        cardExists: true,
        computedHeight: 1350,
        computedWidth: 1080,
        contentHeight: 1351,
        contentWidth: 1080,
        devicePixelRatio: 1,
        documentHeight: 1351,
        documentWidth: 1080,
        fontsReady: true,
        imagesReady: true,
        rect: { x: 0, y: 0, width: 1080, height: 1351 },
        zoomFactor: 1
      },
      normalization: { decision: "resize", reason: null, scale: 1.0003703703703704 },
      timestamp: "2026-07-13T15:02:00.000Z"
    });

    expect(report).toMatchObject({
      status: "success",
      capturedBitmap: { width: 1080, height: 1351 },
      finalBitmap: { width: 1080, height: 1350 },
      normalization: { decision: "resize" }
    });
    expect(report).not.toHaveProperty("code");
  });

  it("replaces non-finite geometry bounds with null", () => {
    const diagnostic = createRenderDiagnostic({
      appVersion: "2.0.0",
      aspectRatioId: "4:5",
      code: "RENDER_CARD_RECT_INVALID",
      edition: "lite",
      expected: { width: 1080, height: 1350 },
      cardIndex: 1,
      geometry: {
        cardExists: true,
        computedHeight: 1350,
        computedWidth: 1080,
        contentHeight: Number.NaN,
        contentWidth: 1080,
        devicePixelRatio: Number.POSITIVE_INFINITY,
        documentHeight: 1350,
        documentWidth: 1080,
        fontsReady: false,
        imagesReady: false,
        rect: { x: 0, y: 0, width: Number.NaN, height: 1350 },
        zoomFactor: 1
      },
      normalization: { decision: "rejected", reason: "invalid geometry", scale: null }
    });

    expect(diagnostic.cardRect).toBeNull();
    expect(diagnostic.contentBounds).toBeNull();
    expect(diagnostic.devicePixelRatio).toBeNull();
  });

  it("uses null facts for failures before geometry or capture exists", () => {
    const diagnostic = createRenderDiagnostic({
      appVersion: "2.0.0",
      aspectRatioId: "1:1",
      code: "RENDER_CARD_RECT_MISSING",
      edition: "pro",
      expected: { width: 1080, height: 1080 },
      cardIndex: 3,
      normalization: { decision: "not_attempted", reason: null, scale: null },
      timestamp: "2026-07-13T15:01:00.000Z"
    });

    expect(diagnostic.cardRect).toBeNull();
    expect(diagnostic.capturedBitmap).toBeNull();
    expect(diagnostic.contentBounds).toBeNull();
    expect(diagnostic.readiness).toEqual({ fonts: null, images: null });
  });

  it("records only allowlisted unexpected-error metadata", () => {
    const privateCopy = "비공개 카드 본문: 우리 회사의 다음 분기 계획";
    const privatePrompt = "AI 프롬프트: 고객 이름과 전화번호를 정리해";
    const error = new Error(
      `${privateCopy} ${privatePrompt} C:\\Users\\js480\\private\\renderer.ts sk-testSecret1234567890`
    );
    error.stack = [
      `Error: ${privateCopy} ${privatePrompt}`,
      "    at renderCard (C:\\Users\\js480\\private\\renderer.ts:42:9)",
      "    at async renderDeckOffscreen (file:///C:/Users/js480/private/offscreenRenderer.ts:88:3)"
    ].join("\n");

    const diagnostic = createRenderDiagnostic({
      appVersion: "2.0.0",
      aspectRatioId: "4:5",
      cardIndex: 1,
      code: "RENDER_INTERNAL_ERROR",
      edition: "lite",
      expected: { width: 1080, height: 1350 },
      internalError: error,
      normalization: { decision: "not_attempted", reason: null, scale: null }
    });

    expect(diagnostic.internalError).toMatchObject({
      name: "Error",
      message: "Unexpected render error."
    });
    expect(diagnostic.internalError?.stack).toContain("renderCard");
    expect(diagnostic.internalError?.stack).toContain("renderDeckOffscreen");

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(privateCopy);
    expect(serialized).not.toContain(privatePrompt);
    expect(serialized).not.toContain("C:\\Users\\js480");
    expect(serialized).not.toContain("sk-testSecret1234567890");

    const userMessage = createRenderUserMessage({
      cardIndex: 1,
      code: "RENDER_INTERNAL_ERROR",
      expected: { width: 1080, height: 1350 }
    });
    expect(userMessage).not.toContain("renderCard");
    expect(userMessage).not.toContain(privateCopy);
    expect(userMessage).not.toContain(privatePrompt);
  });

  it("maps unknown exception names to Error and drops unparseable stack text", () => {
    const diagnostic = createRenderDiagnostic({
      appVersion: "2.0.0",
      aspectRatioId: "4:5",
      cardIndex: 1,
      code: "RENDER_INTERNAL_ERROR",
      edition: "lite",
      expected: { width: 1080, height: 1350 },
      internalError: {
        name: "비공개 오류 이름",
        message: "고객 이메일 customer@example.com",
        stack: "고객 이메일 customer@example.com"
      },
      normalization: { decision: "not_attempted", reason: null, scale: null }
    });

    expect(diagnostic.internalError).toEqual({
      name: "Error",
      message: "Unexpected render error.",
      stack: null
    });
    expect(JSON.stringify(diagnostic)).not.toContain("customer@example.com");
  });

  it.each<readonly [RenderDiagnosticCode, string]>([
    ["RENDER_CARD_RECT_MISSING", "렌더링 영역을 찾지 못했습니다"],
    ["RENDER_CARD_RECT_INVALID", "카드 크기를 맞추지 못했습니다"],
    ["RENDER_CAPTURE_ASPECT_MISMATCH", "카드 크기를 맞추지 못했습니다"],
    ["RENDER_CAPTURE_BLANK", "렌더링 결과가 비어 있습니다"],
    ["RENDER_FINAL_SIZE_MISMATCH", "카드 크기를 맞추지 못했습니다"],
    ["RENDER_INTERNAL_ERROR", "렌더링 중 오류가 발생했습니다"]
  ])("maps %s to concise Korean guidance", (code, expectedText) => {
    const message = createRenderUserMessage({
      actual: { width: 1620, height: 1394 },
      cardIndex: 1,
      code,
      expected: { width: 1080, height: 1350 }
    });

    expect(message).toContain(expectedText);
    expect(message).not.toContain("stack");
    expect(message).not.toContain("C:\\");
  });
});
