// noqa: SIZE_OK - v4 release keeps design.md schema, parsing, and examples together; split plan is documented in .omo/evidence/v4-upgrade/final/programming-size-exceptions.md.
import type { CardnewsError, CardnewsResult } from "../domain/types.js";
import { findStylePreset, stylePresets, type StylePreset } from "./stylePresets.js";

export type ParsedCustomStyle = {
  readonly preset: StylePreset;
  readonly warnings: readonly string[];
};

/** 색상 hex(#rrggbb)여야 하는 필드 — 대비 게이트가 계산 가능해야 한다 */
const hexFields = [
  "textBackdrop",
  "chromeBackdrop",
  "ink",
  "inkSub",
  "inkMuted",
  "accentDefault",
  "badgeInk"
] as const;

/** 임의 CSS 값(그라디언트/rgba 허용) 필드 */
const cssFields = ["pageBackground", "badgeBackground", "fontTitle", "fontBody"] as const;

const minimumContrastRatio = 4.5;

/**
 * 외부 AI가 만든 스타일 JSON을 검증해 커스텀 StylePreset으로 변환한다.
 * - 마크다운 코드펜스(```json …```)로 감싸인 출력도 허용
 * - id는 "custom-" 접두로 정규화하고 기존 id와 충돌하면 suffix를 붙인다
 * - ink↔textBackdrop 대비가 4.5:1 미만이면 경고(등록은 허용, 게이트가 최종 방어)
 */
export function parseStyleJson(
  rawText: string,
  existingIds: readonly string[]
): CardnewsResult<ParsedCustomStyle> {
  const jsonText = stripCodeFence(rawText.trim());
  if (jsonText.length === 0) {
    return invalidInput("스타일 JSON이 비어 있습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return invalidInput("JSON을 해석할 수 없습니다. design.md의 출력 형식을 확인하세요.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return invalidInput("스타일 JSON은 객체 하나여야 합니다.");
  }

  const record = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const name = typeof record["name"] === "string" ? record["name"].trim() : "";
  if (!name) {
    return invalidInput("name(스타일 이름)이 필요합니다.");
  }

  for (const field of hexFields) {
    const value = record[field];
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      return invalidInput(`${field}는 #rrggbb 형식의 색상이어야 합니다.`);
    }
  }

  for (const field of cssFields) {
    const value = record[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return invalidInput(`${field}가 비어 있습니다.`);
    }
  }

  if (typeof record["usesPhoto"] !== "boolean" || typeof record["usesSurface"] !== "boolean") {
    return invalidInput("usesPhoto / usesSurface는 true 또는 false여야 합니다.");
  }

  let defaultDim = typeof record["defaultDim"] === "number" ? record["defaultDim"] : NaN;
  if (Number.isNaN(defaultDim) || defaultDim < 0) {
    return invalidInput("defaultDim은 0~1 사이 숫자여야 합니다.");
  }
  if (defaultDim > 1) {
    warnings.push(`defaultDim ${defaultDim}을(를) ${(defaultDim / 100).toFixed(2)}로 해석했습니다.`);
    defaultDim = Math.min(1, defaultDim / 100);
  }

  const numberInk =
    typeof record["numberInk"] === "string" && record["numberInk"].trim().length > 0
      ? record["numberInk"]
      : undefined;
  const surfaceLadder = parseStringTuple3(record["surfaceLadder"]);
  const inkScale = parseInkScale(record["inkScale"]);
  const hairline = typeof record["hairline"] === "string" ? record["hairline"] : undefined;
  const eyebrowStyle =
    record["eyebrowStyle"] === "pill" ||
    record["eyebrowStyle"] === "bar" ||
    record["eyebrowStyle"] === "plain"
      ? record["eyebrowStyle"]
      : undefined;
  const titleTracking = typeof record["titleTracking"] === "number" ? record["titleTracking"] : undefined;
  const badgeRadius = typeof record["badgeRadius"] === "string" ? record["badgeRadius"] : undefined;
  const bulletShape =
    record["bulletShape"] === "dot" || record["bulletShape"] === "square" || record["bulletShape"] === "dash"
      ? record["bulletShape"]
      : undefined;
  const scrimStops = parseStringArray(record["scrimStops"]);

  const id = allocateStyleId(
    typeof record["id"] === "string" ? record["id"] : name,
    existingIds
  );

  const preset: StylePreset = {
    id,
    name,
    usesPhoto: record["usesPhoto"],
    pageBackground: record["pageBackground"] as string,
    textBackdrop: record["textBackdrop"] as string,
    chromeBackdrop: record["chromeBackdrop"] as string,
    ink: record["ink"] as string,
    inkSub: record["inkSub"] as string,
    inkMuted: record["inkMuted"] as string,
    accentDefault: record["accentDefault"] as string,
    badgeBackground: record["badgeBackground"] as string,
    badgeInk: record["badgeInk"] as string,
    fontTitle: record["fontTitle"] as string,
    fontBody: record["fontBody"] as string,
    usesSurface: record["usesSurface"],
    defaultDim,
    ...(numberInk ? { numberInk } : {}),
    ...(surfaceLadder ? { surfaceLadder } : {}),
    ...(inkScale ? { inkScale } : {}),
    ...(hairline ? { hairline } : {}),
    ...(eyebrowStyle ? { eyebrowStyle } : {}),
    ...(titleTracking !== undefined ? { titleTracking } : {}),
    ...(badgeRadius ? { badgeRadius } : {}),
    ...(bulletShape ? { bulletShape } : {}),
    ...(scrimStops ? { scrimStops } : {})
  };

  const inkContrast = contrastRatio(preset.ink, preset.textBackdrop);
  if (inkContrast < minimumContrastRatio) {
    warnings.push(
      `ink↔textBackdrop 대비가 ${inkContrast.toFixed(2)}:1로 낮습니다(권장 4.5:1). 렌더 시 품질 게이트에 걸릴 수 있습니다.`
    );
  }

  const subContrast = contrastRatio(preset.inkSub, preset.textBackdrop);
  if (subContrast < minimumContrastRatio) {
    warnings.push(
      `inkSub↔textBackdrop 대비가 ${subContrast.toFixed(2)}:1로 낮습니다(권장 4.5:1).`
    );
  }

  return { preset, warnings };
}

