# Test Spec: V6 M20 Windows DPI-safe PNG Rendering

## 1. Scope

Verify that Lite and Pro generate exact, visually correct PNG dimensions independently of Windows display scale and monitor DPI.

Evidence root:

```text
.omc/evidence/v6/m20-dpi-safe-render-dimensions/
```

The implementation sequence must start with a failing DPI reproduction. Packaging is not allowed until T1-T11 pass.

Planning baseline record:

```text
.omc/evidence/v6/m20-dpi-safe-render-dimensions/planning-baseline.md
```

## 2. Test Matrix

### Aspect ratios

| Ratio id | Expected width | Expected height |
| --- | ---: | ---: |
| `4:5` | 1080 | 1350 |
| `1:1` | 1080 | 1080 |
| `16:9` | 1920 | 1080 |
| `4:3` | 1440 | 1080 |

### Device scales

- 1.00 / 100%
- 1.25 / 125%
- 1.50 / 150%
- 1.75 / 175%
- 2.00 / 200%

### Editions

- Lite
- Pro

### Content fixtures

1. `기본 · 다크 인포`, vertical 4:5, no background photo.
2. `기본 · 다크 인포`, vertical 4:5, background photo.
3. A light no-photo style.
4. A style with badge, page number, footer, and next-hint elements.
5. A fixture using a bundled/default Korean font.
6. A fixture using a user-installed TTF if the existing font smoke supports it.

## 3. Gate Order

Run gates in this order:

1. T1 baseline reproduction;
2. T2-T4 unit and integration tests;
3. T5 typecheck and full test suite;
4. T6-T9 development behavior and edition gates;
5. T10-T11 build gates;
6. T12-T16 packaged and clean-environment gates;
7. T17 release staging.

A failed gate blocks every downstream packaging/release gate.

## T1. Baseline DPI reproduction

Purpose: lock the current defect before renderer changes.

Required harness:

- a deterministic Electron smoke action such as `render-dimension-matrix`;
- ability to select edition, ratio, style fixture, output directory, and expected dimensions;
- structured output containing actual dimensions and render error code.

Representative PowerShell execution shape:

```powershell
$env:CARDNEWS_SMOKE_ACTION = 'render-dimension-matrix'
$env:CARDNEWS_SMOKE_EDITION = 'lite'
$env:CARDNEWS_SMOKE_RATIO = '4:5'
& node_modules\electron\dist\electron.exe . --force-device-scale-factor=1.5
```

Assertions before fix:

- 100% may pass;
- at least one non-100% scale reproduces a wrong captured size or exact-size rejection;
- the failure is traced to the shared offscreen renderer;
- the test records expected vs actual dimensions.

Existing planning evidence:

- default scale UI text reports `렌더 완료: 10장 (경고 8개)`;
- forced 150% UI text reports `렌더 실패: 카드 1 PNG 크기가 올바르지 않습니다: 1620x1394`;
- the original temporary paths and SHA-256 hashes are recorded in `planning-baseline.md`.

Evidence:

- `t01-baseline-scale-100.log`
- `t01-baseline-scale-150.log`
- `t01-baseline.meta.json`
- baseline PNG/screenshot when available

## T2. Geometry policy unit tests

Add a pure helper test under `src/render-engine/`.

Assertions:

- valid card rectangles are accepted;
- missing, zero, negative, `NaN`, and infinite values are rejected;
- fractional coordinates use the documented rounding rule;
- a card rectangle matching every supported target ratio is accepted;
- wrong-aspect rectangles are rejected;
- normalization is allowed for 1x, 1.25x, 1.5x, 1.75x, and 2x card-only captures;
- normalization is rejected when source dimensions imply crop, viewport whitespace, or a different aspect ratio;
- final expected dimensions are resolved from the centralized aspect-ratio contract.

Command shape:

```bash
npm run test -- src/render-engine/captureGeometry.test.ts
```

Use the actual test filename chosen during implementation.

Evidence:

- `t02-capture-geometry-test.log`
- `t02-capture-geometry-test.meta.json`

## T3. Card template dimension contract

Command:

```bash
npm run test -- src/render-engine/cardTemplate.test.ts
```

Assertions:

- `.card` CSS width and height match the selected aspect ratio;
- `html`/`body` layout cannot add a capture margin around `.card`;
- all four aspect-ratio HTML outputs contain the expected dimensions;
- existing font/image readiness markers remain intact.

Evidence:

- `t03-card-template-test.log`
- `t03-card-template-test.meta.json`

## T4. Offscreen renderer integration

Run the offscreen renderer against deterministic fixture HTML at each device scale using the production `paint`-event path.

Assertions for every run:

- DOM card rectangle matches target CSS dimensions;
- DOM card fills the deterministic offscreen content surface;
- a post-readiness `paint` frame contains card-only content;
- render-only offscreen `deviceScaleFactor` is explicitly `1`;
- production PNG generation does not call `capturePage()`;
- normalization decision is recorded;
- final bitmap dimensions equal the target exactly;
- PNG decodes successfully;
- PNG is not blank or fully transparent;
- no visible render window appears.

