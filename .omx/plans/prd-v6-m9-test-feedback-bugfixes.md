# PRD: V6 M9 Test Feedback Bugfixes

Status: RALPLAN approved, Architect ITERATE feedback applied, Critic APPROVE
Date: 2026-07-08
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Context snapshot: `.omx/context/cardnews-v6-m9-bugfix-context-20260708T123229Z.md`

## 1. Goal

Fix the eight user-reported QA defects from the current V6 test build before creating a new release EXE. The fixes must apply to both editions where the feature is shared, and must preserve Lite/Pro separation for Pro-only image and AI features.

## 2. RALPLAN-DR Summary

### Principles

1. User-visible text is the source of truth: when a user types `@`, lowercase, spaces, or line breaks, the app should preserve that intent unless a control explicitly says otherwise.
2. Controls must be semantic. Normal users should choose page formats such as `1/N`, not edit internal token strings.
3. Smoke and test assets must never pollute the real user image library.
4. Lite must receive common bug fixes, while Pro-only features must remain stripped or locked in Lite.
5. AI output is data to parse, never something to execute. Research/image prompts must not masquerade as deck templates.

### Decision Drivers

- The reported defects block real manual QA before packaging.
- Some defects contradict older V6 assumptions, especially footer `@` stripping.
- Existing M7/M8 work introduced useful surfaces but needs regression hardening.
- Verification must catch both UI regressions and edition leakage.

### Options Considered

- Recommended: targeted fixes across App UI, render template, storage normalization, image library hygiene, AI mode handling, and smokes.
- Rejected: broad rewrite of the inspector/editor state architecture. It may help long-term but is too risky before EXE packaging.
- Rejected: reverting M7/M8 image picker and AI panel. The user wants those features, but corrected.

## 3. Scope

### In Scope

- Right panel clipping and scroll/height behavior.
- Footer terminology and `@` preservation.
- Page number format dropdown with five presets.
- Responsive title/subtitle/content input.
- Badge typed-case preservation.
- Image badge and next-hint picker hygiene.
- Background-removal tolerance behavior/debuggability.
- AI preset mode correctness.
- Lite/Pro regression verification and updated edition tests.

### Out of Scope

- New AI providers or external web research integration.
- ML/ONNX background removal. Color/flood-fill removal may be improved, but adding a model is not required.
- Full inspector component rewrite.
- New release EXE packaging. This PRD is for fixing and testing before packaging.

## 4. Edition Matrix Impact

| Item | Lite | Pro | Notes |
| --- | --- | --- | --- |
| Inspector clipping fix | Yes | Yes | Shared shell/layout bug. |
| Footer label/value behavior | Yes | Yes | Topbar/common deck text. |
| Page format dropdown | Locked if chrome styling is locked; common display text can still be fixed | Yes | Pro owns page-number styling controls. |
| Typing responsiveness | Yes | Yes | Content editing is shared. |
| Badge case preservation | Yes if badge content appears in Lite styles | Yes | Rendering path is shared. |
| Image badge picker/removal | Locked/no Pro API | Yes | Verify stripped from Lite. |
| Next-hint image picker | Locked/no Pro API | Yes | Verify stripped from Lite. |
| AI preset behavior | Locked/no Pro API | Yes | Lite button may show locked guidance only. |

## 5. Requirements

### R1. Right Panel Clipping

Problem: The white control panel/card is clipped near the bottom at common desktop heights.

Requirements:
- The right inspector must have a stable viewport-bound layout with a scrollable inner area.
- Bottom controls such as "카드 추가" and "이 카드 삭제" must remain reachable at 1365x768, 1920x1080, and 2560x1440.
- No panel/card should visually cut off rounded corners or create a floating white box over unrelated controls.

Acceptance:
- Playwright/Electron screenshot at 1365x768 shows the full panel with no clipped container.
- Manual scroll reaches the bottom of the design controls.
- Lite and Pro shells both pass the layout check.

### R2. Footer Terminology and `@` Preservation

Problem: UI says "멘션", but the user wants one term, "푸터". The app strips a typed leading `@`.

