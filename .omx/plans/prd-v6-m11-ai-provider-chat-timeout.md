# PRD: V6 M11 AI Provider Detection, Raw Chat, and Timeout Progress

Status: RALPLAN proposed; consensus ready; implementation not started
Date: 2026-07-09
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Context snapshot: `.omx/context/cardnews-v6-m11-ai-provider-chat-timeout-context-20260708T215106Z.md`

## 1. Goal

Fix the next Pro AI blocker before EXE packaging: Codex CLI is installed but shown as missing, the AI drawer still feels like a preset prompt runner instead of a normal chat with Kkongdon AI, and long Claude/Codex/Gemini requests appear frozen before timing out.

The target experience is:

- The app reliably detects installed CLI providers on Windows/Electron.
- The AI drawer defaults to natural conversation.
- The user text is passed as the user message as written.
- Kkongdon brand/persona instructions are applied invisibly as a fixed system context.
- Long requests show live progress/elapsed time and have a longer provider timeout.

## 2. RALPLAN-DR Summary

### Principles

1. Detection must reflect the app runtime, not only the developer shell.
2. The composer belongs to the user; internal prompts must never take over user input.
3. A fixed Kkongdon AI identity belongs in a system/context layer, not in the visible input box.
4. Long-running CLI calls need clear product state: elapsed time, stage, provider name, and retry/cancel guidance.
5. Pro-only AI execution must remain stripped/locked in Lite.

### Decision Drivers

- User has Codex installed, but the app marks it as missing.
- The screenshot suggests provider list duplication in addition to false-negative detection.
- The user explicitly wants "너랑 대화하는 것 처럼" rather than a rigid preset prompt UX.
- Claude Code can take longer than the current 120-second timeout.
- Release packaging is not started yet, so this is the right point to fix Pro QA blockers without rebuilding EXE artifacts.

### Options

1. Recommended: Provider resolver + chat-first AI model + progress heartbeat.
   - Pros: directly solves all three user issues without a full AI rewrite.
   - Cons: touches Electron provider code, preload/main IPC shape, and AI drawer state.
2. Minimal patch: increase timeout and add a Codex install hint.
   - Pros: fastest.
   - Cons: does not fix false-negative detection, duplicate provider options, or raw chat UX.
3. Full streaming provider architecture.
   - Pros: best long-term UX.
   - Cons: too broad before packaging unless CLI streaming contracts are verified provider by provider.

Decision: choose Option 1, with an implementation path that can later evolve into true streaming.

## 3. Scope

### In Scope

- Make Codex CLI detection reliable on Windows when Electron is launched from desktop/Codex app, not only from a terminal.
- Remove duplicate provider entries in the dropdown and status list.
- Preserve explicit provider order: Claude, Codex, Gemini.
- Add provider detection diagnostics visible enough for support/debugging.
- Add a fixed Kkongdon AI system context to ordinary chat requests.
- Make ordinary send behavior raw-chat-first: user text is transmitted as the user message, unmodified except for trimming only the empty boundary.
- Reframe preset buttons as optional helpers, not the primary model.
- Increase provider timeout to a documented value and allow environment/config override.
- Add interactive in-drawer progress: elapsed time, current stage, provider name, and "still working" heartbeat.
- Keep Lite locked/stripped for AI provider execution.

### Out of Scope

- EXE packaging.
- Adding a paid web search API.
- Replacing Claude/Codex/Gemini with another provider.
- Guaranteeing live web search inside a CLI that does not support it.
- Full token budgeting, memory summarization, or multi-session chat persistence.
- True token-by-token streaming unless it falls out naturally from the provider implementation without broad risk.

## 4. Edition Matrix Impact

| Requirement | Lite | Pro | Notes |
| --- | --- | --- | --- |
| Provider detection resolver | No execution path | Yes | Lite must not expose callable provider status/execution. |
| Duplicate provider cleanup | Locked UI only if rendered | Yes | Pro dropdown must be unique by provider id. |
| Raw Kkongdon AI chat | Locked/no provider call | Yes | Main Pro AI behavior. |
| Preset helper buttons | Locked/no provider call | Yes | Optional helpers can remain Pro-only. |
| Longer timeout | No provider call | Yes | Main/electron provider adapter only. |
| Progress heartbeat UI | Locked/no provider call | Yes | Pro AI drawer. |
| verify-edition stripping | Required | Required | Lite must prove no callable `runAiProviderChat` path. |

## 5. Requirements

### R1. Reliable Windows/Electron Provider Detection

Problem: Codex is installed, but the AI dropdown says `Codex CLI · 미설치`.

Requirements:

