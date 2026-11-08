import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { runEditionAi } from "@edition";
import type { AiProviderId } from "../domain/types";
import { buildAiChatMessages, buildAiProgressContent, normalizeAiUiError } from "./aiChat";
import {
  aiPresetLabel,
  buildAiCapabilityNote,
  buildAiNextActions,
  buildAiPresetPrompt,
  detectAiDraft,
  type AiNextAction,
  type AiPresetKind,
  type AiRetryRequest,
  type AiSendOptions,
  type AiThreadEntry
} from "./aiAssistantModel";

type UseAiAssistantInput = {
  readonly defaultInstruction?: string;
  readonly providerId: AiProviderId;
  readonly providerLabel: string;
  readonly setGlobalStatus: (message: string) => void;
  readonly styleNames: readonly { readonly id: string; readonly name: string }[];
};

export type AiAssistantController = {
  readonly busy: boolean;
  readonly input: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly retry: (request: AiRetryRequest | undefined) => void;
  readonly runPreset: (kind: AiPresetKind, seed?: string) => void;
  readonly send: (promptOverride?: string, options?: AiSendOptions) => Promise<void>;
  readonly setDraftText: Dispatch<SetStateAction<string>>;
  readonly setInput: Dispatch<SetStateAction<string>>;
  readonly setStatus: Dispatch<SetStateAction<string>>;
  readonly status: string;
  readonly thread: readonly AiThreadEntry[];
  readonly reset: () => void;
  readonly runNextAction: (action: AiNextAction) => void;
};

function createAiId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAiAssistant(input: UseAiAssistantInput): AiAssistantController {
  const [composer, setComposer] = useState("Codex로 카드뉴스 제작 시간을 줄이는 방법");
  const [thread, setThread] = useState<readonly AiThreadEntry[]>([]);
  const [, setDraftText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("CLI 상태를 확인하세요.");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const focusInput = () => window.setTimeout(() => inputRef.current?.focus(), 0);
  const updateAssistant = (id: string, patch: Partial<AiThreadEntry> & Pick<AiThreadEntry, "content">) => {
    setThread((current) => current.map((message) => message.id === id ? { ...message, ...patch } : message));
    if (patch.status === "error") setStatus("요청을 완료하지 못했습니다. 안내를 확인하고 다시 시도해주세요.");
  };

  async function send(promptOverride?: string, options: AiSendOptions = {}): Promise<void> {
    if (busy) return;
    const prompt = (promptOverride ?? composer).trim();
    if (!prompt) {
      setStatus("AI에 보낼 내용을 입력하세요.");
      return;
    }
    const assistantId = createAiId("ai-assistant");
    const startedAt = Date.now();
    const userMessage: AiThreadEntry = {
      id: createAiId("ai-user"), role: "user", content: options.displayContent ?? prompt
    };
    const loadingMessage: AiThreadEntry = {
      id: assistantId,
      role: "assistant",
      content: buildAiProgressContent({ providerLabel: input.providerLabel, startedAt, now: startedAt }),
      status: "loading"
    };
    const includeHistory = options.includeHistory ?? options.workflowKind === undefined;
    const messages = buildAiChatMessages({
      ...(input.defaultInstruction !== undefined ? { defaultInstruction: input.defaultInstruction } : {}),
      history: includeHistory ? thread : [],
      userContent: prompt
    });
    let timer: number | undefined;
    try {
      setBusy(true);
      setStatus("AI 응답 대기 중...");
      setThread((current) => [...current, userMessage, loadingMessage]);
      timer = window.setInterval(() => updateAssistant(assistantId, {
        content: buildAiProgressContent({ providerLabel: input.providerLabel, startedAt, now: Date.now() }),
        status: "loading"
      }), 2000);
      const result = await runEditionAi(input.providerId, messages);
      if ("code" in result) {
        updateAssistant(assistantId, {
          content: normalizeAiUiError(result.message), retryRequest: { options, prompt }, status: "error"
        });
        input.setGlobalStatus("AI 요청을 완료하지 못했습니다. AI 패널의 안내를 확인해주세요.");
        return;
      }
      const draft = options.workflowKind === undefined || options.workflowKind === "draft"
        ? detectAiDraft(result.content, input.styleNames) : undefined;
      const note = buildAiCapabilityNote(options.workflowKind);
      updateAssistant(assistantId, {
        content: result.content,
        ...(note ? { capabilityNote: note } : {}),
        ...(draft ? { detectedDraft: draft } : {}),
        nextActions: buildAiNextActions(options.workflowKind, result.content, options.sourceText, composer),
        status: "complete"
      });
      if (draft) setDraftText(draft.templateText);
      setStatus(`${result.providerId} 응답 완료`);
    } catch (error) {
      updateAssistant(assistantId, {
        content: normalizeAiUiError(error instanceof Error ? error.message : "알 수 없는 AI 오류"),
        retryRequest: { options, prompt }, status: "error"
      });
      input.setGlobalStatus("AI 요청을 완료하지 못했습니다. AI 패널의 안내를 확인해주세요.");
    } finally {
      if (timer !== undefined) window.clearInterval(timer);
      setBusy(false);
    }
  }

  const runPreset = (kind: AiPresetKind, seed = composer) => {
    const seedText = seed.trim() || "AI 자동화 카드뉴스";
    void send(buildAiPresetPrompt(kind, seedText, input.styleNames), {
      displayContent: `${aiPresetLabel(kind)}: ${seedText}`,
      includeHistory: false,
      sourceText: seedText,
      workflowKind: kind
    });
    focusInput();
  };
  const reset = () => {
    setThread([]); setDraftText(""); setComposer(""); setStatus("새 AI 대화를 시작했습니다."); focusInput();
  };
  const retry = (request: AiRetryRequest | undefined) => {
    if (request && !busy) void send(request.prompt, request.options);
  };
  const runNextAction = (action: AiNextAction) => {
    if (action.kind === "fill-input") { setComposer(action.seed); focusInput(); return; }
    runPreset(action.kind, action.seed);
  };

  return {
    busy, input: composer, inputRef, reset, retry, runNextAction, runPreset, send,
    setDraftText, setInput: setComposer, setStatus, status, thread
  };
}
