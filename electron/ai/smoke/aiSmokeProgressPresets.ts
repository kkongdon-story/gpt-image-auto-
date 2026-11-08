import type { BrowserWindow } from "electron";
import { listAiProviderStatuses } from "../cliAdapters.js";
import { isSmokeRecord, type SmokeActionResult } from "./aiSmokeTypes.js";

export async function runAiTimeoutProgressRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const previousMockAi = process.env["CARDNEWS_MOCK_AI"];
  const previousDelay = process.env["CARDNEWS_MOCK_AI_DELAY_MS"];
  process.env["CARDNEWS_MOCK_AI"] = "1";
  process.env["CARDNEWS_MOCK_AI_DELAY_MS"] = "2600";
  try {
    const result: unknown = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const waitFor = async (selector, timeout = 8000) => {
          const started = Date.now();
          while (Date.now() - started < timeout) {
            const element = document.querySelector(selector);
            if (element) {
              return element;
            }
            await delay(80);
          }
          throw new Error("AI progress target was not found: " + selector);
        };
        const setNativeValue = (element, value) => {
          const prototype = Object.getPrototypeOf(element);
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (!setter) {
            throw new Error("No native value setter was available.");
          }
          setter.call(element, String(value));
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const openButton = await waitFor('[data-smoke-action="open-ai-panel"]');
        if (!(openButton instanceof HTMLButtonElement)) {
          throw new Error("AI panel open action was not a button.");
        }
        openButton.click();
        const input = await waitFor('[data-smoke-role="ai-input"]');
        if (!(input instanceof HTMLTextAreaElement)) {
          throw new Error("AI input was not ready.");
        }
        setNativeValue(input, "응답이 오래 걸리는 요청 테스트");
        const send = await waitFor('[data-smoke-action="ai-send"]');
        if (!(send instanceof HTMLButtonElement)) {
          throw new Error("AI send button was not ready.");
        }
        send.click();
        await delay(180);
        const samples = [];
        const sendDisabledSamples = [];
        for (const wait of [0, 1100, 1100]) {
          if (wait > 0) {
            await delay(wait);
          }
          const bubble = document.querySelector('[data-smoke-role="ai-assistant-bubble"]');
          samples.push(bubble instanceof HTMLElement ? bubble.innerText : "");
          sendDisabledSamples.push(send.disabled);
        }
        await delay(900);
        const finalBubble = document.querySelector('[data-smoke-role="ai-assistant-bubble"]');
        const evidence = {
          finalText: finalBubble instanceof HTMLElement ? finalBubble.innerText : "",
          samples,
          sendDisabledDuringSample: sendDisabledSamples.some(Boolean)
        };
        const pre = document.createElement("pre");
        pre.id = "ai-timeout-progress-regression-result";
        pre.textContent = "AI_TIMEOUT_PROGRESS_RESULT " + JSON.stringify(evidence);
        document.body.append(pre);
        return evidence;
      })()
    `);

    if (!isSmokeRecord(result)) {
      return { ok: false, message: "AI timeout progress smoke did not return a result." };
    }
    const record = result;
    const samples = Array.isArray(record["samples"]) ? record["samples"].map(String) : [];
    const distinctSamples = new Set(samples.filter((sample) => sample.trim().length > 0));
    const joined = samples.join("\n");
    const mentionsKnownProvider = ["Claude Code", "Codex CLI", "Gemini CLI"].some((providerLabel) =>
      joined.includes(providerLabel)
    );
    if (
      distinctSamples.size < 2 ||
      !joined.includes("경과") ||
      !/응답|답변/.test(joined) ||
      !mentionsKnownProvider ||
      record["sendDisabledDuringSample"] !== true
    ) {
      return { ok: false, message: `AI timeout progress smoke failed: ${JSON.stringify(record)}` };
    }
    return { ok: true };
  } finally {
    if (previousMockAi === undefined) {
      delete process.env["CARDNEWS_MOCK_AI"];
    } else {
      process.env["CARDNEWS_MOCK_AI"] = previousMockAi;
    }
    if (previousDelay === undefined) {
      delete process.env["CARDNEWS_MOCK_AI_DELAY_MS"];
    } else {
      process.env["CARDNEWS_MOCK_AI_DELAY_MS"] = previousDelay;
    }
  }
}

export async function runAiPresetModeRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  if (process.env["CARDNEWS_MOCK_AI"] !== "1" && !listAiProviderStatuses().some((provider) => provider.installed)) {
    return { ok: true };
  }

  const result: unknown = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
          await delay(80);
        }
        throw new Error("AI preset smoke target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 12000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (predicate()) {
            return true;
          }
          await delay(100);
        }
        throw new Error(typeof description === "function" ? description() : description);
      };
      const clickAction = async (action) => {
        const button = await waitFor('[data-smoke-action="' + action + '"]');
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error("AI preset smoke action is not a button: " + action);
        }
        button.click();
        await delay(180);
      };
      const assistantCount = () => document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]').length;
      const userCount = () => document.querySelectorAll('[data-smoke-role="ai-user-bubble"]').length;
      const hasApplyButton = () => Boolean(document.querySelector('[data-smoke-action="ai-apply-draft"]'));
      const bodyText = () => document.body.innerText;
      const lastUserText = () => {
        const bubbles = Array.from(document.querySelectorAll('[data-smoke-role="ai-user-bubble"]'));
        const bubble = bubbles[bubbles.length - 1];
        return bubble instanceof HTMLElement ? bubble.innerText.trim() : "";
      };
      const internalMarkers = ["모드: research", "모드: image", "모드: draft", "역할: 카드뉴스"];
      const runPreset = async (action, label) => {
        const assistantBefore = assistantCount();
        const userBefore = userCount();
        await clickAction(action);
        await waitUntil(
          () => assistantCount() > assistantBefore && userCount() > userBefore,
          () => "AI preset did not create a conversation turn: " + bodyText()
        );
        await waitUntil(
          () => document.querySelectorAll('[data-smoke-role="ai-progress"]').length === 0,
          () => "AI preset stayed in progress: " + bodyText()
        );
        const text = bodyText();
        return {
          apply: hasApplyButton(),
          friendly: lastUserText().startsWith(label + ": "),
          internalPromptHidden: internalMarkers.every((marker) => !text.includes(marker)),
          text
        };
      };

      await clickAction("open-ai-panel");
      await waitFor('[data-smoke-role="ai-panel"]');
      const research = await runPreset("ai-preset-research", "리서치 메모");
      if (research.apply || !research.friendly || !research.internalPromptHidden || research.text.includes("카드 10장 감지")) {
        throw new Error("Research preset was misdetected as a draft: " + JSON.stringify(research));
      }
      const image = await runPreset("ai-preset-image", "이미지 프롬프트");
      if (image.apply || !image.friendly || !image.internalPromptHidden || image.text.includes("카드 10장 감지")) {
        throw new Error("Image preset was misdetected as a draft: " + JSON.stringify(image));
      }
      const draft = await runPreset("ai-preset-draft", "카드 대본 만들기");
      if (!draft.apply || !draft.friendly || !draft.internalPromptHidden || !draft.text.includes("카드 10장 감지")) {
        throw new Error("Draft preset did not expose an applyable deck: " + JSON.stringify(draft));
      }

      const evidence = {
        draftApply: draft.apply,
        friendlyLabels: research.friendly && image.friendly && draft.friendly,
        imageApply: image.apply,
        internalPromptsHidden: research.internalPromptHidden && image.internalPromptHidden && draft.internalPromptHidden,
        researchApply: research.apply
      };
      const pre = document.createElement("pre");
      pre.id = "ai-preset-mode-regression-result";
      pre.textContent = "AI_PRESET_MODE_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `);

  if (!isSmokeRecord(result)) {
    return { ok: false, message: "AI preset mode smoke did not return a result." };
  }
  const record = result;
  if (
    record["researchApply"] !== false ||
    record["imageApply"] !== false ||
    record["draftApply"] !== true ||
    record["friendlyLabels"] !== true ||
    record["internalPromptsHidden"] !== true
  ) {
    return { ok: false, message: `AI preset mode smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

