import type { CaptureSize, CardGeometryProbe, CaptureRect } from "./captureGeometry.js";

export type RenderDiagnosticCode =
  | "RENDER_CARD_RECT_MISSING"
  | "RENDER_CARD_RECT_INVALID"
  | "RENDER_CAPTURE_ASPECT_MISMATCH"
  | "RENDER_FINAL_SIZE_MISMATCH"
  | "RENDER_CAPTURE_BLANK"
  | "RENDER_INTERNAL_ERROR";

export type RenderNormalizationDiagnostic = {
  readonly decision: "not_attempted" | "exact" | "resize" | "rejected";
  readonly reason: string | null;
  readonly scale: number | null;
};

export type RenderInternalErrorDiagnostic = {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
};

export type RenderDiagnostic = {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly code: RenderDiagnosticCode;
  readonly edition: "lite" | "pro" | "unknown";
  readonly appVersion: string;
  readonly aspectRatio: {
    readonly id: string;
    readonly expected: CaptureSize;
  };
  readonly cardIndex: number;
  readonly cardRect: CaptureRect | null;
  readonly capturedBitmap: CaptureSize | null;
  readonly finalBitmap: CaptureSize | null;
  readonly devicePixelRatio: number | null;
  readonly zoomFactor: number | null;
  readonly contentBounds: CaptureSize | null;
  readonly documentBounds: CaptureSize | null;
  readonly readiness: {
    readonly fonts: boolean | null;
    readonly images: boolean | null;
  };
  readonly internalError: RenderInternalErrorDiagnostic | null;
  readonly normalization: RenderNormalizationDiagnostic;
};

export type CreateRenderDiagnosticInput = {
  readonly appVersion: string | undefined;
  readonly aspectRatioId: string;
  readonly capturedBitmap?: CaptureSize;
  readonly cardIndex: number;
  readonly code: RenderDiagnosticCode;
  readonly edition: "lite" | "pro" | undefined;
  readonly expected: CaptureSize;
  readonly finalBitmap?: CaptureSize;
  readonly geometry?: CardGeometryProbe;
  readonly internalError?: unknown;
  readonly normalization: RenderNormalizationDiagnostic;
  readonly timestamp?: string;
};

export type RenderCaptureReport = Omit<RenderDiagnostic, "code"> & {
  readonly status: "success";
};

export type CreateRenderCaptureReportInput = {
  readonly appVersion: string | undefined;
  readonly aspectRatioId: string;
  readonly capturedBitmap: CaptureSize;
  readonly cardIndex: number;
  readonly edition: "lite" | "pro" | undefined;
  readonly expected: CaptureSize;
  readonly finalBitmap: CaptureSize;
  readonly geometry: CardGeometryProbe;
  readonly normalization: RenderNormalizationDiagnostic;
  readonly timestamp?: string;
};

export function createRenderUserMessage(input: {
  readonly actual?: CaptureSize;
  readonly cardIndex: number;
  readonly code: RenderDiagnosticCode;
  readonly expected: CaptureSize;
}): string {
  if (input.code === "RENDER_CARD_RECT_MISSING") {
    return `카드 ${input.cardIndex} 렌더링 영역을 찾지 못했습니다. 앱을 다시 실행한 뒤 재시도해 주세요.`;
  }
  if (input.code === "RENDER_CAPTURE_BLANK") {
    return `카드 ${input.cardIndex} 렌더링 결과가 비어 있습니다. 앱을 다시 실행한 뒤 재시도해 주세요.`;
  }
  if (input.code === "RENDER_INTERNAL_ERROR") {
    return `카드 ${input.cardIndex} 렌더링 중 오류가 발생했습니다. 앱을 다시 실행한 뒤 재시도해 주세요. 계속되면 오류 진단 파일을 보내 주세요.`;
  }

  const actual = input.actual
    ? ` 실제 ${input.actual.width}x${input.actual.height}.`
    : "";
  return `PNG 렌더링 중 카드 크기를 맞추지 못했습니다. 예상 ${input.expected.width}x${input.expected.height}.${actual} 앱을 다시 실행한 뒤 재시도해 주세요. 계속되면 오류 진단 파일을 보내 주세요.`;
}

