# Context Snapshot: V6 M10 AI Workflow, Input, and Layout Follow-up

Date: 2026-07-09 KST / 2026-07-08 UTC
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Trigger: `$ralplan` additional modification plan

## Task Statement

Plan the next bugfix batch for four user-reported defects found during Pro manual QA after the V6 M9 test-feedback fixes.

## Desired Outcome

Produce a bounded PRD and test specification that can be handed to an implementation workflow. The plan must preserve Lite/Pro separation, keep EXE packaging out of scope, and make the Pro app testable by the user after a normal dev build.

## User-Reported Evidence

1. Title input bug: when the cursor is at the end of the title field, trailing spaces and line breaks do not reliably enter.
2. Right inspector bug: in `콘텐츠 -> 디자인`, scrolling down still shows an abnormal white panel/background region. Screenshot: `C:\Users\js480\AppData\Local\Temp\codex-clipboard-75ca14bc-a262-4968-923e-a3ebfb3cd0fc.png`.
3. AI provider bugs:
   - Codex provider returns `Not inside a trusted directory and --skip-git-repo-check was not specified.`
   - Claude provider says it cannot web search and writes a training-data-based research memo.
4. AI workflow UX bug: preset buttons insert/generated long instructions into the same input area, the result area shows topic/result text, the composer still contains the generated instruction, and the user cannot tell what to write next or what button to press. The attached log shows prior research/draft/topic prompts being carried into later AI calls.

## Current Codebase Touchpoints

- `src/ui/App.tsx`
  - `buildAiPresetPrompt()`, `fillAiPreset()`, `sendAiMessage()`
  - AI drawer rendering around provider select, preset chips, thread, composer, and draft apply controls
  - content title/subtitle textareas with `data-smoke-role="content-title"`
- `electron/ai/cliAdapters.ts`
  - provider definitions, including `codex exec -`
  - command serialization and provider detection
- `electron/main.ts`
  - `runAiProviderChat(providerId, messages, { cwd: storageRoot() })`
  - Electron smoke actions for content/AI behavior
- `src/edition/pro/ai/aiPrompts.ts`
  - topic/research/draft/image prompt builders
- `src/ui/styles.css`
  - right inspector/content panel scroll behavior
  - AI drawer and message layout

## Constraints

- Do not package a new EXE in this batch.
- Common input/layout fixes must apply to Lite and Pro.
- AI/provider features remain Pro-only; Lite must keep these stripped/locked and pass `verify-edition`.
- Avoid a broad editor rewrite before the next packaging checkpoint.
- The user-facing AI workflow must hide prompt plumbing. Internal prompts may exist for debugging, but the main input must be for the user's topic, notes, source text, or conversation content.

## Known Risks

- The title issue may be caused by controlled textarea normalization, raw-card synchronization, preview rerender pressure, or keyboard handling; implementation must diagnose before patching.
- The inspector white panel issue may be layout CSS rather than React state; screenshots at multiple viewport heights are required.
- Codex CLI behavior can vary by installed version and trust settings; command construction must be testable without requiring live network/model access.
- Claude web search may be unavailable in the installed CLI. The app should not promise live web research unless the provider proves it.

## Open Questions for Implementation

- Should structured title newlines render as literal line breaks, the existing `|` title separator convention, or both? The plan recommends: textarea preserves newlines; serialization maps them to the existing render-safe line-break convention where needed.
- Should AI preset calls include prior chat history by default? The plan recommends: no, preset actions should send a single mode-scoped prompt unless the user explicitly chooses to continue the conversation.
