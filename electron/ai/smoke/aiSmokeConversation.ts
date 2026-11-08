import type { BrowserWindow } from "electron";
import { listAiProviderStatuses } from "../cliAdapters.js";
import { isSmokeRecord, type SmokeActionResult } from "./aiSmokeTypes.js";

export async function runAiProviderDetectionRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const statuses = listAiProviderStatuses();
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
        throw new Error("AI provider detection target was not found: " + selector);
      };
      const openButton = await waitFor('[data-smoke-action="open-ai-panel"]');
      if (!(openButton instanceof HTMLButtonElement)) {
        throw new Error("AI panel open action was not a button.");
      }
      openButton.click();
      const panel = await waitFor('[data-smoke-role="ai-panel"]');
      const select = panel.querySelector(".ai-provider-strip select");
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error("AI provider select was not found.");
      }
      const options = Array.from(select.options).map((option) => ({
        text: option.textContent ?? "",
        value: option.value
      }));
      const evidence = { options };
      const pre = document.createElement("pre");
      pre.id = "ai-provider-detection-regression-result";
      pre.textContent = "AI_PROVIDER_DETECTION_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `);

  if (!isSmokeRecord(result)) {
    return { ok: false, message: "AI provider detection smoke did not return a result." };
  }
  const rawOptions = result["options"];
  const options = Array.isArray(rawOptions) ? rawOptions.filter(isSmokeRecord) : [];
  const optionValues = options.map((option) => String(option["value"] ?? ""));
  const uniqueValues = new Set(optionValues);
  const statusIds = statuses.map((status) => status.id);
  const uniqueStatusIds = new Set(statusIds);
  if (
    optionValues.length !== 3 ||
    uniqueValues.size !== optionValues.length ||
    !["claude", "codex", "gemini"].every((providerId) => optionValues.includes(providerId)) ||
    uniqueStatusIds.size !== statusIds.length
  ) {
    return {
      ok: false,
      message: `AI provider detection smoke failed: ${JSON.stringify({ options, statuses })}`
    };
  }
  return { ok: true };
}

export async function runAiRawChatRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const previousMockAi = process.env["CARDNEWS_MOCK_AI"];
  process.env["CARDNEWS_MOCK_AI"] = "1";
  try {
    const rawText = "오늘 수업 후기글을 카드뉴스로 바꿔줘";
    const result: unknown = await mainWindow.webContents.executeJavaScript(`
      (async () => {
        const rawText = ${JSON.stringify(rawText)};
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
          throw new Error("AI raw chat target was not found: " + selector);
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
        setNativeValue(input, rawText);
        const send = await waitFor('[data-smoke-action="ai-send"]');
        if (!(send instanceof HTMLButtonElement)) {
          throw new Error("AI send button was not ready.");
        }
        send.click();
        await waitUntil(
          () => document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]').length > 0,
          () => "AI raw chat did not create an assistant bubble: " + document.body.innerText
        );
        await waitUntil(
          () => !document.body.innerText.includes("작성 중..."),
          () => "AI raw chat stayed in loading state: " + document.body.innerText
        );
        const userBubbles = Array.from(document.querySelectorAll('[data-smoke-role="ai-user-bubble"]'));
        const assistantBubbles = Array.from(document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]'));
        const lastUser = userBubbles[userBubbles.length - 1];
        const lastAssistant = assistantBubbles[assistantBubbles.length - 1];
        const evidence = {
          assistantText: lastAssistant instanceof HTMLElement ? lastAssistant.innerText : "",
          bodyText: document.body.innerText,
          composer: input.value,
          hasApplyDraft: Boolean(document.querySelector('[data-smoke-action="ai-apply-draft"]')),
          userText: lastUser instanceof HTMLElement ? lastUser.innerText : ""
        };
        const pre = document.createElement("pre");
        pre.id = "ai-raw-chat-regression-result";
        pre.textContent = "AI_RAW_CHAT_RESULT " + JSON.stringify(evidence);
        document.body.append(pre);
        return evidence;
      })()
    `);

    if (!isSmokeRecord(result)) {
      return { ok: false, message: "AI raw chat smoke did not return a result." };
    }
    const record = result;
    const assistantText = String(record["assistantText"] ?? "");
    const bodyText = String(record["bodyText"] ?? "");
    if (
      record["userText"] !== rawText ||
      record["hasApplyDraft"] !== false ||
      !assistantText.includes("꽁돈 AI") ||
      bodyText.includes("모드: topic") ||
      bodyText.includes("모드: research") ||
      bodyText.includes("모드: draft") ||
      bodyText.includes("모드: image")
    ) {
      return { ok: false, message: `AI raw chat smoke failed: ${JSON.stringify(record)}` };
    }
    return { ok: true };
  } finally {
    if (previousMockAi === undefined) {
      delete process.env["CARDNEWS_MOCK_AI"];
    } else {
      process.env["CARDNEWS_MOCK_AI"] = previousMockAi;
    }
  }
}
