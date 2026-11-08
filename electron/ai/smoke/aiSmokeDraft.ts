import type { BrowserWindow } from "electron";
import { listAiProviderStatuses } from "../cliAdapters.js";
import { isSmokeRecord, type AiDraftSmokeDependencies, type SmokeActionResult } from "./aiSmokeTypes.js";

export async function runAiDraftRegressionSmoke(
  mainWindow: BrowserWindow,
  dependencies: AiDraftSmokeDependencies
): Promise<SmokeActionResult> {
  const { clickSmokeButton, readRenderSmokeResult, waitForSmokeText } = dependencies;
  if (process.env["CARDNEWS_MOCK_AI"] !== "1" && !listAiProviderStatuses().some((provider) => provider.installed)) {
    return { ok: true };
  }

  await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const openButton = document.querySelector('[data-smoke-action="open-ai-panel"]');
      if (!(openButton instanceof HTMLButtonElement)) {
        reject(new Error("AI panel button was not found."));
        return;
      }
      openButton.click();
      const started = Date.now();
      const tick = () => {
        const panel = document.querySelector('[data-smoke-role="ai-panel"]');
        const draftButton = document.querySelector('[data-smoke-action="ai-preset-draft"]');
        if (
          panel instanceof HTMLElement &&
          draftButton instanceof HTMLButtonElement &&
          draftButton.disabled === false
        ) {
          draftButton.click();
          resolve(true);
          return;
        }
        if (Date.now() - started > 8000) {
          reject(new Error("AI panel did not become ready."));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
  await waitForSmokeText(mainWindow, ["카드 10장 감지", "AI 오류"]);

  await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const assistant = document.querySelector('[data-smoke-role="ai-assistant-bubble"]');
        const applyButton = document.querySelector('[data-smoke-action="ai-apply-draft"]');
        if (assistant instanceof HTMLElement && applyButton instanceof HTMLButtonElement) {
          applyButton.click();
          resolve(true);
          return;
        }
        if (Date.now() - started > 8000) {
          reject(new Error("AI assistant bubble or apply button was not found."));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
  await waitForSmokeText(mainWindow, ["AI 대본 적용: 카드 10장", "AI 대본 파싱 실패", "AI 오류"]);

  const applied: unknown = await mainWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const text = document.body.innerText;
        const result = {
          applied: text.includes("AI 대본 적용: 카드 10장"),
          thumbCount: document.querySelectorAll(".slide-thumb").length
        };
        if (result.thumbCount === 10 || Date.now() - started > 8000) {
          resolve(result);
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    })
  `);
  if (!isAiSmokeUiRecord(applied) || !applied.applied || applied.thumbCount !== 10) {
    return { ok: false, message: `AI draft did not apply ten cards: ${JSON.stringify(applied)}` };
  }

  await mainWindow.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitUntil = async (predicate, message) => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (predicate()) {
            return;
          }
          await wait(100);
        }
        throw new Error(message());
      };
      const setNativeValue = (element, value) => {
        const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor?.set?.call(element, String(value));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const contentTab = document.querySelector('[data-smoke-action="inspector-content"]');
      if (contentTab instanceof HTMLButtonElement) {
        contentTab.click();
      }
      await waitUntil(
        () => document.querySelector('[data-smoke-action="card-design-tab"]') instanceof HTMLButtonElement,
        () => "AI draft chrome controls were not reachable."
      );
      const designTab = document.querySelector('[data-smoke-action="card-design-tab"]');
      if (designTab instanceof HTMLButtonElement) {
        designTab.click();
      }
      await waitUntil(
        () => document.querySelector('[data-smoke-role="chrome-header-color"]') instanceof HTMLInputElement,
        () => "AI draft chrome color controls were not found."
      );
      for (const role of ["chrome-header-color", "chrome-page-color", "chrome-footer-color"]) {
        const colorInput = document.querySelector('[data-smoke-role="' + role + '"]');
        if (colorInput instanceof HTMLInputElement) {
          setNativeValue(colorInput, "#141414");
        }
      }
      await wait(400);
    })()
  `);

  await clickSmokeButton(mainWindow, "generate");
  await waitForSmokeText(mainWindow, ["렌더 완료: 10장", "렌더 실패", "게이트 실패"]);
  const renderResult = await readRenderSmokeResult(mainWindow);
  if (!renderResult.ok) {
    return renderResult;
  }

  const rendered: unknown = await mainWindow.webContents.executeJavaScript(`
    (() => document.body.innerText.includes("렌더 완료: 10장"))()
  `);
  return rendered === true ? { ok: true } : { ok: false, message: "AI draft did not render ten cards." };
}

function isAiSmokeUiRecord(input: unknown): input is { readonly applied: boolean; readonly thumbCount: number } {
  if (!isSmokeRecord(input)) {
    return false;
  }
  return typeof input["applied"] === "boolean" && typeof input["thumbCount"] === "number";
}
