import { aspectRatios } from "./aspectRatios.js";
import type { CardnewsError, CardnewsResult } from "./types.js";

/** 양식.md 문서를 파싱한 결과 — 비어 있는 필드는 현재 설정 유지 */
export type DeckDocument = {
  readonly headerLabel?: string;
  readonly footerAccount?: string;
  readonly styleId?: string;
  readonly accentColor?: string;
  readonly backgroundDim?: number;
  readonly aspectRatio?: string;
  readonly cards: readonly string[];
  readonly warnings: readonly string[];
};

export const maxImportCards = 12;

type StyleNameEntry = {
  readonly id: string;
  readonly name: string;
};

/**
 * 양식.md 원문을 파싱한다.
 *
 * 문서 구조:
 * - 첫 구분선(`---` 또는 `## 카드 N`) 이전 = 메타 블록 (헤더/푸터/스타일/포인트색상/하단어둡기)
 * - 구분선으로 나뉜 각 블록 = 카드 원문 (기존 카드 라벨 문법 그대로)
 * - 메타 블록의 인식 불가 줄은 안내문으로 간주하고 무시한다.
 */
export function parseDeckDocument(
  rawText: string,
  styleNames: readonly StyleNameEntry[]
): CardnewsResult<DeckDocument> {
  const normalized = rawText.replace(/\r\n/g, "\n");
  if (normalized.trim().length === 0) {
    return invalidInput("양식 파일이 비어 있습니다.");
  }

  const blocks = splitBlocks(normalized);
  if (blocks.cardBlocks.length === 0) {
    return invalidInput(
      "카드 블록을 찾지 못했습니다. 카드마다 '---' 구분선(또는 '## 카드 N' 제목)으로 나눠주세요."
    );
  }

  const warnings: string[] = [];
  const meta = parseMetaBlock(blocks.metaLines, styleNames, warnings);

  let cards = blocks.cardBlocks;
  if (cards.length > maxImportCards) {
    warnings.push(`카드가 ${cards.length}개라 앞의 ${maxImportCards}개만 가져왔습니다.`);
    cards = cards.slice(0, maxImportCards);
  }

  return {
    ...meta,
    cards,
    warnings
  };
}

/** 사용자가 채워 넣을 양식.md 템플릿 본문을 만든다. */
export function buildTemplateDocument(styleNames: readonly StyleNameEntry[]): string {
  const styleList = styleNames.map((style) => `${style.id} (${style.name})`).join(", ");

  return `카드뉴스 양식 — 아래 항목을 채운 뒤 앱에서 "파일 불러오기"로 여세요.
메타 항목은 생략하면 앱의 현재 설정이 유지됩니다.

헤더: MONEY NOTE
푸터: @kkongdon_story
스타일: newsprint
포인트색상: #a53d2d
하단어둡기: 85
비율: 4:5

사용 가능한 스타일: ${styleList}
카드는 '---' 구분선으로 나눕니다. 제목은 필수이고, *단어* 는 포인트색 강조가 됩니다.

---
유형: 표지
배지: MONEY NOTE
제목: 첫 카드 *제목* 을 쓰세요
소제목: 부제를 쓰세요

---
유형: 본문
제목: 두 번째 카드 제목
본문: 첫 문단을 씁니다.
- 불릿 항목
- 불릿 항목
출처: 출처 메모

---
유형: 마무리
제목: 마지막 카드 제목
본문: - 정리 질문 하나
강조: 저장하고 다시 보기
`;
}

function splitBlocks(text: string): {
  readonly metaLines: readonly string[];
  readonly cardBlocks: readonly string[];
} {
  const lines = text.split("\n");
  const segments: string[][] = [[]];

  for (const line of lines) {
    if (isSeparator(line)) {
      segments.push([]);
      continue;
    }

    segments[segments.length - 1]!.push(line);
  }

  const [first, ...rest] = segments;
  const firstLines = first ?? [];

  // 구분선 없이 시작한 첫 블록에 카드 라벨이 있으면 메타가 아니라 카드다.
  const firstIsCard = firstLines.some((line) => /^(유형|제목)\s*:/.test(line.trim()));

  const rawCardBlocks = firstIsCard ? [firstLines, ...rest] : rest;
  const cardBlocks = rawCardBlocks
    .map((block) => block.join("\n").trim())
    .filter((block) => block.length > 0);

  return {
    metaLines: firstIsCard ? [] : firstLines,
    cardBlocks
  };
}

function isSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^-{3,}/.test(trimmed) || /^={3,}/.test(trimmed) || /^#{1,6}\s*카드/.test(trimmed);
}

function parseMetaBlock(
  lines: readonly string[],
  styleNames: readonly StyleNameEntry[],
  warnings: string[]
): Omit<DeckDocument, "cards" | "warnings"> {
  let headerLabel: string | undefined;
  let footerAccount: string | undefined;
  let styleId: string | undefined;
  let accentColor: string | undefined;
  let backgroundDim: number | undefined;
  let aspectRatio: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = /^([^:]{1,12}):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const label = match[1]!.trim();
    const value = match[2]!.trim();
    if (value.length === 0) {
      continue;
    }

    switch (label) {
      case "헤더":
        headerLabel = value;
        break;
      case "멘션":
      case "푸터":
        footerAccount = value;
        break;
      case "스타일": {
        const resolved = resolveStyleId(value, styleNames);
        if (resolved) {
          styleId = resolved;
        } else {
          warnings.push(`알 수 없는 스타일입니다: "${value}" — 현재 스타일을 유지합니다.`);
        }
        break;
      }
      case "포인트색상":
      case "포인트":
      case "색상": {
        const normalizedColor = normalizeHexColor(value);
        if (normalizedColor) {
          accentColor = normalizedColor;
        } else {
          warnings.push(`포인트색상은 #rrggbb 형식이어야 합니다: "${value}" — 무시합니다.`);
        }
        break;
      }
      case "비율": {
        const matched = aspectRatios.find((ratio) => ratio.id === value);
        if (matched) {
          aspectRatio = matched.id;
        } else {
          warnings.push(
            `알 수 없는 비율입니다: "${value}" — 4:5, 1:1, 16:9, 4:3 중 하나를 쓰세요.`
          );
        }
        break;
      }
      case "하단어둡기":
      case "어둡기": {
        const dim = parseDim(value);
        if (dim === undefined) {
          warnings.push(`하단어둡기는 0~100 숫자여야 합니다: "${value}" — 무시합니다.`);
        } else {
          backgroundDim = dim;
        }
        break;
      }
      default:
        // 안내문 등 인식 불가 라벨은 무시
        break;
    }
  }

  return {
    ...(headerLabel ? { headerLabel } : {}),
    ...(footerAccount ? { footerAccount } : {}),
    ...(styleId ? { styleId } : {}),
    ...(accentColor ? { accentColor } : {}),
    ...(backgroundDim !== undefined ? { backgroundDim } : {}),
    ...(aspectRatio ? { aspectRatio } : {})
  };
}

function resolveStyleId(
  value: string,
  styleNames: readonly StyleNameEntry[]
): string | undefined {
  const lowered = value.toLowerCase();

  const byId = styleNames.find((style) => style.id.toLowerCase() === lowered);
  if (byId) {
    return byId.id;
  }

  const byName = styleNames.find((style) => style.name === value);
  if (byName) {
    return byName.id;
  }

  const byPrefix = styleNames.find(
    (style) => style.name.startsWith(value) || value.startsWith(style.name.split(" ")[0] ?? "")
  );
  return byPrefix?.id;
}

function normalizeHexColor(value: string): string | undefined {
  const candidate = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : undefined;
}

function parseDim(value: string): number | undefined {
  const numeric = Number.parseFloat(value.replace("%", ""));
  if (Number.isNaN(numeric) || numeric < 0) {
    return undefined;
  }

  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return ratio > 1 ? undefined : Math.round(ratio * 100) / 100;
}

function invalidInput(message: string): CardnewsError {
  return { ok: false, code: "invalid_input", message };
}