/** main 프로세스가 저장 전 재검증에 쓰는 형태 가드 */
export function isStylePresetShape(candidate: unknown): candidate is StylePreset {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  const stringFields = [
    "id",
    "name",
    "pageBackground",
    "textBackdrop",
    "chromeBackdrop",
    "ink",
    "inkSub",
    "inkMuted",
    "accentDefault",
    "badgeBackground",
    "badgeInk",
    "fontTitle",
    "fontBody"
  ];

  return (
    stringFields.every((field) => typeof record[field] === "string") &&
    typeof record["usesPhoto"] === "boolean" &&
    typeof record["usesSurface"] === "boolean" &&
    typeof record["defaultDim"] === "number" &&
    (record["numberInk"] === undefined || typeof record["numberInk"] === "string") &&
    (record["surfaceLadder"] === undefined || parseStringTuple3(record["surfaceLadder"]) !== undefined) &&
    (record["inkScale"] === undefined || parseInkScale(record["inkScale"]) !== undefined) &&
    (record["hairline"] === undefined || typeof record["hairline"] === "string") &&
    (record["eyebrowStyle"] === undefined ||
      record["eyebrowStyle"] === "pill" ||
      record["eyebrowStyle"] === "bar" ||
      record["eyebrowStyle"] === "plain") &&
    (record["titleTracking"] === undefined || typeof record["titleTracking"] === "number") &&
    (record["badgeRadius"] === undefined || typeof record["badgeRadius"] === "string") &&
    (record["bulletShape"] === undefined ||
      record["bulletShape"] === "dot" ||
      record["bulletShape"] === "square" ||
      record["bulletShape"] === "dash") &&
    (record["scrimStops"] === undefined || parseStringArray(record["scrimStops"]) !== undefined)
  );
}

