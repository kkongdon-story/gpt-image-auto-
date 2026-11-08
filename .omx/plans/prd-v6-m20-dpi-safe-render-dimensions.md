# PRD: V6 M20 Windows DPI-safe PNG Rendering

## 1. Goal

Fix the distributed Lite edition failure where PNG generation rejects a vertical 4:5 card with a message such as:

```text
렌더 실패: 카드 1 PNG 크기가 올바르지 않습니다: 1950x2130
```

The permanent result must be:

- vertical 4:5 output is always exactly `1080x1350` pixels;
- square 1:1 output is always exactly `1080x1080` pixels;
- horizontal 16:9 output is always exactly `1920x1080` pixels;
- horizontal 4:3 output is always exactly `1440x1080` pixels;
- Windows display scaling, monitor DPI, and window decoration differences do not change PNG dimensions;
- the shared renderer fix applies to both Lite and Pro;
- invalid renders still fail safely instead of silently accepting a wrong image.

This document is an implementation plan only. Do not modify source code or package EXEs until a follow-up execution command explicitly requests implementation.

## 2. Incident Summary

### User-visible symptom

The user selected:

- style: `기본 · 다크 인포`;
- ratio: `세로형 4:5 (인스타)`;
- action: `PNG 생성`.

The packaged Lite app produced a PNG whose measured size did not match the exact 4:5 contract and stopped the render.

### Confirmed local reproduction

The currently packaged Lite app was exercised without source changes:

- default device scale: render completed;
- forced 150% device scale: render failed with `1620x1394`.

The exact dimensions differ from the external report because viewport geometry and display scale differ, but both failures prove the same defect: the captured bitmap size is coupled to the Windows device scale and window content area.

Planning baseline artifacts were captured at:

```text
C:\Users\js480\AppData\Local\Temp\cardnews-lite-dpi-plan-20260713\scale-default\ui.txt
C:\Users\js480\AppData\Local\Temp\cardnews-lite-dpi-plan-20260713\scale-default\ui.png
C:\Users\js480\AppData\Local\Temp\cardnews-lite-dpi-plan-20260713\scale-150\ui.txt
C:\Users\js480\AppData\Local\Temp\cardnews-lite-dpi-plan-20260713\scale-150\ui.png
```

Their hashes, observed results, and durable copies are recorded in the M20 planning evidence folder. M20-1 must regenerate the failure through the committed harness and add command-level metadata before implementation begins.

### Confirmed code path

The shared renderer currently:

1. creates a hidden `BrowserWindow` using the target card width and height;
2. loads HTML whose `.card` element already has the correct CSS width and height;
3. calls `webContents.capturePage()` without a card rectangle;
4. validates the returned `NativeImage` dimensions against the target ratio.

`capturePage()` therefore captures the window/web contents in device pixels rather than a deterministic card-only bitmap. On a scaled display, the returned size can differ from the CSS card size.

### Historical capture decision and supersession

The original renderer plan and early handoff explicitly selected offscreen `paint` events as the primary product render path and rejected hidden-window `capturePage()` because of blank/compositor-frame risk. The current committed renderer later drifted back to whole-page `capturePage()`.

M20 resolves that contradiction as follows:

- the historical `paint`-event decision remains the architecture contract;
- M20 supersedes the current whole-page `capturePage()` implementation;
- `capturePage()` may remain only in UI/screenshot QA tooling, not as the production PNG renderer;
- switching to a different primary renderer again requires a new ADR with comparative evidence.

## 3. Product Decision: Is Manual Size Adjustment Needed?

No arbitrary pixel-size control is required to solve this incident.

The ratio selector already represents the supported social-media output contracts. For Instagram vertical 4:5, the app should generate `1080x1350` automatically. Asking users to manually compensate for Windows scaling would expose an implementation defect as a product setting and would produce inconsistent deliverables.

The plan therefore keeps the existing ratio choices and fixes the renderer. A future custom-canvas feature would be a separate product milestone with its own validation and export rules.

## 4. Scope

### In scope

- shared offscreen renderer used by Lite and Pro;
- deterministic card capture geometry;
- device-pixel-ratio-aware normalization;
- exact output validation for all supported ratios;
- render diagnostics suitable for support cases;
- automated DPI matrix tests;
- packaged Lite and Pro regression gates;
- release notes and an end-user support response;
- isolated packaging and clean-install verification after all code gates pass.

