# RALPLAN Consensus: V6 M11 AI Provider Detection, Raw Chat, and Timeout Progress

Status: APPROVE TO IMPLEMENT
Date: 2026-07-09
PRD: `.omx/plans/prd-v6-m11-ai-provider-chat-timeout.md`
Test spec: `.omx/plans/test-spec-v6-m11-ai-provider-chat-timeout.md`
Context: `.omx/context/cardnews-v6-m11-ai-provider-chat-timeout-context-20260708T215106Z.md`

## 1. Planning Artifacts

- Context snapshot created from current code inspection.
- PRD created with requirements R1-R7.
- Test spec created with tests T1-T11.
- Implementation not started.
- EXE packaging explicitly out of scope.

## 2. Architect Review

Decision: APPROVE

Architecture notes:

- The provider detection bug should be fixed below the UI, not by hardcoding UI labels. The correct boundary is an executable resolver inside `electron/ai/cliAdapters.ts` or a sibling module.
- Detection and execution must share the same resolved executable. Otherwise the app can show "installed" but fail at run time.
- `shell: false` and stdin prompt passing should remain hard constraints.
- A renderer-only heartbeat is acceptable for M11 because it solves the user's "stuck" perception without requiring provider-specific streaming contracts.
- If true cancel is added, it must be backed by main-process child termination. Fake cancel should be avoided.
- The raw chat-first contract is cleanly supported by the existing `AiChatMessage` type because it already allows `system`, `user`, and `assistant` roles.

Risks:

- Windows `.cmd` execution with `shell: false` can be tricky. Tests should cover `.cmd` or resolver should choose a Node/Windows-safe execution form.
- Exposing resolved executable paths can leak local usernames; diagnostics should be useful without overexposing full paths by default.
- Provider stdout/stderr streaming can become noisy. M11 should use heartbeat first unless streaming is simple and clean.

Required implementation guardrails:

- Keep prompt text out of args.
- Keep Lite stripped/locked.
- Keep Codex `--skip-git-repo-check`.
- Keep provider list unique by id.

## 3. Critic Review

Decision: APPROVE WITH CONDITIONS

Challenge points:

- Do not interpret "raw chat" as "send no system prompt." The user wants Kkongdon AI identity, but does not want their typed text rewritten into a hidden workflow prompt. The correct split is fixed system context plus raw user message.
- Do not solve the timeout complaint only by increasing timeout. Longer silence makes UX worse. The progress heartbeat is part of the acceptance criteria.
- Do not claim web/search improvements. This plan is about CLI chat reliability and UX. Live web capability remains provider/environment-dependent.
- Do not add a new dependency to resolve PATH unless the existing Node/Windows APIs cannot cover it.
- Do not move Pro-only AI code into shared Lite bundles unless `verify-edition` proves it is stripped.

Blocking conditions before implementation complete:

- No automated test for provider resolver fallback.
- No smoke or unit proof that ordinary chat payload excludes preset `모드:` instructions.
- No proof that progress changes over time during a pending request.
- No Lite `verify-edition` evidence.

## 4. Consensus Gate

Consensus gate complete: true

Approved path:

1. Implement provider resolver/de-dupe first.
2. Implement raw chat-first system context second.
3. Implement timeout configuration and progress heartbeat third.
4. Verify Pro/Lite gates before any EXE packaging task.

## 5. Follow-up Staffing

Default next lane: `$ultrawork` solo implementation.

Use `$team` only if the implementation is split into independent lanes:

- provider resolver,
- AI drawer UX,
- tests/verification.

Use `$ralph` only if a long single-owner loop is desired after plan approval.

