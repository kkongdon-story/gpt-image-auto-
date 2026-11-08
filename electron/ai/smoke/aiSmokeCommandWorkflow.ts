import path from "node:path";
import type { BrowserWindow } from "electron";
import { buildProviderCommand, listAiProviderStatuses, mapAiProviderError, resolveAiProviderCwd } from "../cliAdapters.js";
import { isSmokeRecord, type SmokeActionResult } from "./aiSmokeTypes.js";

export async function runAiProviderCommandRegressionSmoke(mainWindow: BrowserWindow, storageRoot: string): Promise<SmokeActionResult> {
  const command = buildProviderCommand("codex");
  const resolvedCwd = resolveAiProviderCwd({
    explicitWorkspaceCwd: process.env["CARDNEWS_AI_WORKSPACE_CWD"],
    processCwd: process.cwd(),
    storageRoot: storageRoot
  });
  const mappedError = mapAiProviderError(
    "Codex CLI",
    "Not inside a trusted directory and --skip-git-repo-check was not specified."
  );
  const expectedCwd = path.resolve(storageRoot);
  const commandContractSafe =
    command.args.join(" ") ===
    [
      "exec --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules",
      "--disable hooks --disable plugins --disable memories --disable multi_agent --disable apps",
      "--disable image_generation --disable computer_use --disable in_app_browser --disable goals",
      "--disable workspace_dependencies -"
    ].join(" ");
  const productErrorSafe =
    mappedError.includes("작업 폴더") &&
    mappedError.includes("새로고침") &&
    !mappedError.includes("--skip-git-repo-check");
  const evidence = {
    commandContractSafe,
    commandUsesBareExecutable: command.file === "codex",
    cwdUsesStorageRoot: resolvedCwd === expectedCwd,
    productErrorSafe,
    shell: command.shell
  };

  await mainWindow.webContents.executeJavaScript(
    `
      (() => {
        const evidence = ${JSON.stringify(evidence)};
        const pre = document.createElement("pre");
        pre.id = "ai-provider-command-regression-result";
        pre.textContent = "AI_PROVIDER_COMMAND_RESULT " + JSON.stringify(evidence);
        document.body.append(pre);
      })()
    `
  );

  if (
    !evidence.commandContractSafe ||
    !evidence.commandUsesBareExecutable ||
    command.shell !== false ||
    !evidence.productErrorSafe ||
    !evidence.cwdUsesStorageRoot
  ) {
    return { ok: false, message: `AI provider command regression failed: ${JSON.stringify(evidence)}` };
  }

  return { ok: true };
}

export async function runAiWorkflowRegressionSmoke(mainWindow: BrowserWindow): Promise<SmokeActionResult> {
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
        throw new Error("AI workflow target was not found: " + selector);
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
          throw new Error("AI workflow action is not a button: " + action);
        }
        button.click();
        await delay(180);
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
      const assistantCount = () => document.querySelectorAll('[data-smoke-role="ai-assistant-bubble"]').length;
      const hasAction = (action) => Boolean(document.querySelector('[data-smoke-action="' + action + '"]'));

      await clickAction("open-ai-panel");
      const panel = await waitFor('[data-smoke-role="ai-panel"]');
      const input = await waitFor('[data-smoke-role="ai-input"]');
      if (!(panel instanceof HTMLElement) || !(input instanceof HTMLTextAreaElement)) {
        throw new Error("AI panel/input were not ready.");
      }
      setNativeValue(input, "AI 업무 자동화");
      const beforeTopic = assistantCount();
      await clickAction("ai-preset-topic");
      if (input.value.includes("역할:") || input.value.includes("요청:") || input.value.includes("브랜드:")) {
        throw new Error("Preset polluted the composer with an internal prompt: " + input.value);
      }
      await waitUntil(
        () => assistantCount() > beforeTopic && hasAction("ai-next-research"),
        () => "Topic result did not expose next research action: " + bodyText()
      );
      const afterTopicInput = input.value;
      await clickAction("ai-next-research");
      await waitUntil(
        () => hasAction("ai-next-draft") && bodyText().includes("웹검색 미확인"),
        () => "Research result did not expose capability note and next draft action: " + bodyText()
      );
      if (hasAction("ai-apply-draft")) {
        throw new Error("Research output exposed a deck apply action too early.");
      }
      await clickAction("ai-next-draft");
      await waitUntil(
        () => hasAction("ai-apply-draft") && bodyText().includes("카드 10장 감지"),
        () => "Draft result did not expose apply action: " + bodyText()
      );
      await clickAction("ai-reset-thread");
      await delay(250);
      const evidence = {
        afterResetInput: input.value,
        afterResetText: bodyText(),
        afterTopicInput,
        hasApplyAfterReset: hasAction("ai-apply-draft"),
        hasNextAfterReset: hasAction("ai-next-research") || hasAction("ai-next-draft")
      };
      const pre = document.createElement("pre");
      pre.id = "ai-workflow-regression-result";
      pre.textContent = "AI_WORKFLOW_RESULT " + JSON.stringify(evidence);
      document.body.append(pre);
      return evidence;
    })()
  `);

  if (!isSmokeRecord(result)) {
    return { ok: false, message: "AI workflow smoke did not return a result." };
  }
  const record = result;
  if (
    record["afterTopicInput"] !== "AI 업무 자동화" ||
    record["afterResetInput"] !== "" ||
    record["hasApplyAfterReset"] !== false ||
    record["hasNextAfterReset"] !== false
  ) {
    return { ok: false, message: `AI workflow smoke failed: ${JSON.stringify(record)}` };
  }
  return { ok: true };
}