### Out of scope

- arbitrary user-entered width and height;
- changing Instagram 4:5 from `1080x1350`;
- removing or weakening exact-size validation;
- forcing the entire app UI to Windows scale 100%;
- accepting a wrong-aspect bitmap and stretching it;
- redesigning the editor or ratio selector;
- packaging before the implementation and DPI gates pass.

## 5. RALPLAN-DR

### Principles

1. Export dimensions are a file contract, not a display preference.
2. The renderer must capture the card, not the surrounding viewport.
3. DPI normalization is allowed only after card-only capture geometry is verified.
4. Lite and Pro must use one shared implementation and one dimension matrix.
5. Strict validation remains the final gate.
6. A support workaround must never become the permanent architecture.

### Decision drivers

- A public Lite distribution has already produced the failure.
- The error is environment-dependent and may not reproduce at 100% scale.
- The renderer already knows the exact intended card dimensions.
- A global device-scale switch would affect editor readability and accessibility.
- Blindly resizing a whole viewport could preserve blank space, crop content, or distort the design.

### Options considered

#### Option A: force the whole Electron application device scale factor to 1

Rejected.

- It changes every Electron window, not only PNG export.
- It can make the editor too small on high-DPI screens.
- It hides rather than removes the renderer's viewport dependency.
- It is brittle across launch paths and multi-monitor configurations.

This rejection does not prohibit an explicit scale factor on the isolated offscreen render surface. The chosen design sets the render-only offscreen output scale to `1` while leaving the editor and operating-system UI scale untouched.

#### Option B: accept any captured size or resize the whole viewport

Rejected.

- A wrong viewport may contain blank space or omit card content.
- A mismatched aspect ratio would be stretched.
- It weakens the output contract and can turn a visible failure into a damaged PNG.

#### Option C: explicit-scale offscreen `paint` frames with card geometry verification

Chosen.

- Electron's offscreen renderer emits a `NativeImage` for the whole offscreen frame through `paint` events.
- The offscreen surface can request `deviceScaleFactor: 1` independently from the visible editor.
- The DOM card already owns the intended CSS dimensions and can be verified to fill the frame.
- Guarded normalization remains a defensive fallback only for a uniformly scaled, verified card frame.
- Final exact-size and visual checks remain possible.

### Architecture decision record

Implement a deterministic offscreen-frame export pipeline:

1. create the hidden renderer with content-size semantics and `offscreen: { useSharedTexture: false, deviceScaleFactor: 1 }`;
2. subscribe to `paint` before loading the card;
3. load the card and wait for fonts/images/layout stability;
4. query the `.card` DOM rectangle and runtime metrics;
5. reject missing, zero-sized, non-finite, wrong-aspect, or non-frame-filling card geometry;
6. invalidate/repaint and collect a stable nonblank whole-frame `paint` image;
7. accept an exact target image directly, or normalize only a uniformly scaled verified frame;
8. validate the final image exactly;
9. write PNG only after validation succeeds.

## 6. Functional Requirements

### R1. Deterministic offscreen surface

The hidden render window must represent content dimensions, not outer-window dimensions.

Implementation requirements:

- create the render window with `useContentSize: true`;
- set `paintWhenInitiallyHidden: true`;
- keep it hidden and paintable while hidden;
- explicitly set content size to the selected ratio dimensions;
- configure `webPreferences.offscreen` as an object with `useSharedTexture: false` and `deviceScaleFactor: 1`;
- set web contents zoom factor to `1` for rendering;
- do not change the visible editor window or global Electron scale.

Acceptance:

- content bounds are recorded and stable for a render;
- the offscreen `paint` frame requests one output pixel per CSS pixel regardless of Windows scale;
- editor UI scale remains controlled by the operating system;
- no visible render window flashes on screen.

### R2. Card geometry probe

Before capture, execute a small DOM probe that returns:

- `.card` existence;
- `getBoundingClientRect()` coordinates and dimensions;
- computed CSS width and height;
- `window.devicePixelRatio`;
- `webContents` zoom factor;
- document scroll width/height;
- font and image readiness state.

Acceptance:

- missing/invalid card geometry produces a controlled render error;
- expected card CSS dimensions match the selected ratio;
- a layout that is not ready is retried within the existing bounded readiness policy, then fails with diagnostics if still unstable.

### R3. Stable offscreen `paint` capture

Capture the whole offscreen frame from the `paint` event after proving the `.card` fills that frame.

Implementation requirements:

- register the `paint` listener before `loadURL()` so no required frame is missed;
- preserve the existing bounded retry, font readiness, image readiness, animation-frame, and blank-frame protections;
- after readiness, call `invalidate()` and wait for a new stable frame rather than accepting an earlier placeholder frame;
- use the `NativeImage` supplied by `paint`; do not call `capturePage()` in the production PNG path;
- treat the dirty rectangle as repaint metadata only; do not save a dirty sub-rectangle as the final card.

Acceptance:

- `.card` starts at the expected origin and fills the render content area;
- no body margin, viewport whitespace, scroll area, or window chrome is included in the paint frame;
- at least two readiness-consistent frames or one explicitly invalidated post-readiness frame meet the nonblank and geometry contract;
- the renderer does not rely on the current monitor or visible window bounds.

### R4. DPI-aware normalization

Normalize only a verified full-card paint frame.

Required guard conditions:

- source bitmap has positive finite dimensions;
- source aspect ratio matches the selected target ratio within a small, documented pixel-rounding tolerance;
- card DOM geometry matched the target CSS ratio and filled the offscreen content surface;
- width and height imply the same uniform scale factor within tolerance;
- no unexpected blank/transparent border was detected by the render smoke fixture.

The expected path with offscreen `deviceScaleFactor: 1` is an exact-size frame with no resize. If all guards pass and a future/runtime override still returns a uniformly scaled frame, resize with high-quality sampling to the exact target dimensions and record that fallback in diagnostics.

If guards fail, do not stretch or crop. Stop with a controlled error and diagnostics.

Acceptance:

- 100%, 125%, 150%, 175%, and 200% scale produce identical target dimensions;
- normalized output remains visually equivalent within the approved comparison threshold;
- final `NativeImage.getSize()` equals the target exactly.

### R5. Strict final validation

Keep exact output validation after normalization.

Acceptance:

- wrong final dimensions still fail;
- a PNG is never reported complete before dimension and nonblank checks pass;
- the error identifies card number, expected dimensions, and actual dimensions in user-readable Korean;
- raw internal stack traces are kept in diagnostics, not shown as the main UI message.

### R6. Render diagnostics

On render failure, record a structured diagnostic payload without personal content or credentials.

Required fields:

- app edition and app version;
- selected aspect ratio id and expected dimensions;
- card index;
- card CSS rectangle;
- captured bitmap dimensions;
- final bitmap dimensions, if normalization ran;
- device pixel ratio;
- zoom factor;
- render content bounds;
- readiness status for fonts and images;
- normalization decision and rejection reason;
- timestamp and stable error code.

Recommended stable codes:

- `RENDER_CARD_RECT_MISSING`;
- `RENDER_CARD_RECT_INVALID`;
- `RENDER_CAPTURE_ASPECT_MISMATCH`;
- `RENDER_FINAL_SIZE_MISMATCH`;
- `RENDER_CAPTURE_BLANK`.

Acceptance:

- support can distinguish geometry, readiness, and DPI failures from one file;
- diagnostic output does not contain AI prompts, card body copy, API keys, or arbitrary local paths unless explicitly needed and sanitized.

### R7. Shared Lite/Pro behavior

The fix belongs in the shared render engine.

Acceptance:

- Lite and Pro call the same card capture/normalization helper;
- both editions use the same explicit render-only offscreen scale policy;
- no edition-specific duplicate sizing logic is introduced;
- Lite edition stripping still passes;
- Pro-only features do not leak into Lite.

### R8. Ratio contract

Keep the existing supported output matrix:

| Ratio | Output |
| --- | --- |
| Vertical 4:5 | `1080x1350` |
| Square 1:1 | `1080x1080` |
| Horizontal 16:9 | `1920x1080` |
| Horizontal 4:3 | `1440x1080` |

Acceptance:

- ratio display labels remain understandable;
- selecting `세로형 4:5 (인스타)` requires no extra size input;
- generated PNG metadata and actual decoded dimensions match the table.

