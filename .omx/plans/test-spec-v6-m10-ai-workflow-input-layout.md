# Test Spec: V6 M10 AI Workflow, Input, and Layout Follow-up

Status: RALPLAN approved; Architect APPROVE, Critic APPROVE
Date: 2026-07-09
Related PRD: `.omx/plans/prd-v6-m10-ai-workflow-input-layout.md`

## 1. Standard Verification Commands

Run from:

```powershell
cd "C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto"
```

Required full gate before completion:

```powershell
npm run typecheck
npm test
npm run build
npm run build:lite
node scripts/verify-edition.mjs --edition lite
$env:CARDNEWS_SMOKE_ACTION='content-title-whitespace-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='inspector-design-scroll-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='ai-provider-command-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='ai-workflow-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='edition-lite-regression'; node node_modules/electron/cli.js .
```

If smoke action names change during implementation, update this spec and `HANDOFF.md`.

## 2. Automated Coverage

### T1. Title End-Cursor Whitespace and Newline

Purpose: reproduce the user's "space/newline at title end is swallowed" bug.

Suggested smoke action: `content-title-whitespace-regression`

Steps:

1. Open Pro app.
2. Switch to content title field for card 1.
3. Set title to `갑자기 화면이 여전히 안`.
4. Move cursor to the end.
5. Insert a literal space and assert textarea value ends with that space.
6. Insert Enter/newline and assert textarea value contains `\n`.
7. Insert `먹음` after the newline and assert final textarea value is exactly `갑자기 화면이 여전히 안 \n먹음` or the implementation's documented newline-preserving equivalent.
8. Wait for preview settle and assert rendered title has an intentional line break or separator-preserved layout.
9. Repeat the assertions before blur/save so the active DOM value is proven exact while editing.
10. Save/reload or reopen through the available workspace persistence path and assert intentional line breaks survive.

Unit targets:

- Structured title update helper, if extracted.
- Raw card serialization helper, if newlines are mapped to `|`.
- No `.trim()`/collapse on active textarea state.

### T2. Subtitle Regression Companion

Purpose: catch the same issue in subtitle if it shares the same update path.

Steps:

1. Focus subtitle textarea.
2. Type `숫자보다 먼저 보는 관점 ` with trailing space.
3. Press Enter and type `두번째 줄`.
4. Assert the DOM value preserves both.

### T3. Inspector Design Scroll Visual Regression

Purpose: prove the attached white-panel lower-scroll bug is gone.

Suggested smoke action: `inspector-design-scroll-regression`

Viewports:

- 1365x768
- 1920x1080
- 2560x1440

Steps:

1. Open Pro app.
2. Switch right panel to `콘텐츠`.
3. Switch inner card tab to `디자인`.
4. Scroll inspector to the lower controls near `레이어`, `전역 설정으로 초기화`, `카드 추가`, and `이 카드 삭제`.
5. Capture screenshots to `.omc/evidence/v6/m10-ai-workflow-input-layout/`.
6. Assert bottom controls are reachable and no inner white rounded panel is clipped/floating over unrelated content.

DOM assertions:

- The active inspector scroll container has `scrollHeight > clientHeight`.
- Bottom controls' bounding boxes are within the visible inspector viewport after scroll.
- No panel with white background has a bottom edge above its children.

### T4. Codex Provider Command Regression

Purpose: prevent `Not inside a trusted directory and --skip-git-repo-check was not specified.`

Suggested unit test:

- Extract provider command construction from `electron/ai/cliAdapters.ts`.
- Assert Codex provider uses `codex exec --skip-git-repo-check -`.
- Assert the provider attempts to use the project/workspace cwd when available, while still carrying the trust bypass for packaged/AppData runs.
- Assert the cwd discovery strategy is documented in the test or helper name, so future implementers know whether it came from app root, environment override, or persisted workspace path.
- Assert prompt still goes through stdin, not shell interpolation.

Suggested smoke action: `ai-provider-command-regression`

Steps:

1. Use a fake Codex executable or command hook that records argv/cwd.
2. Select Codex provider.
3. Trigger research mode.
4. Assert argv contains the trust bypass or cwd is the trusted project root.
5. Assert a simulated trusted-directory error maps to Korean helper text.

### T5. Claude Research Capability Message

Purpose: make "no web search" honest and actionable.

Steps:

1. Select Claude provider.
2. Trigger `리서치 메모` with a topic that needs current facts.
3. Simulate or capture a provider response that says web search is unavailable.
4. Assert the UI shows `웹검색 미확인` or `최신성 검증 필요`.
5. Assert no `카드에 적용` button appears.

### T6. AI Preset Composer Behavior

Purpose: ensure preset buttons no longer replace the user's input with hidden system prompts.

Suggested smoke action: `ai-workflow-regression`

Steps:

1. Open Pro AI drawer.
2. Type `AI 업무 자동화` into the main AI input.
3. Click `주제 찾기`.
4. Assert the input is not replaced with a long instruction prompt.
5. Assert the thread shows a user-facing action label/result, not the full internal prompt.
6. Assert a next-step action such as `이 주제로 리서치` appears.
7. Click `새 대화` and assert composer, thread, selected workflow context, internal prompt/debug state, detected draft state, and next-step actions are cleared.

### T7. AI Topic -> Research -> Draft Path

Purpose: make the next-step workflow obvious.

Steps:

1. In mock AI mode, click `주제 찾기`.
2. From the topic result, click `이 주제로 리서치`.
3. Assert research output appears with no apply button.
4. Click `이 리서치로 대본 만들기`.
5. Assert draft output shows `카드 N장 감지` and `카드에 적용`.
6. Apply draft and assert card content changes.

### T8. AI Mode Isolation

Purpose: prevent previous prompts/results from contaminating later calls.

Unit/smoke:

1. Send a research prompt.
2. Then send an image prompt.
3. Assert the second provider call does not include the previous full research instruction unless an explicit "대화 이어서 보내기" option is enabled.
4. Assert `sendAiMessage()` or its replacement uses mode-scoped messages by default.

### T9. Lite Edition Regression

Purpose: common fixes ship to Lite; Pro provider execution remains absent.

Commands:

```powershell
npm run build:lite
node scripts/verify-edition.mjs --edition lite
$env:CARDNEWS_SMOKE_ACTION='edition-lite-regression'; node node_modules/electron/cli.js .
```

Assertions:

- Title/subtitle whitespace preservation works in Lite where the content editor exists.
- Right inspector lower-scroll layout does not show the white-panel defect.
- AI provider execution code and Pro-only AI workflow controls are stripped or locked.
- No Codex/Claude provider invocation path is callable from Lite.

## 3. Manual QA Checklist

Save evidence under `.omc/evidence/v6/m10-ai-workflow-input-layout/`.

- `01-title-space-newline-preserved.png` or smoke log.
- `02-inspector-design-bottom-1365x768.png`.
- `03-inspector-design-bottom-1920x1080.png`.
- `04-inspector-design-bottom-2560x1440.png`.
- `05-codex-provider-no-trusted-directory-error.png`.
- `06-claude-research-capability-note.png`.
- `07-ai-topic-next-step-actions.png`.
- `08-ai-research-to-draft-path.png`.
- `09-lite-verify-edition.log`.

## 4. Stop Conditions

Do not proceed to packaging or mark M10 complete if:

- Title input still drops trailing spaces or Enter at cursor end.
- The right inspector still shows the attached white-panel defect at any required viewport.
- Codex provider still exposes the raw trusted-directory error in normal use.
- Claude research still appears to promise live web search when unavailable.
- Preset buttons still put generated system instructions into the main composer.
- Lite stripping or Lite smoke fails.
