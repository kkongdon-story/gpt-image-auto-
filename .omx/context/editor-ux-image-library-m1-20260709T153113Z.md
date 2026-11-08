# Context Snapshot: Editor UX + Image Library M1 Addendum

Timestamp: 2026-07-09T15:31:13Z

Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

## User Request

The user invoked `$ralplan` and asked to add/modify M1 requirements:

1. Typography text color does not change except emphasis. When text is dragged/selected, an inline toolbar with color, size, italic, etc. would make editing easier.
2. Stored images pile up and duplicate names make previous images hard to find. Add a way to manage/remove stored images.
3. Template management buttons have awkward blank gaps. Fix layout.
4. Layer buttons also have awkward blank gaps. Fix layout.
5. Debug related functions.

Screenshots show:

- Card preview where title text selection/highlight is visible, but normal typography color is not controllable.
- Image dropdown with many duplicate `card-01-clean.png` entries.
- `양식 관리` buttons wrapping with uneven gaps.
- `레이어` action buttons wrapping as `텍스트 박스 / 모형 / 선` plus orphaned `이미지`.

## Current Implementation Findings

### Typography

- `src/domain/types.ts` defines `CardTypographyOverride` with:
  - `sizeScale`
  - `weight`
  - `italic`
  - `letterSpacing`
  - `lineHeight`
  - `scope`
- It does not define a normal text `color` field.
- `CardTextBoxLayer` already supports `color`, `fontSize`, `fontWeight`, `italic`, and `align`, so text layers and generated card typography have inconsistent editing surfaces.
- `src/ui/App.tsx` has `updateSelectedTypography(field, value)` limited to size/weight/italic/letterSpacing/lineHeight/scope.
- `src/render-engine/cardTemplate.ts` resolves text colors from style preset variables:
  - `--ink-title`
  - `--ink-body`
  - `--ink-muted`
  - emphasis uses accent and is separate.

Conclusion: the bug is structural, not just UI. Typography override needs a color contract and renderer support.

### Image Library

- `src/storage/deckStore.ts` supports:
  - `listBackgroundLibrary`
  - `addBackgroundToLibrary`
  - `findLibraryBackground`
  - `listImageLibrary`
  - `addImageToLibrary`
  - `saveImageBufferToLibrary`
  - `findLibraryImage`
- There is no user-facing delete/remove library image API.
- Smoke-fixture purge exists, but it only targets internal test assets and does not solve real user image buildup.
- `src/ui/App.tsx` image picker supports selecting, adding files, previews, and background removal. It does not support asset deletion/cleanup.

Conclusion: add explicit user asset management rather than overloading background-removal.

### Button Layout

- `src/ui/App.tsx` uses generic `.row` containers for unrelated inspector action groups:
  - layer add buttons
  - template management buttons
  - project/bulk/export actions
- The screenshots' blank gaps are consistent with row wrapping and unequal button width.

Conclusion: introduce scoped action-grid/action-bar classes for inspector controls instead of relying on generic `.row`.

## Related Existing Plans

- M13 clarified template pack/GPTs workflow and fixed next-hint typography grouping.
- M14 fixed GPTs link planning exists and is separate from this M1 addendum.
- This M1 addendum should not package EXEs. It should only plan implementation and tests.

## Constraints

- Apply to Lite and Pro unless a feature is explicitly Pro-only.
- Since the user recently decided Lite should open design/content controls and only block AI/bulk/project-style Pro features, these editor fixes are shared Lite/Pro behavior.
- Do not add new dependencies for this M1.
- Do not change template-pack ZIP schema unless needed for image-library reference safety.
- Do not implement rich per-character text editing in M1 unless current architecture already supports it. Use a floating selected-control toolbar for selected text layer or selected typography scope first.

## Implementation Surfaces To Inspect During Execution

- `src/domain/types.ts`
- `src/render-engine/cardTemplate.ts`
- `src/storage/deckStore.ts`
- `electron/main.ts`
- `electron/lite-main.ts`
- `src/edition/lite/index.tsx`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `src/ui/m13UiContract.test.ts`
- `src/storage/deckStore.test.ts`
- `scripts/verify-edition.mjs`
