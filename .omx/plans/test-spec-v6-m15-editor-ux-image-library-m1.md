# Test Spec: V6 M15 Editor UX + Image Library M1 Addendum

## Scope

Verify shared Lite/Pro editor fixes:

- normal typography color override;
- selected text/layer floating toolbar;
- image library delete/management;
- template management and layer action button layout;
- neighboring editor regressions.

Evidence root:

`.omc/evidence/v6/m15-editor-ux-image-library-m1/`

## T1. Typecheck

Command:

```bash
npm run typecheck
```

Assertions:

- `CardTypographyOverride.color` type is accepted.
- `updateSelectedTypography("color", ...)` typechecks.
- Electron main/preload and Lite/Pro edition wrappers typecheck.
- No stale, untyped image delete API calls remain.

Evidence:

- `typecheck.log`

## T2. Renderer typography color contract

Command:

```bash
npm run test -- src/render-engine/cardTemplate.test.ts
```

If no dedicated renderer test file exists, add or extend the closest renderer/template test.

Assertions:

- Unset typography color renders the same as before.
- `scope: "all"` changes title and body computed color.
- `scope: "title"` changes title only.
- `scope: "body"` changes subtitle/paragraph/bullet only.
- Emphasis and badge text color remain controlled by their own settings.
- Render metrics still report the computed color.

Evidence:

- `renderer-typography-color-test.log`

## T3. Storage and migration contract

Command:

```bash
npm run test -- src/storage/deckStore.test.ts
```

Assertions:

- Saved deck JSON preserves valid `typography.color`.
- Old deck JSON without `typography.color` loads unchanged.
- Valid typography colors are normalized as `#RRGGBB`.
- Invalid typography colors are sanitized/rejected before persistence.
- `removeImageFromLibrary` removes index entry and file for unused images.
- Deleting a missing image returns a controlled result, not an unhandled crash.
- Smoke fixture purge behavior remains unchanged.

Evidence:

- `storage-image-typography-test.log`

## T4. UI contract

Command:

```bash
npm run test -- src/ui/m13UiContract.test.ts
```

Assertions:

- Typography side panel includes a normal text color control.
- Floating toolbar container/role exists.
- Text-layer toolbar controls are distinguishable from card-typography controls.
- Image picker or image management panel exposes search/filter and delete control.
- Template management no longer relies on a generic wrapping `.row` for its main actions.
- Layer add buttons use the new scoped action-grid class.
- Lite locks still apply to AI/bulk/project-only surfaces, not shared editor controls.

Evidence:

- `ui-contract-test.log`

## T5. Image reference detection

Command:

```bash
npm run test -- src/ui/imageLibraryUsage.test.ts
```

If the implementation places the helper elsewhere, run the corresponding helper test file.

Assertions:

- A badge image reference is detected.
- A next-hint image reference is detected.
- An image-layer reference is detected.
- Unused images are reported as safe to delete.
- Detection uses current unsaved editor state, not only persisted storage.
- The helper returns user-readable usage labels suitable for a delete-blocking message.

Evidence:

- `image-reference-detection-test.log`

## T6. Toolbar target semantics

Command:

```bash
npm run test -- src/ui/editorToolbar.test.ts
```

If the implementation keeps toolbar logic inside an existing UI test, run that file and record the actual command.

Assertions:

- `text-layer` toolbar target updates layer `color`, `fontSize`, `fontWeight`, `italic`, and `align`.
- `card-typography` toolbar target updates `typography.color`, `sizeScale`, `weight`, `italic`, and `scope`.
- Switching targets does not leak layer settings into generated card typography or vice versa.
- Toolbar hidden/visible state is deterministic when the active target is cleared.

Evidence:

- `toolbar-target-test.log`

## T7. Shared API surface contract

Command:

```bash
npm run typecheck
```

Assertions:

- `LiteCardnewsApi` includes shared image delete/removal API.
- `ProCardnewsApi` inherits the shared delete/removal API instead of redefining it as Pro-only.
- `electron/preload.cts`, `electron/preload-lite.cts`, `electron/main.ts`, and `electron/lite-main.ts` all expose the shared API.
- `src/edition/lite/index.tsx` and `src/edition/pro/index.tsx` both route image deletion to `window.cardnews`.

Evidence:

- Covered by `typecheck.log`
- If a separate source contract test is added, save `api-surface-test.log`

## T8. Lite edition stripping