Requirements:
- Rename user-facing "멘션" labels to "푸터" in topbar, inspector, generated template guidance, AI prompt text, and smoke selectors where user-facing.
- Keep backward compatibility in import/parsing: existing `멘션:` labels must still import as footer.
- Preserve footer display text exactly enough for user intent: `@kkongdon_story` renders with `@`; `kkongdon_story` renders without `@`.
- Keep the existing persisted/domain field name `footerAccount` for this bugfix, but redefine its semantics as "footer display text". Do not rename the schema to `footerText` in this pass.
- Derive social URLs separately with `normalizeThreadsHandle()`, stripping `@` only for URL building.
- Update storage/tests so typed display value is not forcibly stripped at `DeckDraft`, `Deck`, `WorkspaceState`, `DeckPreset`, export/import, or render boundaries.
- Update old tests/smokes that intentionally expected stripping:
  - `src/storage/deckStore.test.ts` footer normalization cases.
  - `electron/main.ts` smoke assertions around saved deck footer behavior.
  - `electron/main.ts` UI selectors or status text that search for `멘션`.

Acceptance:
- Entering `@kkongdon_story` in the topbar renders `@kkongdon_story` in preview and PNG.
- Saving and reopening a workspace preserves the same footer display text.
- Old files containing `멘션: kkongdon_story` still load.
- UI no longer shows "멘션" for this field.
- A unit or integration test proves `@kkongdon_story` survives `buildDeckFromDraft()`/workspace normalization and reaches `buildCardHtml()` output.

ADR:
- Supersede V6 §0.1 old "footerAccount without @" invariant for display text.
- New invariant: `footerAccount` remains the persisted field name but now preserves display value; social handle normalization is a derived helper only.
- Rationale: a full schema rename to `footerText` is cleaner but touches `DeckDraft`, `Deck`, `WorkspaceState`, `DeckPreset`, archives, and Lite stripping immediately before packaging. Preserve the shipped field name now and consider a schema rename after release.

### R3. Page Number Format Dropdown

Problem: Raw token syntax `{n} / {total}` is not intuitive.

Requirements:
- Replace the primary raw input with a dropdown of five presets:
  - `1 / N` -> `{n} / {total}`
  - `1/N` -> `{n}/{total}`
  - `1-N` -> `{n}-{total}`
  - `01 / N` -> `{n2} / {total}`
  - `1장 / N장` -> `{n}장 / {total}장`
- Show a read-only preview example for the current card, e.g. `1 / 10`.
- Optional custom mode may exist behind an advanced disclosure, but the default path must be dropdown-only.
- Invalid custom templates must not break rendering.

Acceptance:
- Selecting each preset updates preview and generated HTML.
- Stored `chrome.pageNumber.template` remains backward compatible.
- Lite does not expose Pro-only chrome styling controls if edition stripping says it should not.

### R4. Content Input Responsiveness and Badge Case

Problem: Title/subtitle typing feels delayed or swallowed. Badge text is forced uppercase.

Requirements:
- Add a targeted typing-latency fix for structured content fields.
- Keystrokes, spaces, and IME composition must update the input immediately and must not be lost.
- Expensive preview/deck serialization can be debounced, but the active textarea value cannot be delayed.
- Remove forced uppercase from badge rendering by default.
- If uppercase styling remains useful, expose it later as an explicit style option, not as hidden default behavior.

Acceptance:
- A smoke test types a sentence with spaces into title/subtitle and verifies the exact value is retained.
- Manual rapid typing no longer feels blocked by preview rerender.
- Badge input `KKONGDON cardnews` renders as `KKONGDON cardnews`, not `KKONGDON CARDNEWS`.

### R5. Image Picker Hygiene for Badge and Next-Hint

Problem: The picker displays unusable smoke/test/generated intermediate images such as `badge-smoke-source`, `next-hint-smoke`, and repeated no-bg artifacts.

Requirements:
- Identify where smoke images are registered and stop writing them to the normal user library.
- Move smoke/test assets to an isolated temp/userData test namespace or delete them after smoke completion.
- Hide diagnostic/internal assets from production image picker if legacy files already exist.
- Image picker entries must show useful display names and thumbnails only.
- Badge image picker, next-hint picker, and image-layer picker must share the same filtering rules.

Acceptance:
- Fresh smoke run does not add `badge-smoke-*` or `next-hint-smoke*` to the production picker.
- Existing polluted libraries no longer show these internal assets.
- Selecting a real imported image updates the relevant preview and HTML source.

