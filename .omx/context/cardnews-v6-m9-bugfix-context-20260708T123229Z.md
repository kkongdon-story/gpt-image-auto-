# Context Snapshot: V6 M9 Test Feedback Bugfix Plan

Date: 2026-07-08
Root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Workflow: `$ralplan` consensus planning, no implementation in this artifact.

## User-Reported Defects

1. The white inspector/control background is clipped at the bottom of the right panel.
2. Typing `@kkongdon_story` in the mention field renders `kkongdon_story`; the typed `@` is lost.
3. Page number format is exposed as raw token syntax like `{n} / {total}` and is hard to use.
4. Title/subtitle typing feels delayed or dropped, especially spacebar input. Badge text is forced uppercase.
5. The product uses both "멘션" and "푸터"; terminology must be unified as "푸터".
6. Image badge background-removal tolerance does not appear to change the result. The image picker is polluted with unusable smoke/test images.
7. Next-hint image picker has the same unusable image pollution/selection problem.
8. AI panel presets for research, draft, and image return confusing output; non-draft modes can look like a detected `양식.md` deck.

## Current Code Evidence

| Area | Evidence | Planning Implication |
| --- | --- | --- |
| Footer/mention normalization | `src/ui/App.tsx` has `normalizeFooterAccount()` stripping leading `@`. `src/storage/deckStore.ts` also strips leading `@`. Existing tests expect stripping. | User feedback supersedes old visual-display behavior. Split display footer text from social handle normalization. |
| Old V6 invariant conflict | `.omc/plans/v6-lite-pro-prd.md` §0.1 states `footerAccount` is normalized without `@`. | Add ADR: footer display preserves typed text; only derived Threads URL strips `@`. |
| Terminology | Topbar still labels the field as `멘션`; importer accepts `멘션` and `푸터`. | UI/generated templates should say `푸터`; parser keeps backward compatibility for `멘션`. |
| Page number UX | `src/ui/App.tsx` exposes `chromeConfig.pageNumber.template` as a raw input. `src/render-engine/cardTemplate.ts` uses `renderPageNumber()`. | Replace raw input with preset dropdown plus optional custom escape hatch if needed. |
| Badge uppercase | `src/render-engine/cardTemplate.ts` includes `.badge { text-transform: uppercase; }`. | Remove forced uppercase or make it an explicit Pro style option; default preserve typed case. |
| Header/badge uppercase distinction | `.chrome-label` also has `text-transform: uppercase`. | The reported problem is badge case. Header uppercase can remain unless separate feedback asks otherwise. |
| Typing lag | Content textareas call `updateStructuredTitle()` / `updateStructuredOptionalField()` directly on every keystroke while preview/deck derivations rebuild. | Add local draft state or event buffering so keyboard input is immediate and no characters are dropped. |
| Image picker pollution | M7/M8 smoke flows save `badge-smoke-source.png`, `badge-smoke-source-no-bg...`, and `next-hint-smoke.png` into the visible image library. | Smoke/test assets must use isolated storage or be hidden/cleaned from the production picker. |
| Background removal tolerance | A shared slider updates `backgroundRemovalTolerance`; actual removal is a separate modal action, so changing the slider after generated no-bg assets may not reprocess anything. | Make tolerance action explicit, re-run preview/result when tolerance changes, or label it as affecting the next removal only. |
| AI mode confusion | `buildResearchPrompt()`, `buildDraftPrompt()`, `buildImagePrompt()` exist, but mock/detection paths can still produce/apply draft blocks broadly. | Make preset modes strict. Only draft mode should trigger `양식.md` application affordance unless a valid deck block is truly detected. |
| Lite/Pro boundary | `src/edition/lite/index.tsx` locks image and AI APIs. | Common UI bugs apply to Lite. Pro-only image/AI fixes must not leak into Lite bundle or API surface. |

## Planning Constraints

- Preserve the single render contract: preview and PNG must still use the same `buildCardHtml()` path.
- Keep Lite/Pro matrix intact. Ambiguous new capabilities default to Pro.
- Do not weaken styleSafety, render gates, or edition stripping verification.
- Bug fixes must be test-first where practical, especially normalization, formatting, AI detection, and image-library filtering.
- Implementation should not create new dependencies unless a later executor proves built-in APIs cannot cover the fix.

