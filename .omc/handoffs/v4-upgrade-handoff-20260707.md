# Claude Code Handoff: Cardnews Studio v4 Upgrade

Date: 2026-07-07
Project: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

## Current Result

The v4 upgrade from `.omc/plans/v4-upgrade-plan.md` has been implemented and
verified through code checks, renderer matrix smoke, Electron UI smoke, Windows
packaging, and packaged executable smoke.

Final rebuilt artifacts:

- `release/Cardnews-Studio-Setup-1.0.0.exe`
- `release/win-unpacked/Cardnews Studio.exe`

Do not assume the plan's suggested `2.0.0` version was applied. The user
explicitly requested the existing `1.0.0` artifact names, so package version and
output names were kept at `1.0.0`.

## A2 Audit

A2 was only partially complete before this session.

Confirmed from audit:

- Baseline `npm run typecheck`, `npm test`, `npm run build`, and old style smoke
  passed.
- Global `backgroundId` existed.
- Legacy `backgroundImage` and asset lookup paths were still present in stored
  deck handling/render plumbing.
- Per-card overrides, custom style v2 persistence, image search fallback, expanded
  gates, migration tests, and final release rebuild were not complete.

Audit artifact:

- `.omo/evidence/v4-upgrade/audit/a2-audit-summary.md`

## Main Implementation Map

Domain/types:

- `src/domain/types.ts`
  - Added `external_service_failed`.
  - Added app settings, stock image, card override, layout override, image
    adjust, custom style token, warning gate, and attribution types.

Style system:

- `src/render-engine/stylePresets.ts`
  - Built-in styles now expose v2 optional tokens.
- `src/render-engine/customStyles.ts`
  - Parses and validates custom JSON style records.
  - Exports `design.md` contract content.
- UI adds style import/export/save/delete controls.

Storage/migration:

- `src/storage/deckStore.ts`
  - Saves `overrides`, custom styles, app settings, rail width, background
    attribution, and sanitized current deck state.
  - No longer rehydrates legacy `backgroundImage`.
- `src/storage/deckStore.test.ts`
  - Covers legacy/current deck migration behavior.

Renderer:

- `src/render-engine/cardTemplate.ts`
  - Applies custom styles, per-card override background adjustments, layout
    alignment/offset/gaps, dim, and v2 visual tokens.
- `src/render-engine/offscreenRenderer.ts`
  - Resolves per-card background paths.
  - Embeds bundled font CSS.
  - Final QA fix: `waitForPaint` ignores blank frames, waits 10s, and forces a
    repaint after `document.fonts.ready`.

External image provider:

- `src/domain/imageProviders.ts`
  - Builds Pixabay fallback/API URLs and parses Pixabay hits.
- `electron/main.ts`
  - Adds settings/custom-style/stock-image IPC handlers.
  - Missing Pixabay API key opens browser fallback instead of failing.
  - Download path validates HTTPS, extension/content-type, and native image decode
    before adding to background library.

UI:

- `src/ui/App.tsx`
  - Light Canva-like editor, resizable rail, inspector tabs, custom style panel,
    Pixabay modal, per-card design controls, background previews, and workspace
    persistence.
- `src/ui/styles.css`
  - Light panel/control styling, modal/grid, rail resizer, style controls.
- `usage.html`
  - Updated user guide for installer/unpacked/dev use, card syntax, per-card
    design controls, custom styles, and Pixabay fallback.

Licensing:

- `THIRD_PARTY_NOTICES.md`
- `fonts/NOTICE.md`
  - Updated for bundled `fonts/PretendardVariable.woff2` under SIL Open Font
    License 1.1 reference.

## Verification Evidence

Fresh final checks after the reviewer remediation pass:

- Typecheck: `.omo/evidence/v4-upgrade/logs/final-after-review-typecheck.log`
- Tests: `.omo/evidence/v4-upgrade/logs/final-after-review-tests.log`
  - 7 test files, 48 tests passed.
- Build: `.omo/evidence/v4-upgrade/logs/final-after-review-build.log`
- Style matrix:
  `.omo/evidence/v4-upgrade/logs/final-after-review-style-matrix-smoke.log`
  - 28 style/ratio combinations.
  - No `RENDER FAIL`, `hardGate=fail`, or `status=fail` markers.
