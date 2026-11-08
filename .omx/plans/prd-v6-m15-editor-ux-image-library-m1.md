# PRD: V6 M15 Editor UX + Image Library M1 Addendum

## 1. Goal

Fix the M1 editor UX gaps reported by the user:

- normal typography text color must be editable, not only emphasis/badge colors;
- selected text/layer editing should be faster through an inline toolbar;
- accumulated image assets must be manageable and removable;
- inspector button groups must stop leaving awkward blank gaps;
- related editor functions must be regression-checked in both Lite and Pro.

This is a planning artifact only. Do not implement or package EXEs from this PRD unless a follow-up execution command explicitly asks for it.

## 2. Product Scope

These changes are shared editor capabilities.

Lite and Pro should both receive:

- content/design tab access;
- typography color controls;
- selected text/layer inline toolbar;
- image library browsing and safe deletion;
- inspector button layout fixes.

Pro-only boundaries remain:

- AI provider/chat workflows;
- bulk CSV generation;
- project archive save/open if still classified Pro;
- any future remote/image-generation automation.

## 3. Non-Goals

- Do not add EXE packaging to this milestone.
- Do not introduce new dependencies.
- Do not build full rich-text per-character styling in M1.
- Do not let arbitrary text selection mutate only part of a generated title/body unless the renderer has an explicit span model.
- Do not delete images silently when they are referenced by the current deck, badge, next hint, or image layers.
- Do not change the GPTs shortcut URL work from M14.

## 4. RALPLAN-DR Summary

### Principles

1. Shared editor usability belongs to both Lite and Pro.
2. Typography color must be stored in the same override model that type/weight/size already use.
3. Text layer editing and generated card typography are related but not identical; the UI should make the active target clear.
4. Asset deletion must be safe, reversible where possible, and reference-aware.
5. Button layout should be deterministic at common inspector widths.

### Decision Drivers

1. User pain is visual and immediate: color changes, selection toolbar, image clutter, and button gaps.
2. Existing architecture already has card-level overrides and layer-level overrides.
3. Image assets live in app userData; delete behavior must not break existing decks.
4. Lite/Pro separation has recently moved toward shared design/content tools.

### Chosen Approach

Use a conservative M1 implementation:

- Add typography `color` to the card typography override model and renderer.
- Expose the same typography actions through the side panel and a floating selection toolbar.
- For text layers, the toolbar edits the selected layer directly.
- For generated title/body text, the toolbar edits the selected card typography override using the current `scope`.
- Add image-library delete/management APIs with reference checks.
- Replace generic `.row` button groups in the affected inspector sections with scoped action grids.

## 5. Functional Requirements

### R1. Typography color override

Add normal text color support to card typography overrides.

Recommended type change:

- `src/domain/types.ts`
- Add `color?: string` to `CardTypographyOverride`.

Renderer behavior:

- `scope: "all"` applies the color to title and body text variables.
- `scope: "title"` applies it to `--ink-title` only.
- `scope: "body"` applies it to body text variables only.
- Badge text color remains controlled by `CardBadgeOverride.textColor`.
- Emphasis highlight remains controlled by accent/emphasis behavior.
- Chrome header/footer/page number colors remain controlled by chrome settings.

Acceptance:

- Changing typography color updates title/body preview immediately according to scope.
- The same color appears in generated HTML/PNG output.
- The color persists after save/reload.
- Existing decks without `typography.color` render unchanged.
- Accepted typography colors use normalized `#RRGGBB` hex strings.
- Invalid color strings are rejected or dropped before persistence and never reach CSS unsanitized.
- Color validation ownership is explicit:
  - storage/build paths must sanitize `CardTypographyOverride.color`;
  - renderer paths must also normalize before emitting CSS as a defense-in-depth boundary.

### R2. Typography and text-layer inline toolbar

Add a compact floating toolbar for the active editable text target.

Target behavior:

- When a text layer is selected, toolbar controls edit that text layer:
  - color
  - font size
  - weight
  - italic
  - alignment
- When generated card title/body text is selected or the current card typography area is active, toolbar controls edit `selectedOverride.typography`:
  - color
  - size scale
  - weight
  - italic
  - scope
- The toolbar should be positioned near the selection or near the top of the active card preview without blocking the selected text.

M1 boundary:

- Do not promise per-character rich text styling.
- The toolbar changes the selected layer or current card typography scope.

Acceptance:

