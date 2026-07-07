# Claude Code Handoff - v4 Test Feedback Repair

Date: 2026-07-07
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
Plan implemented: `.omo/plans/v4-test-feedback-repair.md`
Evidence root: `.omo/evidence/v4-test-feedback-repair/`

## Status

The approved v4 test-feedback repair plan has been implemented and verified through the real Electron surfaces, including packaged executable smoke.

Primary user reports addressed:
- HTML rendered but PNG was mostly blank or visually missing content.
- Selected background did not appear in preview/PNG.
- Text could overlap or crop silently.
- Right inspector tabs did not act as distinct panels.
- JSON style workflow lacked sample/default guidance.
- Font import, typography controls, text/shape/line/image layers were missing.
- CSV bulk production was missing.
- Windows release artifacts needed regeneration and verification.

## Main Implementation Areas

### Renderer and PNG trust fixes
- `src/render-engine/offscreenRenderer.ts`
  - Waits for `loadURL`, `document.fonts.ready`, image/CSS background readiness, `cardnewsReady`, animation frames, and multiple nonblank capture attempts.
  - Writes HTML debug files and rejects blank/off-size/empty PNGs.
  - Integrates visual artifact issues into `gate-report.json`.
- `src/render-engine/gates/visualContentGate.ts`
  - Adds pixel-level visual content gate.
  - Final tuning: low nonWhiteRatio alone is not enough to fail a legitimate sparse white minimal card; it fails when low nonWhiteRatio and low coverage combine, while low coverage and low luminance variation still fail.
- `scripts/verify-render-png.mjs`
  - Standalone PNG verifier used for RED proof and final visual evidence.

### Background, text fitting, and custom style correction
- `src/render-engine/cardTemplate.ts`
  - Renders `.photo` whenever `backgroundCssUrl` exists, regardless of preset.
  - Adds deterministic text fit CSS variables and safer text wrapping.
  - Renders custom layers in preview/PNG.
  - Uses preset-provided `textBackdrop`/`chromeBackdrop` for custom photo styles instead of id-special-casing `newsprint`. This fixed `custom-smoke` contrast failures.
- `src/ui/App.tsx`
  - Preview now passes selected background consistently to the same HTML template used by PNG render.
  - Design/Content/Export panels are real hidden sections.

### Style JSON, fonts, layers, CSV bulk
- `src/render-engine/customStyles.ts`
  - Built-in sample JSON and AI-facing design contract support.
  - Fenced JSON from external AI remains accepted.
- `src/storage/deckStore.ts`
  - Managed font library under userData: `.ttf`, `.otf`, `.woff2`.
  - Font metadata and font data loading for preview/offscreen render.
- `src/domain/types.ts`
  - Adds font, typography, layer, bulk, and `visual_artifact` gate contracts.
- `src/domain/csvBulk.ts`
  - No-dependency CSV parser with quoted cells and `\n` escape support.
  - Required columns: `output_name`, `header_label`, `footer_account`, `style_id`, `aspect_ratio`, `card_01`, `card_02`.
  - Optional columns include `accent`, `accent_color`, `background`, `background_id`, `dim`, `background_dim`, `font_id`, and `card_03` through `card_10`.
  - Invalid rows do not stop valid rows.
- `electron/main.ts`
  - Adds font IPC, CSV bulk render, bulk report/ZIP generation, and smoke actions:
    - `parse-preview`
    - `render-deck`
    - `render-with-background`
    - `render-bulk-sample`
    - `render-export`
  - `render-export` smoke uses `smoke-exports/` under the render output directory instead of OS save dialogs; normal user export still uses dialogs.
- `usage.html`
  - Updated user-facing guide for JSON style, font import, layers, CSV bulk, PNG/ZIP export.
- `DESIGN.md`
  - Current UI/render contract extracted for future review.

### External reference
- `slides-grab` was used only as a rendering reference, not as a dependency.
- Reference: `https://github.com/NomaDamas/slides-grab/tree/main`
- Adopted ideas: validate before export, local asset contract, wait for fonts/assets/settle before screenshot, structured validation diagnostics.

## Final Verification Evidence

Latest successful commands:
- `npm run typecheck`
  - `.omo/evidence/v4-test-feedback-repair/final-typecheck-after-visual-threshold-fix.log`
  - exit 0
- `npm run test`
  - `.omo/evidence/v4-test-feedback-repair/final-test-after-visual-threshold-fix.log`
  - 9 files / 56 tests passed
- `npm run build`
  - `.omo/evidence/v4-test-feedback-repair/final-build-after-visual-threshold-fix.log`
  - exit 0
- Style matrix:
  - `.omo/evidence/v4-test-feedback-repair/final-style-matrix.log`
  - exit 0
  - built-in styles plus `custom-smoke` all hardGate pass
  - remaining issues are advisory warnings (`font_variety`, `filter_contrast`)
