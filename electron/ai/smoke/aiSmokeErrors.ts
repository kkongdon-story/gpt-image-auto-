import type { BrowserWindow } from "electron";
import { isSmokeRecord, type SmokeActionResult } from "./aiSmokeTypes.js";

export async function runAiErrorSanitizationRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const previousMockAi = process.env["CARDNEWS_MOCK_AI"];
  const previousMockError = process.env["CARDNEWS_MOCK_AI_ERROR"];
  process.env["CARDNEWS_MOCK_AI"] = "1";
  process.env["CARDNEWS_MOCK_AI_ERROR"] = [
    "OpenAI Codex v0.143.0",
    "workdir: C:\\Users\\example\\release\\win-unpacked-pro-2.0.0",
    "USER SYSTEM: hidden internal prompt",
    "failed to parse hooks config C:\\Users\\example\\.codex\\hooks.json",
    "The 'gpt-5.6-sol' model requires a newer version of Codex."
  ].join("\n");

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
          throw new Error("AI error sanitization target was not found: " + selector);
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
        const send = await waitFor('[data-smoke-action="ai-send"]');
        if (!(input instanceof HTMLTextAreaElement) || !(send instanceof HTMLButtonElement)) {
          throw new Error("AI error sanitization controls were not ready.");
        }
        const before = document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]').length;
        setNativeValue(input, "오류 안내를 안전하게 보여줘");
        send.click();
        await waitUntil(
          () => document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]').length > before,
          () => "AI error bubble was not created: " + document.body.innerText
        );
        await waitUntil(
          () => !document.body.innerText.includes("응답 작성 중"),
          () => "AI error response stayed in progress: " + document.body.innerText
        );
        const bubbles = Array.from(document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]'));
        const lastBubble = bubbles[bubbles.length - 1];
        const evidence = {
          assistantText: lastBubble instanceof HTMLElement ? lastBubble.innerText : "",
          bodyText: document.body.innerText
        };
        const pre = document.createElement("pre");
        pre.id = "ai-error-sanitization-regression-result";
        pre.textContent = "AI_ERROR_SANITIZATION_RESULT " + JSON.stringify(evidence);
        document.body.append(pre);
        return evidence;
      })()
    `);

    if (!isSmokeRecord(result)) {
      return { ok: false, message: "AI error sanitization smoke did not return a result." };
    }
    const record = result;
    const assistantText = String(record["assistantText"] ?? "");
    const bodyText = String(record["bodyText"] ?? "");
    const forbidden = ["C:\\Users", "USER SYSTEM", "hooks.json", "gpt-5.6-sol", "workdir:"];
    if (
      !assistantText.includes("모델 설정") ||
      forbidden.some((token) => assistantText.includes(token) || bodyText.includes(token))
    ) {
      return { ok: false, message: `AI error sanitization smoke failed: ${JSON.stringify(record)}` };
    }
    return { ok: true };
  } finally {
    if (previousMockAi === undefined) {
      delete process.env["CARDNEWS_MOCK_AI"];
    } else {
      process.env["CARDNEWS_MOCK_AI"] = previousMockAi;
    }
    if (previousMockError === undefined) {
      delete process.env["CARDNEWS_MOCK_AI_ERROR"];
    } else {
      process.env["CARDNEWS_MOCK_AI_ERROR"] = previousMockError;
    }
  }
}

export async function runAiPresetRetryRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  const previousMockAi = process.env["CARDNEWS_MOCK_AI"];
  const previousMockError = process.env["CARDNEWS_MOCK_AI_ERROR"];
  process.env["CARDNEWS_MOCK_AI"] = "1";
  process.env["CARDNEWS_MOCK_AI_ERROR"] = "The selected AI provider could not complete the request.";

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
          throw new Error("AI preset retry target was not found: " + selector);
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
        const userTexts = () => Array.from(document.querySelectorAll('[data-smoke-role="ai-user-bubble"]'))
          .map((element) => element instanceof HTMLElement ? element.innerText.trim() : "");
        const internalMarkers = [
          "모드: research",
          "역할: 카드뉴스 리서처",
          "브랜드: 꽁돈 / kkongdon_story"
        ];

        const openButton = await waitFor('[data-smoke-action="open-ai-panel"]');
        if (!(openButton instanceof HTMLButtonElement)) {
          throw new Error("AI panel open action was not a button.");
        }
        openButton.click();
        const presetButton = await waitFor('[data-smoke-action="ai-preset-research"]');
        if (!(presetButton instanceof HTMLButtonElement)) {
          throw new Error("AI research preset action was not a button.");
        }
        presetButton.click();
        await waitUntil(
          () => Boolean(document.querySelector('[data-smoke-action="ai-retry"]')),
          () => "AI preset did not expose a retry action: " + document.body.innerText
        );

        const firstTexts = userTexts();
        const firstBodyText = document.body.innerText;
        const firstRetry = await waitFor('[data-smoke-action="ai-retry"]');
        if (!(firstRetry instanceof HTMLButtonElement)) {
          throw new Error("AI retry action was not a button.");
        }
        firstRetry.click();
        await waitUntil(
          () => userTexts().length > firstTexts.length,
          () => "AI retry did not append a user bubble: " + document.body.innerText
        );
        await waitUntil(
          () => document.querySelectorAll('[data-smoke-action="ai-retry"]').length > 1,
          () => "AI retry did not complete with a second retry action: " + document.body.innerText
        );

        const retryTexts = userTexts();
        const finalBodyText = document.body.innerText;
        const firstFriendlyText = firstTexts[firstTexts.length - 1] ?? "";
        const retryFriendlyText = retryTexts[retryTexts.length - 1] ?? "";
        const evidence = {
          firstFriendly: firstFriendlyText.startsWith("리서치 메모: "),
          firstInternalPromptHidden: internalMarkers.every((marker) => !firstBodyText.includes(marker)),
          retryFriendly: retryFriendlyText === firstFriendlyText,
          retryInternalPromptHidden: internalMarkers.every((marker) => !finalBodyText.includes(marker)),
          retryRepeatedFriendlyText: retryTexts.slice(-2).every((text) => text === firstFriendlyText)
        };
        const pre = document.createElement("pre");
        pre.id = "ai-preset-retry-regression-result";
        pre.textContent = "AI_PRESET_RETRY_RESULT " + JSON.stringify(evidence);
        document.body.append(pre);
        return evidence;
      })()
    `);

    if (!isSmokeRecord(result)) {
      return { ok: false, message: "AI preset retry smoke did not return a result." };
    }
    const record = result;
    if (
      record["firstFriendly"] !== true ||
      record["firstInternalPromptHidden"] !== true ||
      record["retryFriendly"] !== true ||
      record["retryInternalPromptHidden"] !== true ||
      record["retryRepeatedFriendlyText"] !== true
    ) {
      return { ok: false, message: `AI preset retry smoke failed: ${JSON.stringify(record)}` };
    }
    return { ok: true };
  } finally {
    if (previousMockAi === undefined) {
      delete process.env["CARDNEWS_MOCK_AI"];
    } else {
      process.env["CARDNEWS_MOCK_AI"] = previousMockAi;
    }
    if (previousMockError === undefined) {
      delete process.env["CARDNEWS_MOCK_AI_ERROR"];
    } else {
      process.env["CARDNEWS_MOCK_AI_ERROR"] = previousMockError;
    }
  }
}