/** 외부 AI(웹챗봇/바이브코더)에게 줄 스타일 계약 문서를 만든다. */
export function buildDesignContract(): string {
  const example1 = JSON.stringify(exampleFromPreset(findStylePreset("newsprint")), null, 2);
  const example2 = JSON.stringify(exampleFromPreset(findStylePreset("cinematic")), null, 2);
  const builtinIds = stylePresets.map((preset) => preset.id).join(", ");

  return `# design.md — 카드뉴스 스타일 계약 (Cardnews Studio)

당신은 카드뉴스 디자인 시스템 엔지니어입니다. 첨부한 카드뉴스 레퍼런스 이미지들을 분석하여,
아래 스키마에 맞는 **스타일 JSON 하나**를 만들어 주세요.

## 작업 방법

1. 레퍼런스 이미지들의 공통 시각 언어를 추출합니다 — 배경(단색/그라디언트/사진), 글자색 위계, 포인트 색, 배지 형태.
2. 아래 스키마의 모든 필수 필드를 채웁니다.
3. **JSON 하나만 코드블록에 출력**합니다. 설명 문장은 코드블록 밖에 짧게.

## 스키마 (필수 필드)

| 필드 | 형식 | 설명 |
|------|------|------|
| name | 문자열 | 스타일 표시 이름 (예: "선셋 그라디언트") |
| usesPhoto | boolean | 사진 배경을 풀블리드로 깔고 어둡기 오버레이를 얹는 스타일인가 |
| usesSurface | boolean | 내용이 종이 카드(서피스 박스) 안에 들어가는가 (신문 스타일 = true) |
| pageBackground | CSS background | 사진이 없을 때 카드 바탕. 단색 hex 또는 linear-gradient(...). 포인트색 연동이 필요하면 __ACCENT__ 토큰 사용 가능 |
| textBackdrop | #rrggbb | 본문 글자가 실제로 얹히는 영역의 근사 배경색 — **대비 검사 기준** |
| chromeBackdrop | #rrggbb | 상하단 헤더/푸터 영역의 근사 배경색 |
| ink | #rrggbb | 제목 글자색 |
| inkSub | #rrggbb | 본문/소제목 글자색 |
| inkMuted | #rrggbb | 출처 등 보조 글자색 |
| accentDefault | #rrggbb | 기본 포인트 색 (강조 하이라이트/불릿/CTA에 사용) |
| badgeBackground | CSS color | 배지 pill 배경 (rgba 허용) |
| badgeInk | #rrggbb | 배지 글자색 |
| fontTitle | CSS font-family | 제목 폰트 스택. 한글 폰트 포함 권장: "Pretendard", "Malgun Gothic", sans-serif |
| fontBody | CSS font-family | 본문 폰트 스택 |
| defaultDim | 0~1 숫자 | 사진형일 때 기본 하단 어둡기 (사진 없으면 0) |
| numberInk | (선택) CSS color | 본문 카드 큰 번호 색 — 생략하면 포인트색 |
| surfaceLadder | (선택) 문자열 3개 배열 | bg-1/bg-2/bg-3 서피스 계층 |
| inkScale | (선택) 객체 | ink/body/mute/faint 글자색 계층 |
| hairline | (선택) CSS color | 얇은 구분선·서피스 테두리 |
| eyebrowStyle | (선택) pill/bar/plain | 배지 계열 스타일 힌트 |
| titleTracking | (선택) 숫자 | 제목 자간 em 값 |
| badgeRadius | (선택) CSS length | 배지 둥근 정도 |
| bulletShape | (선택) dot/square/dash | 불릿 모양 |
| scrimStops | (선택) CSS color 배열 | 사진 스크림 그라디언트 정밀 제어 |

## 제약 규칙 (어기면 앱의 품질 게이트에서 거부됩니다)

1. **대비**: ink↔textBackdrop, inkSub↔textBackdrop 는 WCAG 4.5:1 이상이어야 합니다.
2. **accent 절제**: 포인트색은 강조 1~2곳에만 쓰이도록 배경과 확실히 구분되는 색으로.
3. pageBackground가 accentDefault와 같은 계열이면 numberInk를 흰색 계열로 지정하세요(번호가 묻힘 방지).
4. 사진형(usesPhoto=true)은 defaultDim 0.5~0.9 권장 — 텍스트 가독성 확보.
5. 색상은 반드시 6자리 hex(#rrggbb). 3자리 축약·색이름 금지.

## 완성 예시

예시 1 — 종이 서피스형:
\`\`\`json
${example1}
\`\`\`

예시 2 — 사진 다크형:
\`\`\`json
${example2}
\`\`\`

## 출력 형식

- 위 예시와 같은 구조의 JSON **하나만** \`\`\`json 코드블록으로 출력하세요.
- id는 앱이 자동 부여하므로 생략해도 됩니다. (내장 id와 겹치면 안 됨: ${builtinIds})
- 완성한 JSON은 Cardnews Studio의 [스타일 붙여넣기]에 그대로 넣으면 등록됩니다.
`;
}