Command:

```bash
node scripts/verify-edition.mjs --edition lite
```

Assertions:

- Lite does not strip shared typography toolbar, image management, or design/content controls.
- Lite still strips Pro-only AI/bulk/project archive surfaces according to the current edition matrix.
- New image delete APIs do not expose prohibited Pro-only functions.

Evidence:

- `verify-edition-lite.log`

## T9. Lite smoke

Command:

```bash
CARDNEWS_SMOKE_ACTION=edition-lite-regression node node_modules/electron/cli.js .
```

Assertions:

- Lite app starts.
- Shared editor opens.
- Typography controls are present.
- No Pro-only AI/bulk/project features leak into Lite.

Evidence:

- `lite-smoke.log`

## T10. Pro smoke

Command:

```bash
CARDNEWS_SMOKE_ACTION=parse-preview node node_modules/electron/cli.js .
```

Assertions:

- Pro app starts.
- Main editor renders.
- Existing parse/preview flow still works.
- Typography color changes do not break preview.

Evidence:

- `pro-smoke.log`

## T11. Targeted editor regression smoke

Run any existing smoke actions that cover these areas. If they do not exist, add a small targeted smoke script or extend the UI contract test.

Recommended commands, if available:

```bash
CARDNEWS_SMOKE_ACTION=layer-controls-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=next-hint-image-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=template-pack-import-regression node node_modules/electron/cli.js .
```

Assertions:

- Text layer color/size/weight/italic/alignment still work.
- Line layer angle and endpoint editing still work.
- Badge image height and background-removal tolerance still work.
- Next hint image height still controls only next hint image size.
- Template-pack imported images remain selectable.

Evidence:

- `layer-controls-smoke.log`
- `next-hint-image-smoke.log`
- `template-pack-import-smoke.log`
- If a smoke action does not exist, record `not-applicable` in `manual-qa.md` and cover manually.

## T12. Manual QA: typography toolbar

Steps:

1. Start Pro dev build.
2. Open a card with generated title/body text.
3. Enter edit/design mode.
4. Activate/select card title/body typography target.
5. Confirm floating toolbar appears.
6. Change color, size, weight, italic, and scope.
7. Confirm preview updates.
8. Select a text-box layer.
9. Confirm toolbar edits the layer directly and not the generated card title.
10. Save/reload or switch cards and confirm the change persists.
11. Repeat the basic color/toolbar check in Lite.

Evidence:

- `manual-toolbar-pro.png`
- `manual-toolbar-lite.png`
- Notes in `manual-qa.md`

## T13. Manual QA: image library management

Steps:

1. Add several images with duplicate display names.
2. Open image picker/management panel.
3. Confirm duplicate entries are distinguishable.
4. Search/filter by display name.
5. Delete an unused image.
6. Confirm it disappears immediately.
7. Try deleting an image currently used by a badge, next hint, or image layer.
8. Confirm deletion is blocked or explicitly asks to detach first.
9. Restart app and confirm deleted image does not reappear.

Evidence:

- `manual-image-library-before.png`
- `manual-image-library-after.png`
- Notes in `manual-qa.md`

## T14. Manual QA: button layout

Steps:

1. Open the inspector at normal desktop width.
2. Scroll to `양식 관리`.
3. Confirm action buttons align without large blank gaps.
4. Scroll to `레이어`.
5. Confirm four layer-add buttons form a stable grid.
6. Resize app to narrower inspector widths if possible and repeat.

Evidence:

- `manual-template-buttons.png`
- `manual-layer-buttons.png`
- Notes in `manual-qa.md`

## T15. Final evidence and handoff

Required files:

- `typecheck.log`
- `renderer-typography-color-test.log`
- `storage-image-typography-test.log`
- `ui-contract-test.log`
- `image-reference-detection-test.log`
- `toolbar-target-test.log`
- `verify-edition-lite.log`
- `lite-smoke.log`
- `pro-smoke.log`
- `layer-controls-smoke.log` or manual equivalent
- `next-hint-image-smoke.log` or manual equivalent
- `template-pack-import-smoke.log` or manual equivalent
- `manual-qa.md`

Required handoff:

- Append a V6 M15 / M1 addendum section to `HANDOFF.md`.
- Include files touched, tests run, screenshots captured, and residual risks.

Stop condition:

- All T1-T15 evidence exists or each skipped command has a clear reason and manual substitute.
