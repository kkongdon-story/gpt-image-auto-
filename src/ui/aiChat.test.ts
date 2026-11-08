import { describe, expect, it } from "vitest";
import {
  buildAiChatMessages,
  buildAiProgressContent,
  buildAiSystemPrompt,
  buildKkongdonSystemPrompt,
  normalizeAiUiError
} from "./aiChat";

describe("AI chat payload helpers", () => {
  it("adds one generic system message while preserving raw user text", () => {
    const messages = buildAiChatMessages({
      history: [],
      userContent: "오늘 수업 후기글을 카드뉴스로 바꿔줘"
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("앱 안전 계약");
    expect(messages[0]?.content).not.toContain("꽁돈");
    expect(messages[0]?.content).not.toContain("kkongdon_story");
    expect(messages[1]).toEqual({ role: "user", content: "오늘 수업 후기글을 카드뉴스로 바꿔줘" });
    expect(messages.map((message) => message.content).join("\n")).not.toContain("모드: draft");
  });

  it("places the editable default instruction once after the immutable contract", () => {
    const instruction = "내 브랜드 톤은 담백하고 짧게.";
    const prompt = buildAiSystemPrompt(instruction);

    expect(prompt.indexOf("앱 안전 계약")).toBeLessThan(prompt.indexOf("사용자 기본 지시"));
    expect(prompt.match(new RegExp(instruction, "g"))).toHaveLength(1);
    expect(buildKkongdonSystemPrompt(instruction)).toBe(prompt);
  });

  it("excludes loading and error placeholders from conversation history", () => {
    const messages = buildAiChatMessages({
      defaultInstruction: "브랜드명은 사용자가 매번 지정한다.",
      history: [
        { role: "user", content: "첫 질문" },
        { role: "assistant", content: "작성 중...", status: "loading" },
        { role: "assistant", content: "실패", status: "error" },
        { role: "assistant", content: "정상 답변", status: "complete" }
      ],
      userContent: "다음 질문"
    });

    expect(messages.map((message) => message.content)).toEqual([
      buildKkongdonSystemPrompt("브랜드명은 사용자가 매번 지정한다."),
      "첫 질문",
      "정상 답변",
      "다음 질문"
    ]);
  });

  it("changes progress text as elapsed time advances", () => {
    const startedAt = 1_000;
    const first = buildAiProgressContent({ providerLabel: "Claude Code", startedAt, now: 1_000 });
    const second = buildAiProgressContent({ providerLabel: "Claude Code", startedAt, now: 5_000 });
    const third = buildAiProgressContent({ providerLabel: "Claude Code", startedAt, now: 12_000 });
    const fourth = buildAiProgressContent({ providerLabel: "Claude Code", startedAt, now: 45_000 });

    expect(first).toContain("요청 정리 중");
    expect(second).toContain("AI 연결 중");
    expect(third).toContain("대화 맥락 분석 중");
    expect(fourth).toContain("답변 작성 중");
    expect(new Set([first, second, third, fourth]).size).toBe(4);
  });

  it("keeps actionable errors but removes raw CLI logs from the UI", () => {
    expect(normalizeAiUiError("Codex CLI 로그인이 필요합니다. 터미널에서 로그인해주세요.")).toContain(
      "로그인이 필요합니다"
    );
    const sanitized = normalizeAiUiError(
      "workdir: C:\\Users\\private\\release\nUSER SYSTEM: secret\nError: model failure"
    );
    expect(sanitized).not.toContain("C:\\Users");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).toContain("AI 요청을 완료하지 못했습니다");
  });
});