### R9. Support copy and temporary workaround

Before the corrected build is distributed, the support response may advise:

1. close Cardnews Studio Lite;
2. set Windows `설정 > 시스템 > 디스플레이 > 배율` to 100%;
3. sign out/restart the app if Windows requests it;
4. generate PNG again.

This must be labeled as a temporary workaround, not the permanent solution.

The corrected app should replace the raw size error with guidance such as:

```text
PNG 렌더링 중 카드 크기를 맞추지 못했습니다.
앱을 다시 실행한 뒤 재시도해 주세요. 계속되면 오류 진단 파일을 보내 주세요.
```

### R10. Release replacement

After all implementation gates pass:

- build Lite and Pro in isolated output directories;
- test unpacked binaries first;
- test installers second;
- stage only verified artifacts into `release/`;
- update checksums, release metadata, and user guide;
- preserve existing user data during upgrade.

### R11. Packaged Pro verification without production smoke code

The current production Pro entry intentionally ignores/removes `CARDNEWS_SMOKE_ACTION` and related QA branches when packaged. M20 must preserve that security boundary.

Required packaged QA approach:

- add a QA-only external driver such as `scripts/verify-packaged-render.mjs` that is never copied into `app.asar`;
- launch the exact unpacked or installed executable with an ephemeral localhost remote-debugging port and the requested `--force-device-scale-factor` value;
- connect from the external driver through the Chrome DevTools Protocol using Node standard-library capabilities, with no new runtime dependency;
- operate the production UI/preload API from outside the app to select a deterministic fixture and invoke PNG generation;
- identify the newly created render folder by a before/after snapshot of the isolated QA user's render root;
- decode and verify the produced PNG with the independent verifier;
- terminate the tested process and prove no process remains at that exact executable path.

Security requirements:

- remote debugging is enabled only by the QA launch command in a disposable local VM/account;
- no fixed debugging port, production flag, smoke action, mock provider, or hidden QA route is added to the packaged app;
- the package scan must prove Pro remains free of smoke/test modules and symbols;
- if the external driver cannot exercise a packaged build, that package gate is blocked rather than bypassed.

## 7. Implementation Boundaries

### Expected primary files

- `src/render-engine/offscreenRenderer.ts`
- a small pure geometry/normalization helper under `src/render-engine/`
- focused unit tests beside that helper
- `src/render-engine/cardTemplate.test.ts`
- `scripts/verify-render-png.mjs`
- development-only Electron DPI smoke harness
- QA-only external packaged-app driver, excluded from `app.asar`
- `src/ui/App.tsx` only if user-facing error mapping is added
- `HANDOFF.md` and M20 evidence metadata after implementation

### Boundary rules

- Keep DOM geometry math in a pure helper where possible.
- Keep Electron capture orchestration in `offscreenRenderer.ts`.
- Keep packaged Pro free of `CARDNEWS_SMOKE_ACTION` and other internal QA branches.
- Keep final PNG dimension verification independent of UI state.
- Do not add a new rendering dependency unless existing Electron APIs cannot meet the verified acceptance criteria.
- Do not alter unrelated editor or AI code.

## 8. Execution Milestones

### M20-1. Freeze the regression with a DPI harness

Before changing renderer behavior:

- add a smoke action that renders one deterministic fixture;
- run it at device scale factors 1, 1.25, 1.5, 1.75, and 2;
- record expected and actual dimensions;
- prove the old implementation fails at one or more non-100% scales.

Exit criterion:

- reproducible red test/evidence exists.

### M20-2. Add pure geometry and normalization policy

- define rectangle rounding;
- define aspect tolerance;
- define frame-filling card geometry;
- define when normalization is permitted;
- unit-test valid and invalid device-scale cases.

Exit criterion:

- pure helper tests pass and reject unsafe stretch/crop cases.

### M20-3. Restore deterministic paint-event capture

- make render content sizing deterministic;
- set the render-only offscreen device scale factor explicitly to `1`;
- probe `.card` geometry;
- collect a stable post-readiness `paint` frame;
- remove production PNG dependence on `capturePage()`;
- normalize only guarded uniformly scaled full-card frames;
- keep exact final validation.

Exit criterion:

- targeted renderer integration tests pass at all DPI values.

### M20-4. Add diagnostics and user-facing mapping