Required cases:

- 4 ratios x 5 device scales = 20 cases for the shared renderer;
- at least one invalid-aspect injected fixture must fail safely;
- at least one missing-card injected fixture must fail safely.

Evidence:

- `t04-offscreen-matrix.log`
- `t04-offscreen-matrix.meta.json`
- `t04-invalid-aspect.log`
- `t04-missing-card.log`
- rendered PNG fixtures grouped by scale and ratio

## T5. Typecheck

Command:

```bash
npm run typecheck
```

Assertions:

- geometry probe payload is typed;
- stable error codes are typed;
- Lite and Pro call the shared renderer without duplicate type branches;
- no unchecked Electron capture result reaches PNG writing.

Evidence:

- `t05-typecheck.log`
- `t05-typecheck.meta.json`

## T6. Full automated tests

Command:

```bash
npm test
```

Assertions:

- all existing tests pass;
- new geometry, normalization, and diagnostic tests pass;
- no deck parsing, template, storage, image, or edition regression appears.

Evidence:

- `t06-test.log`
- `t06-test.meta.json`

## T7. Exact PNG dimension verification

Use `scripts/verify-render-png.mjs` or extend it without weakening existing checks.

Representative commands:

```bash
node scripts/verify-render-png.mjs <portrait.png> --expect-width 1080 --expect-height 1350
node scripts/verify-render-png.mjs <square.png> --expect-width 1080 --expect-height 1080
node scripts/verify-render-png.mjs <wide.png> --expect-width 1920 --expect-height 1080
node scripts/verify-render-png.mjs <classic.png> --expect-width 1440 --expect-height 1080
```

Run each command for outputs produced at every device scale.

Assertions:

- decoded dimensions match exactly;
- file is nonzero and valid PNG;
- no result is accepted solely because the renderer reported success.

Evidence:

- `t07-verify-render-png.log`
- `t07-verify-render-png.meta.json`

## T8. Visual parity and crop checks

Compare every normalized non-100% output with the 100% reference for the same fixture.

Assertions:

- no card edge is clipped;
- no unexpected border or viewport whitespace appears;
- header, page number, title, body, badge, footer, and next hint remain inside the canvas;
- text sharpness remains acceptable after high-quality normalization;
- pixel/perceptual difference stays below a documented threshold after allowing expected antialiasing variance.

Required additional inspection:

- top-left, top-right, bottom-left, and bottom-right marker pixels/regions;
- canvas pixel nonblank check;
- contact sheet across all scale values.

Evidence:

- `t08-visual-parity.log`
- `t08-visual-parity.meta.json`
- `t08-contact-sheet.png`
- `t08-diff-*.png`

## T9. Diagnostic failure behavior

Inject controlled failures:

1. missing `.card`;
2. zero-sized card;
3. wrong aspect ratio;
4. blank capture;
5. final-size mismatch after normalization.

Assertions:

- each failure maps to the expected stable code;
- UI receives concise Korean guidance;
- structured diagnostics include expected/actual/rect/DPR/zoom/content bounds;
- diagnostics exclude card body text, API keys, AI prompts, and unsanitized local paths;
- no partial PNG is reported as complete.

Evidence:

- `t09-diagnostics-test.log`
- `t09-diagnostics-test.meta.json`
- sanitized sample diagnostic JSON

## T10. Lite edition gate

Commands:

```bash
node scripts/verify-edition.mjs --edition lite
```

Run the current Lite regression smoke command documented in the repository, plus the new DPI render action.

Assertions:

- shared renderer code remains present in Lite;
- Pro-only AI and bulk functionality remains locked/stripped according to the current matrix;
- Lite exports exact dimensions at every scale;
- no edition-specific renderer fork is introduced.

Evidence:

- `t10-verify-edition-lite.log`
- `t10-lite-regression.log`
- `t10-lite-dpi-matrix.log`
- corresponding `.meta.json` files

## T11. Pro regression gate

Run the current Pro regression smoke commands documented in the repository, plus the same DPI render action.

Assertions:

- Pro editor starts and previews a deck;
- PNG and ZIP export still work;
- Pro produces the same exact dimension matrix as Lite;
- AI/provider behavior is not part of this fix and has no regression caused by renderer changes.

Evidence:

- `t11-pro-regression.log`
- `t11-pro-dpi-matrix.log`
- corresponding `.meta.json` files

## T12. Build gates

Commands:

```bash
npm run build:lite
npm run build:pro
```

Use the actual package scripts if names differ.

Assertions:

- both builds complete;
- generated renderer bundles contain the shared fix;
- no source path outside the packaged app is required at runtime;
- no code signing or installer step is performed before T1-T11 pass.

Evidence:

- `t12-build-lite.log`
- `t12-build-pro.log`
- build `.meta.json` files

## T13. Isolated unpacked package QA