- Toolbar appears only in edit/design mode or when an editable text target is active.
- Toolbar does not permanently cover the card.
- Toolbar controls stay synchronized with side-panel controls.
- Toolbar works with keyboard focus and pointer use.
- Toolbar is hidden when clicking outside an editable target.
- Lite and Pro show the same toolbar for shared editor targets.

### R3. Image library management

Add a user-facing way to manage stored image assets.

Required behaviors:

- Show image assets with thumbnail, display name, and a stable hint such as added order/date/id suffix when names duplicate.
- Add search/filter for long lists.
- Add a delete/remove action for selected images.
- Add reference-aware guard:
  - if the selected image is used by badge image, next-hint image, or an image layer in the current deck, block deletion and explain where it is used;
  - or require an explicit "detach and delete" action if implementation chooses to support it.
- Remove stale preview cache entries after delete.
- Refresh the picker list after delete.

Recommended storage changes:

- Add `removeImageFromLibrary(storageRoot, imageId)` to `src/storage/deckStore.ts`.
- Consider `removeBackgroundFromLibrary(storageRoot, backgroundId)` for parity if the picker is also used for backgrounds.
- Wire IPC/preload/edition wrappers for Lite and Pro.
- Add the shared API surface to `LiteCardnewsApi`, not only `ProCardnewsApi`, because this is a shared editor capability.
- Required API wiring:
  - `src/domain/cardnews-api.ts`
  - `electron/preload.cts`
  - `electron/preload-lite.cts`
  - `electron/main.ts`
  - `electron/lite-main.ts`
  - `src/edition/lite/index.tsx`
  - `src/edition/pro/index.tsx`

Reference-safety boundary:

- Storage owns low-level deletion only: remove index entry and physical file by image id.
- UI/domain owns current-workspace reference checks before calling low-level deletion.
- Reference checks must inspect at least:
  - selected/current card badge image id;
  - deck-level next hint image id;
  - all current card image layers;
  - any other image references present in the current `DeckDraft`/override map.
- If an implementation supports "detach and delete", detaching must update the current unsaved editor state first, then call low-level deletion. Otherwise deletion must be blocked with a clear message.

Acceptance:

- User can delete an unused image from the library.
- The physical file and JSON index entry are removed.
- The UI list refreshes without app restart.
- Referenced images are protected or explicitly detached.
- Duplicate display names are distinguishable in the UI.
- Smoke/test fixture purge remains independent from user deletion.

### R4. Template management button layout

Fix the `양식 관리` control group layout.

Acceptance:

- Main select is full width.
- Save name input and save/delete buttons form a predictable grid or action bar.
- Import/export/load buttons align consistently.
- No large blank gap appears at inspector widths 280px to 420px.
- Korean and English names do not overflow the panel.

### R5. Layer action button layout

Fix the `레이어` action buttons.

Acceptance:

- `텍스트 박스`, `모형`, `선`, `이미지` use a stable 2x2 or 4-column responsive action grid.
- No orphaned `이미지` button appears on its own line unless the panel is extremely narrow.
- Button heights and widths are consistent.
- Labels fit without clipping.

### R6. Related editor debug sweep

After implementing R1-R5, run a focused debug sweep of neighboring controls.

Scope:

- typography scope/color/size/weight/italic/letter spacing/line height;
- text layer color/size/weight/italic/alignment;
- badge image height and background-removal tolerance controls;
- next hint image height and grouping;
- line layer angle/resize behavior;
- template pack import image assets;
- Lite/Pro locked feature boundaries.

Acceptance:

- No known regression in preview, PNG render, or saved workspace state.
- Bugs discovered during this sweep should be fixed if they are directly caused by M1 changes.
- Unrelated larger issues should be logged as follow-up, not silently folded into M1.

## 6. UX Requirements

### Toolbar Copy

Recommended toolbar controls:

- `색`
- `크기`
- `굵기`
- `I`
- `왼쪽`
- `가운데`
- `오른쪽`
- `범위`

Use familiar icons where available in the app. If icons are not already available, use compact text labels for M1 and avoid adding an icon dependency.

### Image Management Copy

Recommended labels:

- `이미지 관리`
- `검색`
- `사용 중`
- `선택 삭제`
- `사용 중인 이미지라 삭제할 수 없습니다. 먼저 배지/넘김기호/레이어에서 해제하세요.`

### Button Layout

Use scoped classes, for example:

- `.inspector-action-grid`
- `.inspector-action-grid.two`
- `.inspector-action-grid.four`
- `.inspector-action-bar`

Avoid using generic `.row` for sections with wrapping-sensitive button groups.

## 7. Technical Requirements

