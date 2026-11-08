# PRD: V6 M10 AI Workflow, Input, and Layout Follow-up

Status: RALPLAN approved; Architect APPROVE, Critic APPROVE
Date: 2026-07-09
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Context snapshot: `.omx/context/cardnews-v6-m10-ai-workflow-input-layout-context-20260708T173131Z.md`

## 1. Goal

Fix the second-round Pro QA defects before release packaging: title end-cursor whitespace/newline loss, remaining right inspector white-panel layout breakage, provider-specific AI failures, and the confusing AI preset workflow. Shared bugs must be corrected in both Lite and Pro, while provider execution and AI workflow remain Pro-only.

## 2. RALPLAN-DR Summary

### Principles

1. Text inputs preserve user keystrokes first; rendering/serialization adapts later.
2. User-facing AI controls should expose intent and next action, not internal prompt text.
3. Provider errors must become actionable Korean UI states, not raw CLI confusion.
4. Common editor/layout fixes ship to Lite and Pro; AI provider execution stays Pro-only.
5. Verification must reproduce the user's exact manual failure paths before claiming completion.

### Decision Drivers

- The defects block manual testing before EXE packaging.
- The AI panel currently mixes prompt authoring, chat history, and workflow steps into one field.
- Codex/Claude provider behavior depends on local CLI permissions, so the app needs defensive command setup and clear capability messaging.

### Viable Options

1. Recommended: targeted M10 bugfix pass with mode-aware AI workflow state.
   - Pros: fixes the reported issues without destabilizing V6 M9, gives the user a clearer Pro test path, and adds regressions for known failures.
   - Cons: touches `App.tsx` AI state and smoke tests, so careful sequencing is required.
2. Minimal patch: add Codex flag, tweak CSS, and leave AI UX mostly unchanged.
   - Pros: faster.
   - Cons: does not solve the user's main confusion about what to input/click after presets.
3. Full AI panel rewrite.
   - Pros: cleanest long-term model.
   - Cons: too broad before packaging and likely to re-break Pro/Lite stripping.

Decision: choose Option 1.

## 3. Scope

### In Scope

- Preserve title and subtitle trailing spaces/newlines while editing.
- Fix remaining right inspector white panel/background/scroll issue in `콘텐츠 -> 디자인`.
- Make Codex provider run from a safe local context or include the required `--skip-git-repo-check` flag.
- Make Claude research capability honest when live web search is unavailable.
- Redesign the Pro AI preset workflow so the main input is for user content/conversation, not generated prompts.
- Prevent prior preset prompts/results from contaminating the next mode by default.
- Update Pro and Lite verification gates.

### Out of Scope

- EXE packaging.
- Adding a paid web-search API.
- Replacing Claude/Codex CLI providers with a new provider.
- Full editor architecture rewrite.
- Changing the V6 Lite/Pro matrix.

## 4. Edition Matrix Impact

| Requirement | Lite | Pro | Notes |
| --- | --- | --- | --- |
| Title whitespace/newline preservation | Yes | Yes | Shared content editor behavior. |
| Right inspector layout fix | Yes | Yes | Shared shell/layout CSS unless the control is Pro-only. |
| Codex provider trust fix | No provider execution | Yes | Lite must not include executable provider path. |
| Claude web-search messaging | Locked/no provider execution | Yes | Pro UI only. |
| AI workflow redesign | Locked guidance only | Yes | Pro-only drawer/action flow. |

## 5. Requirements

### R1. Title End-Cursor Space and Newline Preservation

Problem: When the cursor is at the end of the title field, pressing Space or Enter appears to be ignored or swallowed.

Requirements:

- The active title textarea value must update immediately for trailing spaces, Enter/newline, and Korean IME composition.
- The active textarea value must be tested before blur/save; persistence may normalize only through documented render-safe boundaries, never while the user is still typing.
- The subtitle field should receive the same protection if it shares the same normalization path.
- Do not trim, collapse, or parse-normalize structured field values on every keystroke.
- If raw card serialization uses `|` as the title line-break convention, map textarea newlines to that convention only at the serialization/render boundary.
- Preview updates may be debounced, but the DOM input value must not lag or drop characters.

Acceptance:

- Typing at the end of title preserves `끝 `, `끝\n`, and `끝\n다음줄` exactly in the textarea.
- Preview settles within 500ms after typing stops.
- Saving/reloading the deck does not lose intentional line breaks; implementation evidence must include this save/reload path, not only active DOM evidence.

### R2. Content Design Inspector White Panel/Scroll Fix

Problem: In `콘텐츠 -> 디자인`, scrolling down still shows an abnormal white control-panel region and the side panel looks visually broken.

Requirements:

- Treat the right inspector as one stable viewport-bound shell with a single intentional scroll area.
- The implementation must target the nested `콘텐츠 -> 디자인` lower-control path specifically, including the `레이어` area and bottom action buttons, not only the top-level inspector scroll.
- Lower controls must not float over or outside a clipped white panel.
- Rounded panel backgrounds must extend to their content or be removed in favor of full-height section backgrounds.
- Verify at 1365x768, 1920x1080, and 2560x1440.

Acceptance:

- The exact `콘텐츠 -> 디자인` lower-scroll path no longer shows a clipped/floating white region.
- Bottom controls are reachable without visual overlap.
- Screenshots are saved under `.omc/evidence/v6/m10-ai-workflow-input-layout/`.

### R3. Codex Provider Trusted Directory Fix

Problem: Codex selected in the AI research tab returns `Not inside a trusted directory and --skip-git-repo-check was not specified.`