Package Lite and Pro to unique `%LOCALAPPDATA%` or `.packaging/` output roots rather than overwriting `release/`.

Packaged Pro must not use `CARDNEWS_SMOKE_ACTION`; production preparation intentionally removes/ignores that surface. Use a QA-only external black-box driver:

```text
scripts/verify-packaged-render.mjs
```

Driver contract:

1. launch the exact packaged executable with an ephemeral localhost `--remote-debugging-port` and one requested `--force-device-scale-factor`;
2. connect externally through CDP using Node standard-library capabilities;
3. use the production UI/preload surface to select the deterministic fixture and invoke PNG generation;
4. locate the new output through a before/after snapshot of the isolated QA profile's render root;
5. run the independent PNG verifier;
6. close the app and assert no process remains at the tested executable path;
7. never ship this driver or a matching hidden QA branch inside `app.asar`.

Assertions:

- unpacked Lite starts without source-tree dependencies;
- unpacked Pro starts without source-tree dependencies;
- each packaged app passes the 4-ratio x 5-scale matrix;
- package resources contain the expected renderer code;
- packaged Pro contains no smoke/test modules, `CARDNEWS_SMOKE_ACTION`, mock provider, or fixed debugging port;
- closing the app leaves no required test process running.

Evidence:

- `t13-unpacked-lite.log`
- `t13-unpacked-pro.log`
- `t13-package-security-scan.log`
- package hashes and `.meta.json`

## T14. Installer QA on a clean Windows environment

Use a clean Windows VM, Windows Sandbox, or another Windows account with no project checkout.

Minimum manual matrix:

1. set display scale to 100%, install Lite, export 4:5;
2. set display scale to 125%, relaunch, export 4:5;
3. set display scale to 150%, relaunch, export 4:5;
4. set display scale to 175%, relaunch, export 4:5;
5. set display scale to 200%, relaunch, export 4:5;
6. repeat at least 100% and 150% for Pro;
7. on a two-monitor setup, move/relaunch between monitors with different scales when available.

Assertions:

- installer completes;
- app starts from installed shortcut;
- every 4:5 PNG is exactly `1080x1350`;
- no `1950x2130`-style error appears;
- no source or developer files are required.

Evidence:

- `t14-clean-install-manual-qa.md`
- screenshots of Windows scale settings and PNG properties
- installer log and `.meta.json`

If no external Windows environment is available, this gate remains blocked. Do not call the installer publicly verified.

## T15. Upgrade and user-data preservation

Test upgrade from the currently distributed Lite build to the corrected build.

Assertions:

- existing projects remain;
- imported backgrounds and image library items remain;
- user fonts remain available;
- settings and edition identity remain correct;
- rendering succeeds after upgrade at non-100% scale;
- uninstall/reinstall behavior matches the documented data-retention policy.

Evidence:

- `t15-upgrade-manual-qa.md`
- before/after screenshots or inventory
- `t15-upgrade.meta.json`

## T16. Security and distribution payload check

Assertions:

- no API keys, project-local absolute paths, smoke fixtures, or private diagnostics are bundled unintentionally;
- diagnostics are written to a user-writable AppData location, not `app.asar`;
- installer and unpacked executable hashes are recorded;
- malware/Defender scan result is recorded;
- package identity clearly distinguishes Lite and Pro.

Evidence:

- `t16-security-payload.log`
- `t16-defender-scan.txt`
- `t16-artifact-hashes.sha256`
- `t16-security-payload.meta.json`

## T17. Release staging gate

Only after T1-T16 pass:

- copy verified artifacts into the final `release/` distribution folders;
- regenerate user-facing guide/checksum files;
- append the result to `HANDOFF.md` without deleting prior history;
- record exact source commit/worktree state and artifact hashes.

Assertions:

- staged files are byte-identical to the tested isolated artifacts;
- each public installer hash is linked to passing metadata;
- the guide states that 4:5 exports automatically at `1080x1350` and users do not need to change canvas pixels;
- temporary 100% scale guidance is removed from the normal workflow and retained only in troubleshooting for older builds.

Evidence:

- `t17-release-stage.log`
- `t17-release-stage.meta.json`
- `t17-artifact-hashes.sha256`
- updated guide screenshot

## 4. Failure Policy

- Any wrong final pixel size is a hard failure.
- A wrong-aspect source capture must never be stretched.
- A blank or partially ready capture must never be published.
- A gate without logs and metadata is not considered passed.
- Build-machine success alone does not satisfy packaged release QA.
- Missing clean-environment QA blocks the `배포 검증 완료` claim.

## 5. Definition of Done

M20 is done when:

1. the DPI bug has a committed regression test;
2. the shared card-only renderer passes all ratio and scale cases;
3. Lite and Pro development builds pass full regression gates;
4. isolated unpacked packages pass;
5. clean installed packages pass at multiple Windows scales;
6. upgrade preserves user data;
7. release artifacts, hashes, diagnostics policy, guide, and handoff are complete.
