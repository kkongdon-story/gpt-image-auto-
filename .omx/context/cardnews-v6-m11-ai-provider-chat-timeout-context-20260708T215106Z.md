# Context: V6 M11 AI Provider Detection, Raw Chat, Timeout Progress

Date: 2026-07-09 KST
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Planning request: `$ralplan`

## User-Reported Issues

1. The AI drawer shows `Codex CLI · 미설치` even though Codex is installed on the machine.
2. The AI feature should stop behaving like a preset/prompt workflow first. The user wants a natural chat structure: fixed Kkongdon AI identity/context in the background, while the user's typed text is passed through to the CLI like a normal Codex/ChatGPT conversation.
3. Long Claude Code calls currently end with `Claude Code 응답 시간이 초과되었습니다.` The timeout must be increased and the UI should show interactive progress/status bubbles so users do not think the app has frozen.

Screenshot observation:

- Provider dropdown shows:
  - `Codex CLI · 미설치`
  - `Claude Code · 2.1.187 (Claude Code)`
  - `Codex CLI · 미설치`
  - `Gemini CLI · 미설치`
- This indicates two problems: Codex detection false-negative and duplicated provider option rendering/status data.

## Current Code Findings

### Provider Detection

File: `electron/ai/cliAdapters.ts`

- `providerDefinitions` contains three providers: Claude, Codex, Gemini.
- Codex run command is already `codex exec --skip-git-repo-check -`.
- Detection uses:
  - `spawnSync(file, args, { shell: false, timeout: 5_000 })`
  - For Codex, this is effectively `spawnSync("codex", ["--version"])`.
- This is vulnerable in packaged Electron / desktop launches because the Electron process may not inherit the same PATH seen in PowerShell, Git Bash, or Codex desktop.
- `buildCliEnv()` passes through `PATH`, `PATHEXT`, and `Path`, but it does not repair PATH or search common npm/global install locations.

### Timeout

File: `electron/ai/cliAdapters.ts`

- `defaultTimeoutMs = 120_000`.
- `runProvider()` kills the child process after the timeout and returns:
  - `${provider.label} 응답 시간이 초과되었습니다.`
- The UI waits on a single Promise and has no progress events from main to renderer.

### Chat Flow

File: `src/ui/App.tsx`

- `sendAiMessage(promptOverride?, options?)` can send plain `aiInput`, but preset buttons call `runAiPreset()`, which builds an internal prompt and sends that prompt.
- M10 separated internal prompt preview from composer pollution, but the product model is still workflow/preset-first.
- There is no fixed `system` message or stable `Kkongdon AI` persona boundary in the message payload.
- `serializeMessages()` in `electron/ai/cliAdapters.ts` already supports roles by serializing `SYSTEM:`, `USER:`, `ASSISTANT:`, but the UI does not send a system message.

### IPC Boundary

Files:

- `src/edition/pro/index.tsx`
- `electron/preload.cts`
- `electron/main.ts`
- `electron/ai/cliAdapters.ts`

Current shape:

- Renderer calls `runEditionAi(providerId, messages)`.
- Preload/main expose `cardnews:ai:chat`.
- Main validates `AiChatMessage[]`.
- Main calls `runAiProviderChat(providerId, messages, { cwd: storageRoot() })`.

Implication:

- Timeout configuration and progress streaming need a contract change, not just a renderer-only tweak.
- The smallest stable implementation can keep `runAiChat()` for final results and add progress metadata in renderer via elapsed timers.
- A stronger implementation can add `cardnews:ai:chatProgress` IPC events or an async request id for provider stage updates.

### Lite / Pro Boundary

Files:

- `src/edition/pro/index.tsx`
- `src/edition/lite/index.tsx`
- `scripts/verify-edition.mjs`

Current Lite behavior:

- `listEditionAiProviders()` returns `[]`.
- `runEditionAi()` returns locked result.

M11 must preserve this: provider execution, raw CLI chat, timeout changes, and provider diagnostics are Pro-only. Shared UI shell fixes may apply to both if touched, but no AI execution path should become callable in Lite.

## Existing M10 Artifacts

- PRD: `.omx/plans/prd-v6-m10-ai-workflow-input-layout.md`
- Test spec: `.omx/plans/test-spec-v6-m10-ai-workflow-input-layout.md`
- Consensus: `.omx/plans/ralplan-v6-m10-ai-workflow-input-layout-consensus.md`
- Evidence: `.omc/evidence/v6/m10-ai-workflow-input-layout/`

M11 should extend M10 rather than replace it. M10 fixed Codex trusted-directory invocation and preset prompt pollution; M11 focuses on detection reliability, raw chat-first behavior, and long-call progress UX.