### R6. Background Removal Tolerance Behavior

Problem: Moving the "누끼 허용치" slider appears to do nothing.

Requirements:
- First diagnose whether the slider is supposed to affect current preview, next removal action, or already-created no-bg assets.
- Make the behavior explicit:
  - Preferred: changing tolerance re-runs a live removal preview for the selected image, with debounce.
  - Acceptable fallback: label the control as "다음 배경 제거에 적용" and show the effective value in the modal action.
- The saved no-bg result must include enough metadata or display name to tell which tolerance created it.
- Do not pile up indistinguishable duplicate no-bg assets in the picker.

Acceptance:
- Two tolerance values produce visibly different output for a synthetic edge test image, or the UI clearly communicates why not.
- Applying a new tolerance updates the selected preview/result without requiring the user to guess.
- Unit tests cover the pure background removal tolerance path.

### R7. Next-Hint Image Control

Problem: Next-hint image selection has the same bad image problem and tiny/incorrect rendered result.

Requirements:
- Use the cleaned shared image picker.
- Add clear controls for "기본 화살표", "이미지", and "없음".
- When image mode is selected, render a usable size by default and make the height slider visibly affect output.
- Preserve last-card hiding rules.

Acceptance:
- A real image selected as next hint appears in preview/PNG at the chosen height.
- Last card still hides the next-hint indicator.
- No internal smoke image appears in the picker.

### R8. AI Preset Mode Correctness

Problem: Research, draft, and image buttons can produce confusing output. Research/image responses may show deck detection/apply affordances.

Requirements:
- Make preset chips mode-strict:
  - Research returns evidence/context only and must not be auto-detected as a deck unless it contains a complete valid deck block.
  - Draft returns a valid `양식.md` deck and can show "카드 N장 감지".
  - Image returns image prompt candidates, no deck apply button by default.
- Update mock AI mode so it is preset-aware, or clearly force draft mode only in tests that expect a draft.
- Harden `extractTemplateDocument()` so it detects real deck templates, not arbitrary text containing words like "역할" or "요청".
- Keep provider execution allowlisted and parse-only.

Acceptance:
- Clicking Research then sending a prompt shows a research-style assistant response with no "카드에 적용" button.
- Clicking Image then sending a prompt shows prompt candidates with no "카드에 적용" button.
- Clicking Draft shows a detected deck and applies correctly.
- Lite shows locked AI guidance and contains no Pro provider execution path.

## 6. Implementation Order

1. Add failing regression tests/smokes for footer `@`, badge case, page dropdown, typing preservation, image picker filtering, and AI preset modes.
2. Fix common layout/footer/page/content/badge issues.
3. Fix Pro image picker hygiene and background-removal tolerance.
4. Fix Pro AI preset behavior.
5. Run edition verification and update smoke names/selectors after terminology changes.
6. Update `HANDOFF.md` with evidence and any remaining risks.

## 7. Required Files Likely to Change

- `src/ui/App.tsx`
- `src/render-engine/cardTemplate.ts`
- `src/domain/chromeConfig.ts`
- `src/storage/deckStore.ts`
- `src/domain/deckImporter.ts`
- `src/edition/lite/index.tsx`
- `src/edition/pro/ai/aiPrompts.ts`
- `electron/main.ts`
- `scripts/*smoke*.mjs`
- `src/**/*.test.ts`

## 8. Risks

- Footer `@` behavior intentionally changes an old invariant. Tests and compatibility notes must be updated together.
- Typing responsiveness can be harmed if the fix only debounces state saves while still rebuilding preview synchronously.
- Image-library filtering must not hide legitimate user files that happen to contain similar words. Use explicit metadata where possible, filename fallback only for legacy cleanup.
- AI mock changes can break existing deterministic smokes if those smokes assume every first response is a draft.

## 9. Completion Definition

This bugfix PRD is done when:
- All R1-R8 acceptance criteria pass.
- Lite verification proves Pro image/AI APIs are absent or locked.
- Pro manual QA covers the eight screenshots' scenarios.
- `HANDOFF.md` records commands, evidence paths, and remaining known gaps.
- No release EXE is created until the user approves packaging after test review.
