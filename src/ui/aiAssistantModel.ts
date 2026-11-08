import { buildDraftPrompt, buildResearchPrompt, buildTopicPrompt, extractTemplateDocument } from "@edition";
import { parseDeckDocument } from "../domain/deckImporter";
import type { CardnewsError, CardnewsResult } from "../domain/types";

export type AiPresetKind = "topic" | "research" | "draft" | "image";
export type AiNextActionKind = "research" | "draft" | "fill-input";

export type AiNextAction = {
  readonly kind: AiNextActionKind;
  readonly label: string;
  readonly seed: string;
};

export type AiSendOptions = {
  readonly displayContent?: string;
  readonly includeHistory?: boolean;
  readonly sourceText?: string;
  readonly workflowKind?: AiPresetKind;
};

export type AiRetryRequest = {
  readonly options: AiSendOptions;
  readonly prompt: string;
};

export type AiDetectedDraft = {
  readonly templateText: string;
  readonly cardCount: number;
};

export type AiThreadEntry = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly capabilityNote?: string;
  readonly detectedDraft?: AiDetectedDraft;
  readonly nextActions?: readonly AiNextAction[];
  readonly retryRequest?: AiRetryRequest;
  readonly status?: "loading" | "complete" | "error";
};

type StyleName = { readonly id: string; readonly name: string };

function isCardnewsError<T>(result: CardnewsResult<T>): result is CardnewsError {
  return typeof result === "object" && result !== null && "code" in result;
}

function buildImagePrompt(seed: string): string {
  return [
    "꽁돈/kkongdon_story 카드뉴스에 쓸 배경 또는 배지 이미지 프롬프트를 작성합니다.",
    "모드: image",
    "스타일: 깔끔한 한국형 비즈니스 카드뉴스, 실제 사용 가능한 소재, 과한 장식 없음.",
    "주의: 양식.md 카드 대본을 만들지 말고 이미지 생성에 쓸 프롬프트만 작성하세요.",
    `주제: ${seed.trim() || "AI 자동화로 카드뉴스 제작 시간을 줄이는 장면"}`
  ].join("\n");
}

export function buildAiPresetPrompt(kind: AiPresetKind, seed: string, styles: readonly StyleName[]): string {
  switch (kind) {
    case "topic": return buildTopicPrompt(seed);
    case "research": return buildResearchPrompt(seed);
    case "draft": return buildDraftPrompt(seed, styles);
    case "image": return buildImagePrompt(seed);
  }
}

export function aiPresetLabel(kind: AiPresetKind): string {
  switch (kind) {
    case "topic": return "주제 찾기";
    case "research": return "리서치 메모";
    case "draft": return "카드 대본 만들기";
    case "image": return "이미지 프롬프트";
  }
}

export function detectAiDraft(rawText: string, styles: readonly StyleName[]): AiDetectedDraft | undefined {
  const templateText = extractTemplateDocument(rawText);
  if (!templateText.includes("유형:") || !templateText.includes("제목:")) return undefined;
  const parsed = parseDeckDocument(templateText, styles);
  return isCardnewsError(parsed) ? undefined : { templateText, cardCount: parsed.cards.length };
}

export function buildAiCapabilityNote(kind: AiPresetKind | undefined): string | undefined {
  return kind === "research" ? "웹검색 미확인 · 최신성 검증 필요" : undefined;
}

export function buildAiNextActions(
  kind: AiPresetKind | undefined,
  content: string,
  sourceText: string | undefined,
  fallback: string
): readonly AiNextAction[] {
  const seed = content.trim() || sourceText?.trim() || fallback.trim();
  if (!seed) return [];
  if (kind === "topic") {
    return [
      { kind: "research", label: "이 주제로 리서치", seed },
      { kind: "draft", label: "이 주제로 대본 만들기", seed },
      { kind: "fill-input", label: "입력창에 넣기", seed }
    ];
  }
  return kind === "research" ? [{ kind: "draft", label: "이 리서치로 대본 만들기", seed }] : [];
}

export function aiNextActionSmokeId(action: AiNextAction): string {
  return `ai-next-${action.kind}`;
}