export function buildSampleStyleJson(): string {
  return JSON.stringify(
    {
      ...exampleFromPreset(findStylePreset("cinematic")),
      id: "custom-ai-reference",
      name: "AI 레퍼런스 샘플"
    },
    null,
    2
  );
}

function exampleFromPreset(preset: StylePreset): Record<string, unknown> {
  return {
    name: preset.name,
    usesPhoto: preset.usesPhoto,
    usesSurface: preset.usesSurface,
    pageBackground: preset.pageBackground,
    textBackdrop: preset.textBackdrop,
    chromeBackdrop: preset.chromeBackdrop,
    ink: preset.ink,
    inkSub: preset.inkSub,
    inkMuted: preset.inkMuted,
    accentDefault: preset.accentDefault,
    badgeBackground: preset.badgeBackground,
    badgeInk: preset.badgeInk,
    fontTitle: preset.fontTitle,
    fontBody: preset.fontBody,
    defaultDim: preset.defaultDim,
    ...(preset.numberInk ? { numberInk: preset.numberInk } : {}),
    ...(preset.surfaceLadder ? { surfaceLadder: preset.surfaceLadder } : {}),
    ...(preset.inkScale ? { inkScale: preset.inkScale } : {}),
    ...(preset.hairline ? { hairline: preset.hairline } : {}),
    ...(preset.eyebrowStyle ? { eyebrowStyle: preset.eyebrowStyle } : {}),
    ...(preset.titleTracking !== undefined ? { titleTracking: preset.titleTracking } : {}),
    ...(preset.badgeRadius ? { badgeRadius: preset.badgeRadius } : {}),
    ...(preset.bulletShape ? { bulletShape: preset.bulletShape } : {}),
    ...(preset.scrimStops ? { scrimStops: preset.scrimStops } : {})
  };
}

function parseStringTuple3(value: unknown): readonly [string, string, string] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }

  const [first, second, third] = value;
  if (typeof first !== "string" || typeof second !== "string" || typeof third !== "string") {
    return undefined;
  }

  return [first, second, third];
}

function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }

  return value;
}

function parseInkScale(value: unknown): StylePreset["inkScale"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record["ink"] !== "string" ||
    typeof record["body"] !== "string" ||
    typeof record["mute"] !== "string" ||
    typeof record["faint"] !== "string"
  ) {
    return undefined;
  }

  return {
    ink: record["ink"],
    body: record["body"],
    mute: record["mute"],
    faint: record["faint"]
  };
}

function stripCodeFence(text: string): string {
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  return text;
}

function allocateStyleId(seed: string, existingIds: readonly string[]): string {
  const slug = seed
    .toLowerCase()
    .replace(/^custom-/, "")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const base = `custom-${slug || "style"}`;

  if (!existingIds.includes(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.includes(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const lighter = Math.max(relativeLuminance(foregroundHex), relativeLuminance(backgroundHex));
  const darker = Math.min(relativeLuminance(foregroundHex), relativeLuminance(backgroundHex));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hexColor: string): number {
  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}