- add stable render error codes;
- persist sanitized diagnostics;
- map the common error to concise Korean UI copy.

Exit criterion:

- injected failures produce useful diagnostics and no raw-log wall in the UI.

### M20-5. Run development regression matrix

- all four aspect ratios;
- representative no-photo and photo styles;
- default font and custom font;
- Lite and Pro;
- PNG and ZIP export paths.

Exit criterion:

- every target dimension and nonblank/content check passes.

### M20-6. Package in isolated output

- build unpacked Lite and Pro artifacts outside the final `release/` paths;
- run the external black-box DPI driver against packaged binaries without adding smoke code to Pro;
- install on a clean Windows VM or Windows Sandbox at multiple display scales;
- verify upgrade preserves user data.

Exit criterion:

- unpacked and installed artifacts pass the release gate.

### M20-7. Stage release and support materials

- copy verified installers and unpacked folders into release staging;
- generate SHA-256 checksums;
- update Lite/Pro guide and support note;
- append implementation evidence to `HANDOFF.md`.

Exit criterion:

- public artifacts are traceable to passing evidence metadata.

## 9. Acceptance Criteria

The milestone is complete only when all conditions are true:

1. The original Lite error is reproduced before the fix and no longer reproduces after it.
2. `기본 · 다크 인포` with `세로형 4:5 (인스타)` exports exactly `1080x1350` at 100%, 125%, 150%, 175%, and 200% scale.
3. All supported ratios export their exact documented sizes.
4. Output is visually nonblank, uncropped, and not stretched.
5. Lite and Pro pass the same shared renderer matrix.
6. The production PNG renderer uses offscreen `paint` frames rather than `capturePage()`.
7. Wrong-aspect or invalid card geometry is rejected rather than resized.
8. Failure diagnostics contain geometry and DPI facts without sensitive content.
9. Typecheck, unit tests, build, edition stripping, smoke, and package gates pass.
10. A clean installed Lite build passes on a Windows environment other than the build machine.
11. Upgrade testing confirms existing projects, backgrounds, fonts, and settings are preserved.

## 10. Risks and Mitigations

### Fractional DPI rounding

Risk: 125% or 175% scaling can produce fractional capture coordinates and one-pixel borders.

Mitigation: centralize rectangle rounding and test edge coordinates at every supported scale.

### Font/image readiness

Risk: correct dimensions can still hide incomplete content.

Mitigation: preserve readiness gates and add nonblank/visual parity checks.

### Multi-monitor DPI transition

Risk: Electron can recalculate scale when a window changes display.

Mitigation: use hidden deterministic content geometry and test launch/relaunch on monitors with different scales; never depend on visible monitor bounds.

### Paint lifecycle and stale frames

Risk: the first paint may contain only a background or pre-font placeholder.

Mitigation: subscribe before load, preserve readiness waits, explicitly invalidate after readiness, reject blank/unstable frames, and accept only a frame that satisfies the card geometry and pixel contract.

### Quality loss during normalization

Risk: downsampling can soften text.

Mitigation: capture at card-only geometry, use high-quality resizing, compare against the 100% reference, and reject output outside the visual threshold.

### False confidence from build-machine QA

Risk: default 100% scale passes while distributed systems fail.

Mitigation: make the DPI matrix a mandatory packaged-artifact gate and require an external clean Windows environment.

## 11. Evidence Contract

Implementation evidence root:

```text
.omc/evidence/v6/m20-dpi-safe-render-dimensions/
```

Each gate must write:

- command log;
- `.meta.json` with command, exit code, edition, artifact path, scale factor, expected dimensions, actual dimensions, timestamp, and SHA-256 where applicable;
- screenshots or PNG fixtures for visual checks;
- a concise `manual-qa.md` for steps that cannot be automated.

No EXE may be labeled distributable unless its checksum appears in a passing release-gate metadata file.

## 12. Technical References

- Electron offscreen rendering tutorial: `https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering`
- Electron `webContents` paint and capture API: `https://www.electronjs.org/docs/latest/api/web-contents`
- Electron 42 offscreen scale behavior change: `https://www.electronjs.org/blog/electron-42-0`
- Repository renderer contract: `.omc/plans/cardnews-rebuild-plan.md`
- Current implementation/history notes: `HANDOFF.md`