### Data Model

- Extend `CardTypographyOverride` with `color?: string`.
- Sanitize/normalize `typography.color` in storage parse/build paths.
- Preserve backward compatibility with old deck JSON.

### Rendering

- Add typography color resolution in `cardTemplate.ts`.
- Generated CSS should use override-aware ink variables or scoped selectors.
- Quality metrics should still collect computed color accurately.

### UI

- Add `updateSelectedTypography("color", value)` support.
- Add side-panel color input/swatches for typography.
- Add floating toolbar state and clear target semantics:
  - target `text-layer` edits `CardTextBoxLayer`;
  - target `card-typography` edits `CardTypographyOverride`;
  - toolbar must show its active target through accessible labels or state.
- Reuse existing `accentSwatches`.
- Avoid selection toolbar causing forced tab changes.

### Storage/API

- Add delete API(s) to storage.
- Wire through Electron main/preload and edition adapters.
- Keep Lite stripping verification green.
- Keep low-level storage deletion free of UI state assumptions.
- Put reference detection in a tested helper near the UI/domain layer so unsaved editor state is protected.

### CSS

- Add scoped action-grid classes.
- Update only affected sections unless a shared `.row` bug is clearly proven.

## 8. Test Requirements

Covered in:

- `.omx/plans/test-spec-v6-m15-editor-ux-image-library-m1.md`

Minimum verification:

- Typecheck
- Storage tests
- Renderer/template tests
- UI contract tests
- Unit/helper tests for current-state image reference detection
- Unit/helper tests for toolbar target semantics where feasible
- Lite stripping verification
- Lite smoke
- Pro smoke
- Manual QA screenshots for toolbar, image delete, and button layout

Evidence convention:

- Store implementation evidence under `.omc/evidence/v6/m15-editor-ux-image-library-m1/`.

## 9. Risks

1. Real per-character text selection is more complex than the current card model.
   - Mitigation: M1 toolbar edits layer/card typography target, not arbitrary spans.
2. Deleting assets could break old workspaces.
   - Mitigation: reference checks and no silent deletion of used assets.
3. Adding typography color can affect contrast gates.
   - Mitigation: run render/quality smoke and preserve default color when unset.
4. Lite/Pro wrappers may drift.
   - Mitigation: shared editor capability tests plus `verify-edition.mjs --edition lite`.

## 10. Suggested Follow-up Command

```text
[$ultrawork]
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m15-editor-ux-image-library-m1.md 와
.omx/plans/test-spec-v6-m15-editor-ux-image-library-m1.md 기준으로 구현해.
타이포그래피 일반 글자색, 선택/텍스트 레이어용 플로팅 툴바, 이미지 라이브러리 삭제/관리,
양식 관리/레이어 버튼 배열을 Lite/Pro 공통으로 수정해.
각 수용 기준과 테스트 스펙을 통과시키고, 증거는 .omc/evidence/v6/m15-editor-ux-image-library-m1/에 남겨.
HANDOFF.md는 append-only로 갱신하고, EXE 패키징은 하지 마.
```

## 11. RALPLAN Consensus Gate

Status: complete.

Planning artifacts:

- Context snapshot: `.omx/context/editor-ux-image-library-m1-20260709T153113Z.md`
- PRD: `.omx/plans/prd-v6-m15-editor-ux-image-library-m1.md`
- Test spec: `.omx/plans/test-spec-v6-m15-editor-ux-image-library-m1.md`
- Architect review: `.omx/plans/review-v6-m15-m1-architect.md`
- Critic review: `.omx/plans/review-v6-m15-m1-critic.md`

Architect review:

- Verdict: ITERATE
- Summary: The plan was directionally sound but needed sharper shared delete API boundaries, two-layer reference-safe deletion, explicit `#RRGGBB` color validation ownership, and stronger automated coverage for image usage detection and toolbar target semantics.
- Result: Required changes were folded into this PRD and the test spec.

Critic review:

- Verdict: APPROVE
- Summary: No blockers remain. The updated plan is executable. The critic flagged only medium scope-creep risk around keeping R6 limited and avoiding EXE packaging, rich-text spans, background-library parity creep, or broad editor redesign.

Consensus decision:

- Proceed to implementation for M1 addendum as a Lite/Pro shared editor fix.
- Implementation must follow T1-T15 evidence in `.omx/plans/test-spec-v6-m15-editor-ux-image-library-m1.md`.
- Referenced image deletion must be blocked unless an explicit detach-and-delete flow is implemented.
- EXE packaging is out of scope.
