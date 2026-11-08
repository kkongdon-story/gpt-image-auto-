# Test Spec: V6 M13 Lite Open Design + GPTs Template Pack

Status: Approved by RALPLAN consensus
Date: 2026-07-09

## Test Goals

Prove that:

1. Lite opens content/design editing while AI and bulk remain locked.
2. Template-pack import works in both Lite and Pro.
3. Imported assets are safe, internalized, and render correctly.
4. UI labels match behavior.
5. GPTs guide and shortcut setting are present and usable.

## T1. Lite edition gating

Type: integration/regression

Steps:

1. Build or run Lite.
2. Open content tab and edit title, subtitle, badge, footer, and body.
3. Open design tab and edit header/footer, page number, background, badge, next hint, typography, and layers.
4. Open AI entry point.
5. Open bulk CSV entry point if present.

Expected:

- Content and design controls are usable.
- AI is locked or unavailable with a clear Pro-only message.
- Bulk is locked or unavailable with a clear Pro-only message.
- Full project archive import/export is locked or unavailable if surfaced in Lite.
- Template-pack/workspace/preset import is available where it supports manual creation.
- No content/design action shows Pro-only lock.

Evidence:

- Screenshot of Lite content/design controls.
- Screenshot of AI/bulk lock.
- Test log.

## T2. Pro edition parity

Type: integration/regression

Steps:

1. Build or run Pro.
2. Edit the same content/design controls used in T1.
3. Open AI panel.
4. Open bulk CSV flow.

Expected:

- Content/design controls work.
- AI and bulk are available.
- No regression in Pro provider detection or bulk UI.

Evidence:

- Screenshot or Playwright trace.
- Test log.

## T3. Lite preserves manual design state

Type: unit/integration

Fixture:

- Deck/workspace with `chrome`, `nextHint`, `overrides`, layers, badge image, background image, typography.

Steps:

1. Save workspace in Lite.
2. Reload workspace in Lite.
3. Run edition filter/strip helpers.

Expected:

- Manual design fields are preserved.
- AI/bulk-only metadata, if any, is stripped.

Suggested command:

```bash
npm run test -- src/domain/editionFilter.test.ts
```

## T4. Template-pack schema accepts valid one-card pack

Type: unit

Fixture:

- `template.json` with one card.
- One clean background image.

Expected:

- Parser accepts schema.
- Normalized manifest has one card.
- Background path is recognized as relative and safe.

Suggested command:

```bash
npm run test -- src/domain/templatePack.test.ts
```

## T5. Template-pack schema accepts valid multi-card pack

Type: unit

Fixture:

- `template.json` with 3 or more cards.
- Multiple clean background images.
- Mixed card types: cover, body, closing.

Expected:

- Parser accepts all cards.
- Card order is preserved.
- Missing optional fields use safe defaults.

## T6. Template-pack rejects unsafe paths

Type: unit/security

Cases:

- `../outside.png`
- `/absolute/path.png`
- `C:\temp\outside.png`
- `backgrounds/../../x.png`
- zip-slip archive entries that would extract outside the temp root
- unsupported extension such as `.exe`
- referenced missing file

Expected:

- Import fails before copying assets.
- Error message identifies the invalid path or missing asset.

## T7. Template-pack rejects unsafe archive/resource bounds

Type: unit/security/integration

Cases:

- archive with too many entries
- archive with total uncompressed bytes over the configured limit
- image asset over per-file byte limit
- `template.json` over 512 KiB
- more than 50 cards
- more than 200 archive entries
- total uncompressed size over 120 MiB
- image/asset file over 20 MiB
- decoded image over 36,000,000 pixels
- decoded image width or height over 8,000 px
- file extension does not match decoded image content
- corrupt image decode
- duplicate normalized asset names

Expected:

- Import fails before durable asset registration.
- Temporary extraction state is cleaned.
- Partial copied assets are removed or never committed.
- User-facing error explains the failing bound.

## T8. Template-pack domain parser has no filesystem side effects

Type: unit/architecture

Steps:

1. Call `src/domain/templatePack.ts` parser with valid and invalid manifests.
2. Mock or assert no filesystem/storage calls are needed.

Expected:

- Parser validates and normalizes schema only.
- Parser returns safe relative references.
- Parser does not assign internal storage IDs.

## T9. Template-pack import internalizes assets

Type: integration

Steps:

1. Import a valid zip pack.
2. Inspect resulting workspace/deck state.
3. Inspect app storage.

Expected:

- Backgrounds/assets are copied into app-controlled storage.
- Deck references internal asset IDs, not raw package paths.
- Temporary extraction directory is cleaned.

## T10. Imported template renders nonblank

Type: render/smoke

Steps:

1. Import a valid pack.
2. Render current card PNG.
3. Inspect PNG dimensions and nonblank pixels.

Expected:

- PNG is generated.
- Clean background is visible.
- Editable app text appears on top.
- No source screenshot text is baked in unless intentionally part of the clean background.

## T11. Next-hint controls affect only next hint

Type: UI/component/e2e

Steps:

1. Open design tab.
2. Locate `넘김 기호`.
3. Change display mode and image height.
4. Inspect deck state.

Expected:

- Next-hint state changes.
- Main typography state does not change.
- The section does not contain `텍스트 크기` or `굵기`.

## T12. Typography controls are under typography section

Type: UI/component/e2e

Steps:

1. Open design tab.
2. Locate `타이포그래피` section.
3. Change `텍스트 크기`.
4. Change `굵기`.
5. Inspect deck state/render.

Expected:

- Controls are visually under typography.
- Main text size and weight change.
- Next-hint state does not change.

## T13. 양식 관리 and 스타일 관리 are understandable

Type: UI/manual QA

Steps:

1. Open management/import area.
2. Read labels and helper copy.
3. Import a template-pack JSON/zip through 양식 management.
4. Import style JSON through style management.

Expected:

- User can distinguish:
  - 양식: content, card structure, clean backgrounds, layers.
  - 스타일: colors, fonts, mood, visual theme.
- Wrong import type gives clear error or is not selectable.

## T14. GPTs builder guide completeness

Type: docs validation

Steps:

1. Open `docs/gpts-template-pack-builder-guide.html`.
2. Search for required sections.

Required sections:

- Purpose
- Inputs
- Reference analysis checklist
- Text removal background instructions
- Template-pack JSON schema
- Style JSON schema
- Asset naming rules
- Quality rules
- Safety/copyright caution
- Example GPTs instructions
- Example package
- Lite/Pro import steps

Expected:

- All required sections exist.
- Examples are copyable.
- Guide explains that editable text must be represented in JSON.
- If linked from the app, the installed packaged app can open the guide or linked help/manual page.

## T15. GPTs shortcut setting

Type: unit/integration/e2e

Steps:

1. Set GPTs URL to an empty value.
2. Confirm button disabled or neutral.
3. Set GPTs URL to `https://chatgpt.com/g/g-kkongdon-template-builder`.
4. Restart app.
5. Confirm URL persists.
6. Click shortcut.
7. Try invalid values: `http://`, `javascript:`, plain text, `https://example.com/gpts/kkongdon-template-builder`.

Expected:

- Empty value is allowed.
- HTTPS URL on `chatgpt.com` or `chat.openai.com` persists and opens externally.
- Invalid, non-HTTPS, or non-allow-listed values are rejected or not saved.
- Shortcut uses the existing app external-link policy.
- Works in Lite and Pro.

## T16. Edition verification

Type: static/package guard

Commands:

```bash
node scripts/verify-edition.mjs --edition lite
npm run build:lite
npm run build:pro
```

Expected:

- Lite verification passes with content/design APIs included.
- Lite verification still blocks AI, bulk, and full project archive surfaces.
- Builds pass for both editions.

## T17. Full standard verification

Type: standard gate

Commands:

```bash
npm run typecheck
npm run test
npm run build:lite
npm run build:pro
```

Expected:

- All commands pass.
- Failures create follow-up bug notes before completion is claimed.

## Evidence Folder

Use:

```text
.omc/evidence/v6/m13-lite-template-pack-gpts/
```

Expected evidence files:

- `typecheck.log`
- `test.log`
- `build-lite.log`
- `build-pro.log`
- `verify-edition-lite.log`
- `lite-ui-smoke.png`
- `pro-ui-smoke.png`
- `template-pack-import-smoke.png`
- `manual-qa.md`
- `meta.json`

## Completion Criteria

M13 is complete only when:

- PRD acceptance criteria pass.
- T1 through T17 are either passing or explicitly marked with a justified deferral.
- HANDOFF.md is append-only updated.
- No EXE packaging is performed unless a later user request asks for it.
