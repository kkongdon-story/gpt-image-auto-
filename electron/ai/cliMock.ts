import type { AiChatMessage } from "../../src/domain/types.js";
import { buildMockDraftDocument } from "../../src/edition/pro/ai/aiPrompts.js";

export function buildMockAiResponse(messages: readonly AiChatMessage[]): string {
  const prompt =
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? serializeMessages(messages);
  const mode = prompt.match(/(?:^|\n)모드:\s*(topic|research|image|draft)\b/)?.[1];
  if (mode === "topic") {
    return [
      "주제 후보",
      "1. AI 업무 자동화 루틴 - 반복 업무를 줄이고 싶은 초보자를 위한 카드뉴스",
      "2. 카드뉴스 제작 시간을 줄이는 법 - 기획부터 PNG까지 막히는 지점을 해결",
      "3. 혼자 일하는 사람의 Codex 활용법 - 작은 자동화부터 시작하는 실전 흐름"
    ].join("\n");
  }
  if (mode === "research") {
    return [
      "리서치 메모",
      "근거: 공식 자료와 최근 보도자료를 비교해 시행일, 대상, 예외를 확인하세요.",
      "사례: 초보자가 자주 놓치는 신고/동의/고지 절차를 카드별 질문으로 나눌 수 있습니다.",
      "반론: 모든 사업자에게 같은 위험이 적용되지는 않으므로 업종별 차이를 표시하세요."
    ].join("\n");
  }
  if (mode === "image") {
    return [
      "이미지 프롬프트",
      "한국형 비즈니스 카드뉴스 배경, 노트북과 업무 메모, 부드러운 자연광, 깔끔한 여백, 텍스트를 올리기 쉬운 낮은 대비."
    ].join("\n");
  }
  if (mode === "draft") {
    return buildMockDraftDocument();
  }

  if (messages.some((message) => message.role === "system" && message.content.includes("꽁돈 AI"))) {
    return [
      "꽁돈 AI 답변",
      "좋아요. 사용자가 남긴 문장을 먼저 정리하고, 카드뉴스로 바꿀 때는 핵심 장면과 문장을 나눠서 잡으면 됩니다.",
      "원하시면 이 대화를 10장 카드뉴스 대본으로 이어서 구성해드릴게요."
    ].join("\n");
  }

  return buildMockDraftDocument();
}

export async function waitForMockAiDelay(): Promise<void> {
  const rawDelay = process.env["CARDNEWS_MOCK_AI_DELAY_MS"];
  if (!rawDelay) {
    return;
  }
  const delayMs = Number(rawDelay);
  if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > 10_000) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function serializeMessages(messages: readonly AiChatMessage[]): string {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n---\n\n");
}