export function createRenderDiagnostic(input: CreateRenderDiagnosticInput): RenderDiagnostic {
  const geometry = input.geometry;
  return {
    schemaVersion: 1,
    timestamp: input.timestamp ?? new Date().toISOString(),
    code: input.code,
    edition: input.edition ?? "unknown",
    appVersion: sanitizeIdentifier(input.appVersion),
    aspectRatio: {
      id: sanitizeAspectRatioId(input.aspectRatioId),
      expected: copySize(input.expected)
    },
    cardIndex: input.cardIndex,
    cardRect: geometry ? finiteRectOrNull(geometry.rect) : null,
    capturedBitmap: input.capturedBitmap ? finiteSizeOrNull(input.capturedBitmap) : null,
    finalBitmap: input.finalBitmap ? finiteSizeOrNull(input.finalBitmap) : null,
    devicePixelRatio: geometry ? finiteOrNull(geometry.devicePixelRatio) : null,
    zoomFactor: geometry ? finiteOrNull(geometry.zoomFactor) : null,
    contentBounds: geometry
      ? finiteSizeOrNull({ width: geometry.contentWidth, height: geometry.contentHeight })
      : null,
    documentBounds: geometry
      ? finiteSizeOrNull({ width: geometry.documentWidth, height: geometry.documentHeight })
      : null,
    readiness: {
      fonts: geometry ? geometry.fontsReady : null,
      images: geometry ? geometry.imagesReady : null
    },
    internalError: sanitizeInternalError(input.internalError),
    normalization: {
      decision: input.normalization.decision,
      reason: sanitizeReason(input.normalization.reason),
      scale: finiteOrNull(input.normalization.scale)
    }
  };
}

export function createRenderCaptureReport(
  input: CreateRenderCaptureReportInput
): RenderCaptureReport {
  const facts = createRenderDiagnostic({
    appVersion: input.appVersion,
    aspectRatioId: input.aspectRatioId,
    capturedBitmap: input.capturedBitmap,
    cardIndex: input.cardIndex,
    code: "RENDER_FINAL_SIZE_MISMATCH",
    edition: input.edition,
    expected: input.expected,
    finalBitmap: input.finalBitmap,
    geometry: input.geometry,
    normalization: input.normalization,
    ...(input.timestamp ? { timestamp: input.timestamp } : {})
  });
  const { code: _code, ...report } = facts;
  return { ...report, status: "success" };
}

function sanitizeIdentifier(value: string | undefined): string {
  const sanitized = (value ?? "unknown").slice(0, 80).replace(/[^0-9A-Za-z._+-]/g, "_");
  return sanitized || "unknown";
}

function sanitizeAspectRatioId(value: string): string {
  const sanitized = value.slice(0, 16).replace(/[^0-9A-Za-z:_-]/g, "_");
  return sanitized || "unknown";
}

function finiteRectOrNull(rect: CaptureRect): CaptureRect | null {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : null;
}

function copySize(size: CaptureSize): CaptureSize {
  return { width: size.width, height: size.height };
}

function finiteSizeOrNull(size: CaptureSize): CaptureSize | null {
  return Number.isFinite(size.width) && Number.isFinite(size.height)
    ? copySize(size)
    : null;
}

function sanitizeReason(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return sanitizeDiagnosticText(value, 240)
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[path]")
    .replace(/file:\/\/\/[^\s"']+/gi, "[path]");
}

function sanitizeInternalError(value: unknown): RenderInternalErrorDiagnostic | null {
  if (value === undefined || value === null) {
    return null;
  }

  const record = typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const name =
    value instanceof Error
      ? value.name
      : typeof record?.["name"] === "string"
        ? record["name"]
        : "Error";
  const stack =
    value instanceof Error
      ? value.stack
      : typeof record?.["stack"] === "string"
        ? record["stack"]
        : undefined;

  return {
    name: sanitizeInternalErrorName(name),
    message: "Unexpected render error.",
    stack: stack ? sanitizeStackFrames(stack) : null
  };
}

function sanitizeInternalErrorName(value: string): string {
  const allowedNames = new Set([
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "RenderFontReadinessError",
    "RenderImageReadinessError",
    "SyntaxError",
    "TypeError",
    "URIError"
  ]);
  return allowedNames.has(value) ? value : "Error";
}

function sanitizeStackFrames(value: string): string | null {
  const frames = value
    .split(/\r?\n/)
    .flatMap((line) => {
      const frame = line.match(/^\s*at\s+(?:async\s+)?([A-Za-z_$][0-9A-Za-z_$.[\]<>]*)/);
      if (!frame?.[1]) {
        return [];
      }
      const location = line.match(/:(\d+):(\d+)\)?\s*$/);
      const suffix = location ? ` ([path]:${location[1]}:${location[2]})` : "";
      return [`at ${frame[1].slice(0, 120)}${suffix}`];
    })
    .slice(0, 12);
  return frames.length > 0 ? frames.join("\n") : null;
}

function sanitizeDiagnosticText(value: string, maxLength: number): string {
  return value
    .slice(0, maxLength)
    .replace(/file:\/\/\/[^\s"'<>]+/gi, "[path]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>|)]+/g, "[path]")
    .replace(/\\\\[^\\\s]+\\[^\s"'<>|)]+/g, "[path]")
    .replace(/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,})\b/g, "[secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [secret]");
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
