import { buildTemplateDocument } from "../../../domain/deckImporter.js";

type StyleNameEntry = {
  readonly id: string;
  readonly name: string;
};

const brandKernel = [
  "브랜드: 꽁돈 / kkongdon_story",
  "관점: AI를 일과 삶에 적용해 초보자도 바로 실행하게 돕는다.",
  "톤: 쉬운 한국어, 실전 예시, 과장보다 구체성, 카드뉴스에 맞는 짧은 문장.",
  "대상: AI와 자동화를 배우는 1인 사업자, 강의 수강생, 입문자."
].join("\n");

export function buildTopicPrompt(seed: string): string {
  return [
    brandKernel,
    "",
    "역할: 카드뉴스 기획자.",
    "요청: 아래 단서에서 인스타/스레드 카드뉴스 주제 10개를 제안하세요.",
    "각 주제는 제목, 독자 문제, 첫 카드 후킹 문장으로 구성하세요.",
    "",
    `단서: ${seed.trim() || "AI 자동화 입문자가 오늘 바로 써먹을 수 있는 주제"}`
  ].join("\n");
}

export function buildResearchPrompt(seed: string): string {
  return [
    brandKernel,
    "",
    "역할: 카드뉴스 리서처.",
    "요청: 아래 주제에 쓸 수 있는 근거, 사례, 반론, 쉬운 비유를 정리하세요.",
    "웹검색 가능한 CLI라면 최신 근거를 확인하고, 링크는 자동으로 열지 말고 텍스트로만 남기세요.",
    "",
    `주제: ${seed.trim() || "AI 자동화 카드뉴스"}`
  ].join("\n");
}

export function buildDraftPrompt(seed: string, styleNames: readonly StyleNameEntry[]): string {
  return [
    brandKernel,
    "",
    "역할: 카드뉴스 대본 작성자.",
    "출력 규칙: 설명 없이 양식.md 내용만 출력하세요. 코드 블록을 써도 되지만 본문은 반드시 양식.md 형식이어야 합니다.",
    "카드는 정확히 10장으로 작성하세요. 각 카드 제목은 짧고, 본문은 1~2문장 또는 불릿 2개 이하로 제한하세요.",
    "멘션은 @kkongdon_story를 사용하세요.",
    "",
    "앱에서 파싱하는 양식 계약:",
    buildTemplateDocument(styleNames),
    "",
    `작성 주제/단서: ${seed.trim() || "Codex로 카드뉴스 제작 시간을 줄이는 방법"}`
  ].join("\n");
}

export function extractTemplateDocument(rawText: string): string {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  const fencedBlocks = [...normalized.matchAll(/```(?:markdown|md|text)?\s*\n([\s\S]*?)```/gi)];
  for (const block of fencedBlocks) {
    const body = block[1]?.trim() ?? "";
    if (looksLikeTemplateDocument(body)) {
      return body;
    }
  }

  const markers = ["헤더:", "멘션:", "---", "유형:"]
    .map((marker) => normalized.indexOf(marker))
    .filter((index) => index >= 0);
  const start = markers.length > 0 ? Math.min(...markers) : 0;
  return normalized.slice(start).trim();
}

export function buildMockDraftDocument(): string {
  return [
    "헤더: MONEY NOTE",
    "멘션: @kkongdon_story",
    "스타일: newsprint",
    "포인트색상: #a53d2d",
    "하단어둡기: 85",
    "비율: 4:5",
    "",
    "---",
    "유형: 표지",
    "배지: AI NOTE",
    "제목: 카드뉴스를|더 빨리 만드는 법",
    "소제목: 초보자도 바로 쓰는 자동화 루틴",
    "",
    "---",
    "유형: 본문",
    "제목: 01 먼저 주제를 좁히세요",
    "본문: 좋은 카드뉴스는 넓은 정보보다 한 사람의 문제에서 시작합니다.",
    "- 독자 한 명을 떠올리기",
    "- 오늘 해결할 질문 하나 쓰기",
    "",
    "---",
    "유형: 본문",
    "제목: 02 구조를 먼저 정하세요",
    "본문: 카드 순서를 정하면 글을 쓰는 시간이 줄어듭니다.",
    "- 문제",
    "- 해결 순서",
    "",
    "---",
    "유형: 본문",
    "제목: 03 AI에게 양식을 주세요",
    "본문: 자유롭게 써달라고 하면 결과가 흔들립니다. 앱이 읽는 양식을 함께 주세요.",
    "",
    "---",
    "유형: 본문",
    "제목: 04 긴 문장은 나누세요",
    "본문: 제목은 한 호흡으로 읽히게 만들고, 본문은 두 줄 안에서 끝냅니다.",
    "",
    "---",
    "유형: 본문",
    "제목: 05 예시를 붙이면 쉬워집니다",
    "본문: 독자는 원리보다 적용 장면을 먼저 이해합니다.",
    "- 업무 보고서",
    "- 강의 홍보",
    "",
    "---",
    "유형: 본문",
    "제목: 06 디자인은 한 번만 고르세요",
    "본문: 스타일을 매번 새로 찾지 말고, 검증된 프리셋에서 시작하세요.",
    "",
    "---",
    "유형: 본문",
    "제목: 07 PNG까지 한 번에 확인하세요",
    "본문: 미리보기와 내보내기가 같은 HTML을 쓰면 결과가 흔들리지 않습니다.",
    "",
    "---",
    "유형: 본문",
    "제목: 08 실패는 게이트가 잡습니다",
    "본문: 대비와 넘침 문제는 눈대중보다 자동 검사로 먼저 확인하세요.",
    "",
    "---",
    "유형: 마무리",
    "제목: 오늘 만들 카드뉴스 하나",
    "본문: 주제 하나를 고르고 AI에게 양식으로 요청해보세요.",
    "강조: 저장하고 바로 실행하기"
  ].join("\n");
}

function looksLikeTemplateDocument(text: string): boolean {
  return text.includes("유형:") && text.includes("제목:") && text.includes("---");
}