- Dev smoke:
  - render + PNG/ZIP export: `.omo/evidence/v4-test-feedback-repair/final-smoke-render-export.log`
  - selected background render: `.omo/evidence/v4-test-feedback-repair/final-smoke-bg.log`
  - CSV bulk: `.omo/evidence/v4-test-feedback-repair/final-smoke-bulk.log`
- Packaged executable smoke:
  - `.omo/evidence/v4-test-feedback-repair/final-dist-packaged-smoke-render-export.log`
  - exit 0
  - verifies render plus current-card PNG export and full ZIP export from `release/win-unpacked/Cardnews Studio.exe`
- Pixel verifier:
  - `.omo/evidence/v4-test-feedback-repair/final-visual-verifier-render.json`
  - `.omo/evidence/v4-test-feedback-repair/final-visual-verifier-bulk.json`
  - both `ok: true`
- Summaries:
  - `.omo/evidence/v4-test-feedback-repair/final-smoke-summary.json`
  - `.omo/evidence/v4-test-feedback-repair/final-release-hashes.json`
  - `.omo/evidence/v4-test-feedback-repair/final-release-artifacts.log`

## Release Artifacts

Generated and verified:
- `release/Cardnews-Studio-Setup-1.0.0.exe`
  - bytes: `106376772`
  - SHA-256: `0dc113554a72e8e7b491c4616b802dd61cd011cd7056a7c28426cd53d3f10b92`
  - modified local: `2026-07-07T23:15:05`
- `release/win-unpacked/Cardnews Studio.exe`
  - bytes: `235706368`
  - SHA-256: `97a262689252b4fec3bd3d0dec01958b4d7337097bd8faf61353ae44fd88df37`
  - modified local: `2026-07-07T23:14:43`

Notes:
- The installer was not executed because that would create system install side effects.
- The unpacked executable was launched and smoke-tested after `dist:win`.
- `Get-AuthenticodeSignature` reports both EXEs as not digitally signed; see `.omo/evidence/v4-test-feedback-repair/final-authenticode-signature.json`.

## Latest Runtime Outputs

Final packaged smoke render:
- `C:\Users\js480\AppData\Roaming\gpt-cardnews-auto\gpt-cardnews-auto\renders\render-2026-07-07T14-15-16-354Z`
- 10 PNG + 10 HTML files.
- `smoke-exports/card-01.png` and `smoke-exports/cardnews-2026-07-07.zip` exist.

Final bulk smoke:
- `C:\Users\js480\AppData\Roaming\gpt-cardnews-auto\gpt-cardnews-auto\renders\bulk-2026-07-07T14-13-09-693Z`
- `renderedCount: 1`, `failedCount: 3`, `totalRows: 4`
- Expected failures are preserved:
  - missing style
  - missing background id
  - missing font id
- `bulk-output.zip` exists.

## Known Issues and Next Improvements

1. EXEs are unsigned. This is acceptable for the local build but should be handled before public distribution.
2. Style matrix hard gates pass, but advisory warnings remain:
   - some body cards use 5 font sizes where 4 or fewer is recommended
   - white/minimal source contrast is close to the minimum after color adjustment
3. `render-export` smoke bypasses OS save dialogs only when `CARDNEWS_SMOKE_ACTION=render-export`; normal user export still opens save dialogs.
4. The installer itself was not run. Verification relies on build logs, hash/existence checks, and the unpacked executable smoke.
5. `.gitignore` and many project files are still untracked/modified in this working tree. Do not revert unrelated changes. If committing later, review the whole diff and use the Lore Commit Protocol in `AGENTS.md`.

## Suggested Next Command Set

For a future agent wanting to revalidate quickly:

```bash
npm run typecheck
npm run test
npm run build
node node_modules/electron/cli.js scripts/style-matrix-smoke.mjs
CARDNEWS_SMOKE_ACTION=render-export CARDNEWS_SMOKE_SCREENSHOT=.omo/evidence/v4-test-feedback-repair/recheck-render-export.png CARDNEWS_SMOKE_TEXT=.omo/evidence/v4-test-feedback-repair/recheck-render-export.txt node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=render-bulk-sample CARDNEWS_SMOKE_SCREENSHOT=.omo/evidence/v4-test-feedback-repair/recheck-bulk.png CARDNEWS_SMOKE_TEXT=.omo/evidence/v4-test-feedback-repair/recheck-bulk.txt node_modules/electron/cli.js .
npm run package:dir
CARDNEWS_SMOKE_ACTION=render-export CARDNEWS_SMOKE_SCREENSHOT=.omo/evidence/v4-test-feedback-repair/recheck-packaged-export.png CARDNEWS_SMOKE_TEXT=.omo/evidence/v4-test-feedback-repair/recheck-packaged-export.txt "release/win-unpacked/Cardnews Studio.exe"
npm run dist:win
```

If `dist:win` fails with `EPERM` on `release/win-unpacked`, kill any running `Cardnews Studio.exe`, remove only `release/win-unpacked.tmp` after confirming it resolves under the project root, then retry.