- Release package:
  - `.omo/evidence/v4-upgrade/logs/final-after-review-package-dir.log`
  - `.omo/evidence/v4-upgrade/logs/final-after-review-dist-win.log`
- Packaged exe smoke:
  - `.omo/evidence/v4-upgrade/logs/final-after-review-packaged-render-smoke.log`
  - `.omo/evidence/v4-upgrade/screenshots/final-after-review-packaged-render-smoke.png`

Final summary artifacts:

- `.omo/evidence/v4-upgrade/final/verification-summary.md`
- `.omo/evidence/v4-upgrade/final/adversarial-summary.md`
- `.omo/evidence/v4-upgrade/final/release-qa-summary.md`
- `.omo/evidence/v4-upgrade/final/manual-qa-matrix.md`
- `.omo/evidence/v4-upgrade/final/final-verification-manifest.json`
- `.omo/evidence/v4-upgrade/final/programming-size-exceptions.md`
- `.omo/evidence/v4-upgrade/final/code-review.md`

## Release Artifact Fingerprints

`release/Cardnews-Studio-Setup-1.0.0.exe`

- size: 106,364,851 bytes
- SHA-256:
  `adb65bf2a81bc63776a7c568ef28fb90e880469ff6f9016a51c8c46da38c001f`

`release/win-unpacked/Cardnews Studio.exe`

- size: 235,706,368 bytes
- SHA-256:
  `be1e60b6bbdb71041ab5121e94a3abd03d9f25156121c68f9f7d59ba93aadd1b`

## Known Risks / Improvement Feedback

- Matrix smoke is hard-gate clean but still produces advisory warnings:
  `font_variety` and borderline `filter_contrast`. This is useful design debt,
  not a release blocker.
- The installer was not executed to avoid a real Windows install side effect.
  It was verified by successful NSIS build, exact filename, size/hash, version
  metadata, and packaged app smoke.
- Several production files still exceed 250 pure LOC. They are marked with a
  first-5-line `SIZE_OK` release exception and a required follow-up split plan in
  `.omo/evidence/v4-upgrade/final/programming-size-exceptions.md`.
- Real Unsplash integration is not implemented; the completed integration is
  Pixabay API plus browser fallback. Rename UI copy only if product wants
  multi-provider support.
- The UI has inspector tabs and visible panels. If future UX polish is desired,
  make the inactive panel content conditionally hidden instead of visible below
  the selected tab.
- Font license notice is a reference notice, not a vendored full license text.
  If distribution policy requires the full OFL text inside the app bundle, add a
  separate `fonts/OFL.txt` from the upstream license.
- `electron-builder` first hit an EBUSY lock on
  `release/win-unpacked/locales/pt-BR.pak`; rerun passed. If this recurs, close
  running `Cardnews Studio.exe` and wait for OneDrive/file scanner locks before
  rebuilding.

## Recommended Next Improvements

1. Add real manual QA for selecting a local background image through the Windows
   file dialog and verifying all 10 cards inherit it.
2. Add a small UI test or smoke assertion for the Pixabay no-key browser fallback
   so the user-facing path is covered beyond provider unit tests.
3. Reduce advisory gate warnings by consolidating body card font-size tiers and
   improving source text contrast in white/minimal styles.
4. Execute the `SIZE_OK` split plan before adding more feature work.
5. Decide whether to bump the application to `2.0.0` later. Do not do it unless
   the user also accepts changed installer filename expectations.

## Resume Commands

From project root:

```bash
npm run typecheck
npm test
npm run build
node node_modules/electron/cli.js scripts/style-matrix-smoke.mjs
npm run package:dir
npm run dist:win
```

Packaged smoke:

```bash
CARDNEWS_SMOKE_SCREENSHOT=.omo/evidence/v4-upgrade/screenshots/final-after-review-packaged-render-smoke.png CARDNEWS_SMOKE_TEXT=.omo/evidence/v4-upgrade/logs/final-after-review-packaged-render-smoke-text.txt CARDNEWS_SMOKE_ACTION=render-deck 'release/win-unpacked/Cardnews Studio.exe'
```