Requirements:

- Update the Codex CLI invocation so packaged/dev app calls do not fail only because the working directory is AppData or another untrusted non-git folder.
- Preferred implementation: construct Codex provider commands through a testable command builder, include `--skip-git-repo-check` for `codex exec -`, and choose the project/workspace cwd when available. The flag is still required because packaged runs may execute from AppData or another non-git folder.
- The implementation must define how project/workspace cwd is discovered before coding the builder, for example via packaged app root, explicit environment override, or a persisted workspace path fallback.
- Preserve command allowlisting and stdin-only prompt passing.
- Map remaining trusted-directory errors to Korean recovery text.

Acceptance:

- A unit test or smoke fake-provider assertion proves Codex command includes the trust bypass or uses a trusted cwd.
- Live/manual Pro QA no longer shows the raw trusted-directory error for normal use.
- Lite stripping confirms Codex provider execution is absent from Lite.

### R4. Claude Research Capability Messaging

Problem: Claude research says it cannot web search and writes from training data, conflicting with the user's expectation of research.

Requirements:

- Do not promise live web research for providers that cannot prove web access.
- In Pro AI research mode, show provider capability guidance before/with the result:
  - Codex/Claude CLI may not have web access depending on local setup.
  - If web search is unavailable, output must be marked as "최신성 검증 필요".
- Research mode should encourage the user to paste URLs, source text, or notes into the input when live search is unavailable.
- The fallback should be visible as product state, not buried inside the assistant's prose.

Acceptance:

- Claude research result with no web capability shows a clear Korean badge/note such as `웹검색 미확인 · 최신성 검증 필요`.
- Research output does not show `카드에 적용` unless it contains a complete valid deck template.

### R5. AI Preset Workflow Redesign

Problem: Preset buttons generate a long instruction into the same input box, the input remains polluted, the result panel shows topic text, and the user cannot tell the next step.

Requirements:

- Rename/action-label preset buttons around workflow intent:
  - `주제 찾기`
  - `리서치 메모`
  - `카드 대본 만들기`
  - `이미지 프롬프트`
- The main AI input must be labeled/placeholdered as user content, e.g. `주제, 대화 내용, 원문, 참고 메모를 입력하세요.`
- Clicking a preset action must send an internal prompt directly; it must not replace the composer contents with the generated prompt.
- Store internal generated prompts separately for optional debug/copy affordance only.
- Default preset calls must not include the previous 12 chat messages. They should be mode-scoped single calls unless the user explicitly chooses "대화 이어서 보내기".
- After a topic result, show next-step actions such as:
  - `이 주제로 리서치`
  - `이 주제로 대본 만들기`
  - `입력창에 넣기`
- After a research result, show `이 리서치로 대본 만들기`.
- After a draft result, show `카드에 적용`.
- `새 대화` clears thread, selected mode/context, pending draft detection, and composer state.
- `새 대화` also clears internal prompt/debug state and next-step actions so old preset context cannot leak into the next request.

Acceptance:

- Clicking `주제 찾기` with input `AI 자동화` sends a topic request and does not replace the composer with a long system prompt.
- The user can proceed from topic -> research -> draft using visible next-step buttons.
- Draft detection/apply only appears for draft-valid output.
- Image prompt and research outputs do not show deck apply affordances by default.

## 6. Implementation Order

1. Add failing tests/smokes for R1-R5.
2. Fix R1 input preservation with the smallest normalization-boundary change.
3. Fix R2 inspector layout CSS and screenshot evidence path.
4. Extract/test provider command construction, then fix R3/R4 provider behavior and messages.
5. Refactor Pro AI preset state/actions for R5.
6. Run full Pro and Lite verification gates and update `HANDOFF.md` with evidence.

## 7. ADR

Decision: Implement a targeted M10 bugfix pass with mode-aware AI workflow state and provider hardening.

Drivers:

- User testing is blocked by concrete UI and AI workflow failures.
- The current AI panel exposes internal prompts as if they were user input.
- Provider execution must be robust in packaged and dev contexts.

Alternatives Considered:

- Minimal symptom patch rejected because it leaves the user confused after preset clicks.
- Full AI panel rewrite rejected because release packaging should not wait on a broad redesign.

Consequences:

- `src/ui/App.tsx` AI state will grow a small workflow model.
- Provider command construction should become unit-testable.
- M10 should create new smoke actions rather than overloading M9 tests.

Follow-ups:

- Later, consider a provider capability registry with explicit web/search support.
- Later, consider a compact AI workflow tour once the product flow stabilizes.

## 8. Available Agent Types and Follow-up Staffing

- `$ultragoal`: recommended default for durable sequential implementation after this plan is approved.
- `$team`: useful if splitting into lanes:
  - Lane A: input preservation and inspector CSS.
  - Lane B: provider command/capability hardening.
  - Lane C: AI workflow UX/state and smokes.
  - Lane D: verification and Lite stripping audit.
- `$ralph`: fallback only if a single persistent owner is preferred over parallel lanes.

Suggested reasoning by lane:

- Input/layout: executor medium + verifier high.
- Provider hardening: debugger high + executor medium.
- AI workflow UX: designer high + executor medium.
- Final gate: verifier high.

## 9. Stop Conditions

Do not move to EXE packaging if:

- Any R1-R5 acceptance criterion is unverified.
- Lite `verify-edition` fails.
- Pro AI smoke still shows prompt-polluted composer behavior.
- Codex provider still shows the raw trusted-directory error in normal Pro QA.