- Replace the single `spawnSync("codex", ["--version"])` detection with a resolver that tries multiple safe candidates:
  - command name from PATH,
  - `where.exe codex` on Windows,
  - npm global bin path if discoverable,
  - common user install locations such as `%APPDATA%\npm\codex.cmd`,
  - optional explicit env override such as `CARDNEWS_CODEX_PATH`,
  - optional settings override if a later UI setting is added.
- Resolve to an executable command object, not only a boolean.
- Cache or reuse the resolved executable for the actual run command so "detected" and "run" use the same path when possible.
- Keep `shell: false`; do not use shell interpolation for prompts.
- Include `PATHEXT`/`.cmd` support for Windows.
- Return a diagnostic reason when detection fails, for example `not found on PATH or common npm global paths`.
- Do not show the same provider twice in the dropdown. De-dupe by provider id before render and in provider status generation.

Acceptance:

- If `codex --version` works in the user's shell but Electron PATH misses it, the app still detects a common `%APPDATA%\npm\codex.cmd` install.
- The provider dropdown contains exactly one Codex option.
- Detection output includes version when available.
- Failure state includes a Korean actionable hint and a copyable install/diagnostic line.

### R2. Provider Command Consistency

Problem: A provider may be detected one way and run another way.

Requirements:

- Introduce a testable provider resolver/command builder boundary:
  - `resolveAiProviderExecutable(provider)` or equivalent,
  - `buildProviderCommand(providerId, resolvedExecutable?)`.
- Codex run command must remain `codex exec --skip-git-repo-check -` or the resolved executable equivalent.
- Claude and Gemini should use the resolved executable when available.
- Provider status should carry enough metadata for UI/debugging without exposing sensitive paths unnecessarily.
- Prompt content remains stdin-only.

Acceptance:

- Unit tests prove Codex detection can resolve a fake `.cmd` path and build a run command using that path.
- Unit tests prove duplicate status entries are not produced.
- Unit tests prove prompt text is not placed into command args.

### R3. Raw Chat-First Kkongdon AI

Problem: The AI panel still feels like a preset prompt workflow, while the user wants normal conversation.

Requirements:

- Define one fixed system message, for example `buildKkongdonSystemPrompt()`, containing:
  - brand: 꽁돈 / kkongdon_story,
  - role: practical AI/cardnews assistant for beginners, solo operators, lecture inquiries,
  - tone: easy Korean, specific, actionable, no fake certainty,
  - behavior: answer the user's actual request first; suggest cardnews conversion only when relevant.
- Ordinary send must build:
  - system message,
  - recent clean conversation history,
  - current user message exactly as typed.
- The user's visible message bubble must equal the typed text.
- The CLI payload may include the fixed system context, but the user message must not be rewritten into a hidden preset prompt.
- The input should clear after sending only if the UX already expects that; if it remains, it must not be replaced by generated internal prompts.
- Conversation history should exclude loading/error placeholders.
- Retry must resend the same raw user text plus the same system context.

Acceptance:

- Typing `오늘 수업 후기글을 카드뉴스로 바꿔줘` and pressing send creates a user bubble with exactly that text.
- The serialized provider payload contains one system context plus the raw user text.
- No `모드: topic/research/draft/image` appears in the payload for ordinary send.
- The assistant can answer conversationally even when no preset button is clicked.

### R4. Presets Become Optional Helpers

Problem: Presets should not define the whole AI interaction.

Requirements:

- Keep existing helper buttons only as optional shortcuts:
  - `주제 찾기`,
  - `리서치 메모`,
  - `카드 대본 만들기`,
  - `이미지 프롬프트`.
- Preset clicks may add a workflow instruction, but it must be represented as a helper action, not as visible composer replacement.
- The UI should visually distinguish:
  - normal chat,
  - helper-generated request,
  - draft-detected output.
- The internal prompt debug panel should stay collapsed and should not be the default learning path.
- Next-step actions from M10 should remain, but should not make users feel the only way to use AI is through those buttons.

Acceptance:

- The first visible affordance in the AI drawer is a chat composer with "꽁돈 AI에게 물어보기" style language.
- Preset buttons are secondary controls.
- Clicking a preset does not replace the composer contents.
- Ordinary chat and helper calls can both lead to draft detection if the provider returns a valid deck template.

### R5. Longer Timeout and Configurable Limits

Problem: Claude Code can exceed the current 120-second timeout.

Requirements:

- Increase default provider timeout from 120 seconds to at least 300 seconds.
- Prefer a named constant such as `defaultProviderTimeoutMs = 300_000`.
- Support an environment override such as `CARDNEWS_AI_TIMEOUT_MS`.
- Validate override range to avoid absurd values:
  - minimum 30 seconds,
  - maximum 15 minutes,
  - invalid values fall back to default.
- Error text should include elapsed time and provider name.
- Do not leave orphan child processes after timeout.

Acceptance:

- Unit test proves default timeout is 300 seconds or configured value.
- Unit test proves invalid env override falls back.
- Timeout error says something like `Claude Code 응답 시간이 5분을 초과했습니다.`

### R6. Interactive Progress / Heartbeat UI

Problem: Long requests appear frozen; users think the app stopped.

Requirements:

- While a request is running, show a progress bubble in the assistant thread with:
  - provider name,
  - stage label,
  - elapsed time,
  - changing heartbeat text every few seconds.
- Minimum stages:
  - `요청 준비 중`,
  - `CLI 실행 중`,
  - `응답 대기 중`,
  - `응답 정리 중`.
- If true IPC/provider streaming is too risky, implement deterministic renderer heartbeat first:
  - start timer at send,
  - update the loading assistant message every second,
  - rotate stage/heartbeat copy based on elapsed time,
  - replace it with final response/error when done.
- If provider stderr/stdout streaming is added, redact or avoid noisy raw logs by default.
- Add an optional cancel affordance only if it can terminate the actual child process; otherwise do not fake cancellation.

Acceptance:

- During a mocked 65-second request, the AI drawer visibly updates elapsed time without receiving final output.
- The send button indicates the provider is still working.
- The final result replaces the progress bubble cleanly.
- Timeout replaces the progress bubble with an actionable error and retry button.

### R7. Provider Refresh UX and Diagnostics

Problem: Users need to understand why a provider is marked missing.

Requirements:

- `새로고침` should re-run detection and update provider statuses.
- The status line should say which providers were found and which are missing.
- Missing selected provider should show:
  - install hint,
  - detected PATH/common-path diagnostic,
  - "새로고침" button.
- If Codex is found via fallback path, status may show `Codex CLI 감지됨` without exposing full user path by default.

Acceptance:

- Refresh changes `Codex CLI · 미설치` to installed when a fallback executable exists.
- If still missing, the UI message helps the user fix PATH/install rather than only saying "미설치".

## 6. Implementation Order

1. Add tests around provider detection and timeout configuration before changing behavior.
2. Implement provider resolver and de-dupe provider statuses.
3. Wire resolver into run commands while preserving stdin-only prompt passing.
4. Add Kkongdon system prompt and raw chat message construction in Pro UI.
5. Reframe AI drawer copy/layout so chat is primary and presets are secondary.
6. Increase timeout with validated env override.
7. Add progress heartbeat UI for long-running calls.
8. Run Pro/Lite verification and update `HANDOFF.md` with evidence.

## 7. ADR

Decision: Implement M11 as a targeted Pro AI reliability and UX pass, not a broad AI platform rewrite.

Drivers:

- The reported bugs are concrete and release-blocking.
- Provider detection must be fixed before packaging because packaged Electron has the most PATH drift.
- Raw chat-first behavior is a product contract, not just UI copy.
- Long-running calls need trust-building feedback even if true streaming is not implemented yet.

Alternatives Rejected:

- Only increasing the timeout: rejected because it makes users wait longer without confidence and does not fix Codex detection.
- Only adding a PATH help message: rejected because Codex may be installed in predictable Windows locations the app can resolve.
- Full streaming/realtime agent architecture: rejected for this milestone because provider-specific streaming contracts add avoidable release risk.

Consequences:

- `electron/ai/cliAdapters.ts` will gain a resolver layer.
- `src/ui/App.tsx` AI state will gain progress metadata and a system-context send path.
- Tests must cover both provider internals and UI behavior.
- Lite stripping must be reverified because provider code is Pro-sensitive.

## 8. Available Agent Types / Staffing Guidance

Recommended implementation lane: `$ultrawork` solo execution unless the next turn explicitly asks for team mode.

If split into agents:

- `executor`: provider resolver, timeout config, Pro UI implementation.
- `test-engineer`: unit/smoke tests and Lite/Pro verification matrix.
- `designer`: AI drawer interaction/copy review if the UI becomes visually crowded.
- `verifier`: final evidence audit before packaging.

Reasoning levels:

- Provider resolver: medium-high, because Windows PATH and `.cmd` behavior are fragile.
- Raw chat UI: medium, because it is mostly state/UX contract.
- Timeout/progress: medium, unless true streaming/cancel is added.
- Lite stripping: high attention, because Pro-only AI must not leak.

## 9. Goal-Mode Follow-up Suggestions

Suggested next implementation command:

```text
[$ultrawork](C:\Users\js480\.codex\skills\ultrawork\SKILL.md)
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m11-ai-provider-chat-timeout.md 와
.omx/plans/test-spec-v6-m11-ai-provider-chat-timeout.md 기준으로 구현해.
EXE 패키징은 하지 말고, Pro/Lite 검증과 M11 증거, HANDOFF.md 갱신까지 완료해.
```

