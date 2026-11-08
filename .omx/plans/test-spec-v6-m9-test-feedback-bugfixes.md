# Test Spec: V6 M9 Test Feedback Bugfixes

Status: RALPLAN approved, Architect ITERATE feedback applied, Critic APPROVE
Date: 2026-07-08
Related PRD: `.omx/plans/prd-v6-m9-test-feedback-bugfixes.md`

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
$env:CARDNEWS_SMOKE_ACTION='edition-lite-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='layer-controls-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='chrome-style-regression'; node node_modules/electron/cli.js .
$env:CARDNEWS_SMOKE_ACTION='content-form-regression'; node node_modules/electron/cli.js .
```

If existing script names differ, update this spec and `HANDOFF.md` with the actual names used.

## 2. New or Updated Automated Coverage

### T1. Footer Display Preservation

Purpose: catch the `@` stripping bug and terminology migration.

Suggested smoke action: `footer-display-regression`

Steps:
1. Open app.
2. Set footer/topbar value to `@kkongdon_story`.
3. Assert preview/iframe text includes `@kkongdon_story`.
4. Save and reopen workspace or trigger autosave reload path.
5. Assert the topbar value and rendered footer still include `@`.
6. Assert visible label text is `푸터`, not `멘션`.

Unit tests:
- `normalizeFooterDisplay("@kkongdon_story")` returns `@kkongdon_story`.
- `normalizeThreadsHandle("@kkongdon_story")` returns `kkongdon_story`.
- Importer accepts old `멘션:` and new `푸터:` labels.
- `buildDeckFromDraft()` or the equivalent draft-to-deck normalization path preserves `footerAccount: "@kkongdon_story"`.
- `buildCardHtml()` output contains `@kkongdon_story` when the deck has `footerAccount: "@kkongdon_story"`.
- Legacy tests in `src/storage/deckStore.test.ts` are updated away from the old "strip @" display invariant.

Migration targets:
- `src/ui/App.tsx`: rename visible label to `푸터` and stop stripping `@` for display state.
- `src/storage/deckStore.ts`: preserve display `footerAccount`; introduce/route social URLs through derived handle normalization only.
- `src/domain/deckImporter.ts`: continue accepting `멘션:` but serialize/generate `푸터:`.
- `electron/main.ts`: update smoke selectors/assertions from `멘션` and stripped `kkongdon_story` to `푸터` and preserved display value.

### T2. Page Format Dropdown

Purpose: replace raw token editing with preset-driven UX.

Suggested smoke action: `page-format-dropdown-regression`

Steps:
1. Open Pro design controls.
2. Select each preset:
   - `1 / N`
   - `1/N`
   - `1-N`
   - `01 / N`
   - `1장 / N장`
3. Assert preview text changes to expected example for card 1 of 10.
4. Assert saved `chrome.pageNumber.template` maps to the expected token string.

Unit tests:
- `renderPageNumber()` covers all preset template mappings.
- Invalid/custom templates are escaped and never interpreted as HTML.

### T3. Content Typing Responsiveness

Purpose: catch swallowed spacebar/slow textarea behavior.

Suggested smoke action: `content-input-latency-regression`

Steps:
1. Focus title textarea.
2. Type `안녕? 난 꽁돈이야.` with spaces at normal automation speed.
3. Assert textarea value exactly matches.
4. Type subtitle `이건 프로 버전이야.`.
5. Assert textarea value exactly matches and preview eventually updates.
6. Repeat while IME composition is active if Playwright/Electron supports it.

Pass threshold:
- No dropped spaces or characters.
- Input DOM value updates immediately. Preview may debounce but must settle within 500ms.

### T4. Badge Case Preservation

Purpose: catch forced uppercase.

Unit/render test:
1. Render a card with badge text `KKONGDON cardnews`.
2. Assert generated HTML/CSS does not apply `text-transform: uppercase` to `.badge`.
3. Assert text content remains `KKONGDON cardnews`.

Manual QA:
- Enter mixed-case badge in UI and confirm preview/PNG match.

### T5. Inspector Clipping

Purpose: catch the clipped right panel.

Suggested smoke action: `inspector-layout-regression`

Viewports:
- 1365x768
- 1920x1080
- 2560x1440

Steps:
1. Open design tab.
2. Scroll to bottom of the right inspector.
3. Capture screenshot.
4. Assert bottom controls are reachable and no white rounded control panel is clipped.

### T6. Image Picker Hygiene

Purpose: prevent smoke/test images from polluting production picker.

Suggested smoke actions:
- `image-picker-library-hygiene-regression`
- `badge-background-removal-regression`
- `next-hint-image-regression`

Steps:
1. Seed the image library with at least one legitimate user image and legacy internal names:
   - `badge-smoke-source.png`
   - `badge-smoke-source-no-bg.png`
   - `next-hint-smoke.png`
2. Open badge image picker.
3. Assert internal names do not appear.
4. Select legitimate image and assert thumbnail/control preview/render HTML updates.
5. Repeat for next-hint image picker.
6. Run smoke again and assert it does not leave new `*-smoke*` files in the production image library.

### T7. Background Removal Tolerance

Purpose: prove the slider affects output or communicates scope.

Unit test:
1. Build a synthetic bitmap with white background and dark foreground edge.
2. Run removal at tolerance 10 and tolerance 80.
3. Assert alpha mask differs in expected edge pixels.

UI smoke:
1. Open image picker modal.
2. Select a test image.
3. Move tolerance slider.
4. Assert live preview updates, or assert the action label says it affects the next removal.
5. Apply removal and assert output preview/selected image changes.

### T8. AI Preset Modes

Purpose: research/image modes must not appear as draft decks.

Suggested smoke action: `ai-preset-mode-regression`

Steps:
1. Use `CARDNEWS_MOCK_AI=1` if needed, but mock responses must be preset-aware.
2. Click Research preset, send prompt, assert assistant response does not show `카드에 적용`.
3. Click Image preset, send prompt, assert assistant response does not show `카드에 적용`.
4. Click Draft preset, send prompt, assert `카드 N장 감지` and `카드에 적용` appear.
5. Apply draft and assert deck cards update.

Unit tests:
- `extractTemplateDocument()` rejects research prose with labels like `역할:` and `요청:`.
- `extractTemplateDocument()` accepts a complete valid `양식.md` deck.

### T9. Lite Edition Regression

Purpose: shared fixes appear in Lite; Pro-only surfaces remain locked/stripped.

Commands:

```powershell
npm run build:lite
node scripts/verify-edition.mjs --edition lite
$env:CARDNEWS_SMOKE_ACTION='edition-lite-regression'; node node_modules/electron/cli.js .
```

Assertions:
- Topbar/footer common text behavior works in Lite.
- Common content typing and badge rendering path works in Lite.
- Pro image badge picker, next-hint image picker, background removal, and AI provider execution are absent or locked.
- Lite bundle does not include Pro provider execution paths.

## 3. Manual QA Checklist

Save screenshots/logs under `.omc/evidence/v6/m9-test-feedback-bugfixes/`.

- `01-inspector-clipping-before-after.png`
- `02-footer-at-preview-and-png.png`
- `03-page-format-dropdown-presets.png`
- `04-title-subtitle-typing-no-drops.mp4` or smoke log
- `05-badge-mixed-case-preview.png`
- `06-image-picker-clean-library.png`
- `07-background-removal-tolerance-before-after.png`
- `08-next-hint-real-image-preview.png`
- `09-ai-research-no-apply.png`
- `10-ai-draft-apply.png`
- `11-lite-locked-pro-tools.png`

## 4. Stop Conditions

Do not proceed to release EXE packaging if any of these are true:

- Any R1-R8 acceptance criterion is unverified.
- Lite edition verification fails or shows Pro-only API leakage.
- Manual QA still reproduces one of the eight screenshots' bugs.
- The footer `@` behavior is only fixed in preview but not in PNG or saved workspace.
- Smoke images still appear in a normal user's image picker.
