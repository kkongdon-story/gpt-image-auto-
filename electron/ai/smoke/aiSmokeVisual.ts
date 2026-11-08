import type { BrowserWindow } from "electron";
import { listAiProviderStatuses } from "../cliAdapters.js";
import { isSmokeRecord, type SmokeActionResult } from "./aiSmokeTypes.js";

export async function runAiWorkflowVisualRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
  if (process.env["CARDNEWS_MOCK_AI"] !== "1" && !listAiProviderStatuses().some((provider) => provider.installed)) {
    return { ok: true };
  }

  const stage = process.env["CARDNEWS_AI_WORKFLOW_STAGE"] ?? "draft";
  if (!["topic", "research", "draft"].includes(stage)) {
    return { ok: false, message: `Unsupported CARDNEWS_AI_WORKFLOW_STAGE: ${stage}` };
  }

  const result: unknown = await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const targetStage = ${JSON.stringify(stage)};
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
        throw new Error("AI visual target was not found: " + selector);
      };
      const waitUntil = async (predicate, description, timeout = 10000) => {
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
          throw new Error("AI visual action is not a button: " + action);
        }
        button.click();
        await delay(250);
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
      const bodyText = () => document.body.innerText;
      const hasAction = (action) => Boolean(document.querySelector('[data-smoke-action="' + action + '"]'));
      const revealLastAssistant = () => {
        const bubbles = Array.from(document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]'));
        const lastBubble = bubbles[bubbles.length - 1];
        if (lastBubble instanceof HTMLElement) {
          lastBubble.scrollIntoView({ block: "start" });
        }
      };

      await clickAction("open-ai-panel");
      const input = await waitFor('[data-smoke-role="ai-input"]');
      if (!(input instanceof HTMLTextAreaElement)) {
        throw new Error("AI visual input was not ready.");
      }
      setNativeValue(input, "AI 업무 자동화");
      await clickAction("ai-preset-topic");
      await waitUntil(
        () => hasAction("ai-next-research") && hasAction("ai-next-draft") && hasAction("ai-next-fill-input"),
        () => "Topic visual stage did not expose next actions: " + bodyText()
      );
      revealLastAssistant();
      if (targetStage === "topic") {
        return { composer: input.value, stage: targetStage, text: bodyText() };
      }

      await clickAction("ai-next-research");
      await waitUntil(
        () => hasAction("ai-next-draft") && bodyText().includes("웹검색 미확인"),
        () => "Research visual stage did not expose capability note: " + bodyText()
      );
      revealLastAssistant();
      if (targetStage === "research") {
        return { composer: input.value, stage: targetStage, text: bodyText() };
      }

      await clickAction("ai-next-draft");
      await waitUntil(
        () => hasAction("ai-apply-draft") && bodyText().includes("카드 10장 감지"),
        () => "Draft visual stage did not expose apply action: " + bodyText()
      );
      revealLastAssistant();
      return { composer: input.value, stage: targetStage, text: bodyText() };
    })()
  `);

  if (!isSmokeRecord(result)) {
    return { ok: false, message: "AI workflow visual smoke did not return a result." };
  }
  const record = result;
  if (record["composer"] !== "AI 업무 자동화" || record["stage"] !== stage) {
    return { ok: false, message: `AI workflow visual smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

