# Test Specification: V6 M24 Export, Media, Editor Geometry, and UX Hardening

Status: RALPLAN consensus approved on 2026-07-17

Companion PRD:
`.omx/plans/prd-v6-m24-export-media-editor-ux-hardening.md`

## 1. Purpose

This specification proves that M24 resolves the nine reported problems in source, Lite, Pro, portable, installed, and clean Windows VM environments.

The release contract is fail-closed. A mandatory result of `fail`, `blocked`, `skipped`, `stale`, or missing evidence prevents staging to `release/`.

This document defines future implementation and verification work. Commands for `verify-m24-*` and `package-m24-release.mjs` are planned additions and do not exist merely because they are named here.

## 2. Claims to Prove

1. Every card can store and export its own exposure duration.
2. Semantic overlays and visible title, subtitle, body, badge, footer, next hint, page number, and media occupy the same card-coordinate geometry.
3. Clicking an item does not move it, and dragging does not jump.
4. Importing media and assigning media are distinct and understandable operations.
5. One `내보내기` action offers PNG and MP4 without duplicate top-level export paths.
6. Timeline visibility follows persisted video-project mode and remains available for photo reels.
7. MP4 export always completes, cancels, or fails with a classified phase before a bounded timeout.
8. The selected card displays a real moving video preview when the asset is supported.
9. Missing Pro CLI providers expose safe official install actions; Lite contains no executable AI or installer bridge.
10. The reorganized menu preserves all supported actions, keyboard access, and edition boundaries.
11. Lite and Pro artifacts staged for distribution are byte-identical to the isolated artifacts that passed verification.

## 3. Evidence Contract

Evidence root:

`.omc/evidence/v6/m24-export-media-editor-ux-hardening/`

Every gate directory must contain:

- `run.log`: command, environment, start/end time, exit code, and concise result;
- `<gate>.meta.json`: machine-readable result;
- supporting screenshots, JSON, traces, pixel samples, process inventories, or hashes when required.

Minimum `.meta.json` shape:

```json
{
  "schemaVersion": 1,
  "milestone": "M24",
  "gate": "G0-workspace-inventory",
  "edition": "shared",
  "status": "pass",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601",
  "commit": "git-sha",
  "command": "exact command",
  "exitCode": 0,
  "artifacts": [],
  "assertions": [],
  "limitations": []
}
```

Rules:

- `status` is one of `pass`, `fail`, `blocked`, `skipped`.
- `stale` is derived rather than stored. Evidence is stale when its recorded commit, dirty-state digest, fixture hash, dependency evidence hash, or packaged source hash differs from the release candidate.
- A package gate may read earlier metadata but may not rewrite it.
- A later gate starts only when all mandatory predecessors are fresh `pass`.
- Screenshots alone are not sufficient for geometry, playback, cleanup, or edition-stripping claims.

## 4. Test Fixtures

### F1. Semantic geometry deck

A deterministic 10-card fixture containing:

- title, subtitle, body, badge, footer, next hint, page number, header;
- one free text box, one shape, one line, one image layer, one video layer;
- default flow placement and explicit saved card placement variants;
- left, center, and right alignment;
- portrait 4:5 and square ratios;
- a visual layout matching the reported screenshot failure.

### F2. Duration decks

- 1 card: `0.5s`;
- 3 cards: `1.25s`, `3s`, `8.75s`;
- 10 cards: mixed durations and transitions;
- 50 cards: mixed durations for performance and accumulated frame-error checks;
- legacy archive with no explicit video-project mode and default `3000ms`.

### F3. Media library

- supported H.264/AAC MP4 under the product import limit;
- supported silent H.264 MP4;
- supported PNG/JPEG;
- unsupported codec container;
- over-limit file;
- deleted/missing asset;
- duplicate display names with unique asset IDs;
- path containing Korean, spaces, and parentheses.

### F4. Export fault injection

Deterministic hooks for:

- FFmpeg executable discovery stall;
- preflight process stall;
- frame-producer initialization stall;
- first-frame stall;
- mid-render no-progress stall;
- encoder backpressure stall;
- final drain/exit stall;
- renderer crash;
- user cancellation in each phase.

Fault injection is enabled only in test builds and cannot be activated from production UI.

### F5. CLI provider states

- Codex installed;
- Claude Code installed;
- neither installed;
- executable found but version check fails;
- package manager unavailable;
- installer exits non-zero;
- provider registry tampering attempt;
- user-authored text containing shell metacharacters.

### F6. Legacy project archives

Representative M21, M22, and M23 project archives, including projects without:

- explicit duration overrides;
- explicit video-project mode;
- materialized semantic placement;
- current media metadata.

### F7. Menu and action inventory

A checked-in manifest of every supported command before M24:

- command ID;
- edition availability;
- old location;
- new location;
- keyboard path;
- accessible name;
- expected disabled/locked state.

### F8. Packaging profiles

- isolated Lite build root;
- isolated Pro build root;
- fresh portable user-data directory;
- fresh installed-user profile;
- clean Windows VM snapshot.

## 5. Quantitative Acceptance Thresholds

### Geometry

- Overlay-versus-rendered bounding-box edge error: at most `2 CSS px`.
- Test zoom: `50%`, `100%`, `200%`.
- Test Windows display scaling: `100%`, `125%`, `150%`.
- Test ratios: portrait 4:5 and square 1:1.
- Click movement below the drag threshold: `0` persisted geometry change.
- Drag activation threshold: `4 CSS px`.
- First active drag frame jump: at most `2 CSS px`.
- Keyboard nudge: exactly `1 CSS px`; modified nudge: exactly `10 CSS px`.
- One drag or resize gesture creates exactly one undo transaction.

### Duration and timeline

- Editable range: `0.5s` to `180s` per card.
- UI precision: `0.05s` or finer.
- Timeline and exported duration difference: no more than one output frame.
- Fifty-card accumulated frame error: no more than one output frame.
- Legacy cards without overrides remain `3s`.

### Video preview

- Two sampled preview frames at distinct seek times must differ by the fixture's expected pixel threshold.
- Selected-card preview uses a real video element and advances `currentTime`.
- Non-selected thumbnails may use posters and must not start simultaneous playback.
- Card switch, asset removal, and panel close release object URLs and stop playback.

### Export liveness

- Progress heartbeat gap while work is active: at most `2s`.
- Preflight timeout target: `30s`.
- Producer initialization/first-frame timeout target: `45s`.
- Render no-progress timeout target: `30s`.
- Final drain/exit timeout target: `60s`.
- Injected timeout termination tolerance: configured threshold plus or minus `2s`.
- Every timeout/cancel leaves zero orphan FFmpeg, renderer, or helper processes.
- Every timeout/cancel removes temporary frames and partial output unless explicitly preserved as a diagnostic artifact.

### Responsiveness

- Typing in title/body controls must not synchronously regenerate the full timeline or re-read media bytes.
- Baseline and post-change keystroke-to-preview latency are measured on the same fixture and machine.
- M24 may not regress median latency by more than `15%` or exceed `100ms`, whichever is stricter for the established baseline.
- Timeline rendering for 50 cards must remain under the recorded M23 baseline plus `15%`.

## 6. Test Cases

### T1. RED baseline and root-cause capture

Purpose:
Prove the reported failures before implementation.

Procedure:

1. Load F1 and capture overlay and rendered rectangles.
2. Click and drag title, badge, page number, footer, and next hint.
3. Load F3 video and record the blank preview.
4. invoke MP4 export with F4 preflight stall and record `prepare · 10%`.
5. inventory duplicate import/export actions and always-visible timeline.

Pass:

- the harness deterministically reproduces at least the geometry mismatch, blank video, and export-stall classes;
- evidence identifies the actual failing phase rather than relying on the displayed percentage;
- RED assertions fail for the expected reason.

### T2. Per-card duration domain and archive compatibility

Trace:
R1, R5.

Procedure:

1. Unit-test normalization and decimal-second conversion.
2. Edit durations in F2 through the intended UI.
3. save, reload, duplicate, delete, undo, and redo cards.
4. compile the canonical timeline.
5. export and inspect media duration.
6. load F6 legacy archives.
7. round-trip through `DeckDraft`, `Deck`, `DeckPreset`, `WorkspaceState`, project archives, Lite sanitizers, and packaged load paths.

Pass:

- each card keeps its own value;
- total and frame ranges equal the compiled timeline;
- legacy cards remain `3000ms`;
- invalid values are rejected or normalized without corrupting the project.

### T3. Video-project mode and timeline visibility

Trace:
R5.

Procedure:

1. Open a photo-only legacy project.
2. enable `영상 만들기`.
3. disable and re-enable it.
4. import and assign a video to the current card.
5. remove the last video.
6. save and reopen.

Pass:

- timeline is hidden in card-only mode;
- manual photo-reel enable persists;
- first video assignment enables video mode with an explicit notice;
- removing the last video does not silently destroy the user's persisted video mode;
- session collapse state does not alter the project mode.

### T4. Semantic identity and geometry authority

Trace:
R2.

Procedure:

1. Enumerate semantic IDs in editor HTML and export HTML.
2. assert exactly one ownership element per ID per card.
3. compare overlay rectangles to rendered DOM rectangles for F1 across required zoom and DPI values.
4. materialize flow placement and reload the project.
5. compare board, PNG, and MP4-frame coordinates.

Pass:

- duplicate or missing semantic ownership fails the test;
- all edge errors are within `2 CSS px`;
- stored normalized placement is authoritative after materialization;
- renderer placement is card-relative and does not use viewport-fixed geometry.

### T5. Click, drag, resize, keyboard, and history behavior

Trace:
R2.

Procedure:

1. pointer down/up with movement under `4 CSS px`;
2. drag in eight directions;
3. resize each handle;
4. nudge with keyboard;
5. undo/redo each gesture;
6. repeat at required zoom and display scaling.

Pass:

- a click selects without movement;
- dragging begins only after threshold;
- no first-frame jump exceeds `2 CSS px`;
- pointer capture remains stable;
- one gesture equals one history transaction.

### T6. Board, PNG, and MP4 visual parity

Trace:
R2, R4, R6, R8.

Procedure:

1. render F1 on the board.
2. export PNG.
3. export MP4 and extract the matching frame.
4. compare semantic rectangles and pixel samples.

Pass:

- semantic geometry stays within the geometry threshold;
- no element appears in another card's frame;
- no editor label or selection overlay leaks into output;
- text and media z-order agree across surfaces.

### T7. Beginner-safe media import and assignment

Trace:
R3.

Procedure:

1. import image and video through the single media entry.
2. choose each target: current-card background, all-card background, current-card video layer, library only.
3. cancel the assignment sheet.
4. reassign an existing library asset without reimport.
5. delete or replace an assigned asset.

Pass:

- import and assignment are visibly separate;
- every operation states its target card/scope before commit;
- cancellation creates no assignment;
- library-only import changes no card;
- duplicate names remain distinguishable by asset ID and metadata.

### T8. Real selected-card video preview

Trace:
R8.

Procedure:

1. assign supported video to one card.
2. play, pause, seek, mute, and switch cards.
3. sample two distinct frames.
4. package and repeat in Lite and Pro portable and installed builds.
5. test unsupported codec, over-limit media, and missing asset.
6. capture source URL/protocol, asset lookup, metadata/seek events, codec result, packaged-path resolution, and overlay visibility so a blank preview cannot be attributed to missing `liveVideo` wiring without evidence.

Pass:

- supported video visibly advances and frame samples differ;
- controls update the selected card only;
- other card thumbnails do not start hidden playback;
- unsupported media receives a specific import/preview error, not a blank color surface;
- cleanup requirements are met.

### T9. Unified Export dialog

Trace:
R4.

Procedure:

1. activate the top-right `내보내기` action.
2. select PNG current card, PNG all cards ZIP, and MP4.
3. navigate with keyboard and screen-reader labels.
4. search the rendered UI for obsolete duplicate primary actions.

Pass:

- one primary export entry opens one dialog;
- format-dependent options appear only for the selected format;
- PNG and MP4 preserve existing capability;
- no top-level `PNG 생성` duplicate remains;
- dialog focus is trapped and restored correctly.

### T10. Export phase state machine and watchdog

Trace:
R6.

Procedure:

1. run a normal export and record every phase.
2. inject each F4 stall.
3. observe UI heartbeat and elapsed time.
4. inspect diagnostics and process state.

Pass:

- phases are `compile`, `preflight`, `producer_init`, `render`, `encode`, `finalize`;
- `stage` is the only canonical progress field in domain, API, renderer, Lite/Pro preload, Lite/Pro main process, and diagnostics;
- any temporary `phase` compatibility adapter is removed before G8;
- progress never remains indefinitely at a percentage;
- each injected stall terminates within its threshold tolerance;
- user sees phase, elapsed time, card/frame context, and an actionable retry/detail choice;
- diagnostic data is sanitized.

### T11. Cancellation and orphan cleanup

Trace:
R6.

Procedure:

1. cancel in every phase.
2. close the export dialog and app during rendering.
3. simulate renderer failure.
4. inspect processes, temporary roots, and partial outputs.

Pass:

- cancellation is idempotent;
- no orphan process, temporary frame set, lock, or misleading complete output remains;
- a subsequent export succeeds without reboot.

### T12. CLI discovery, install safety, and Lite stripping

Trace:
R7.

Procedure:

1. run F5 provider states in Pro.
2. compare provider recipes to current official documentation.
3. inspect confirmation UI and spawned command arguments.
4. attempt registry and user-input command injection.
5. build Lite and scan source bundles, preload bridges, IPC handlers, and UI.
6. confirm existing Gemini discovery remains behaviorally unchanged while no Gemini install recipe is introduced.

Pass:

- installed providers show version and no install action;
- missing providers show a provider-specific, fixed recipe;
- installation requires explicit confirmation and visible progress/terminal;
- no user-authored shell string is executed;
- non-zero exit reports failure and provider status refreshes;
- Lite has zero provider install recipe, IPC install channel, process bridge, or enabled AI action.

### T13. Menu information architecture and accessibility

Trace:
R3, R4, R5, R9.

Procedure:

1. compare F7 inventory before and after.
2. complete first-time flows: create card, import media, edit content, enter video mode, export.
3. navigate by keyboard.
4. inspect accessible names, focus order, collapsed advanced sections, and narrow viewport behavior.

Pass:

- every retained action maps to exactly one primary location and any intentional contextual shortcut;
- primary tabs are `콘텐츠`, `디자인`, `미디어`, `내보내기`;
- advanced controls are collapsed without becoming undiscoverable;
- controls do not overlap, clip, or require horizontal page scrolling at supported viewport sizes;
- Lite locked/hidden behavior remains clear.

### T14. Responsiveness and render-count regression

Trace:
R9.

Procedure:

1. profile typing, selection, dragging, media import, timeline updates, and card switching.
2. compare React render counts and latency to the recorded baseline.
3. run the 50-card F2 fixture.

Pass:

- quantitative responsiveness thresholds pass;
- media bytes and timeline compilation are not repeated on unrelated keystrokes;
- drag remains visually continuous at supported zoom levels.

### T15. M21-M23 regression suite

Trace:
R10.

Procedure:

1. run existing standard tests.
2. execute prior M21, M22, and M23 verification suites.
3. open F6 archives and perform PNG/MP4 exports.

Pass:

- no established editor, bulk, media, render, archive, or edition behavior regresses;
- any intentionally changed UI path is documented in migration/help text.

### T16. Edition source and package scan

Trace:
R7, R10.

Procedure:

1. build Lite and Pro independently.
2. run `verify-edition.mjs` against source output and unpacked packages.
3. scan for Pro-only symbols, commands, IPC channels, and provider recipes in Lite.

Pass:

- Lite prohibited count is zero;
- Pro contains required provider functionality;
- shared M24 editor/media/export fixes exist in both.

### T17. Isolated package, portable, and installed fresh-profile smoke

Trace:
R6, R8, R10.

Procedure:

1. package Lite and Pro under isolated roots.
2. run portable builds with fresh user-data.
3. install to clean local test profiles.
4. execute geometry, video preview, PNG, MP4, cancel/retry, and archive smoke tests.
5. collect hashes and crash logs.

Pass:

- both editions launch and exit cleanly;
- real video playback and export pass in packaged protocols;
- no source-only filesystem assumptions exist;
- portable and installed outputs match their source behavior.

### T18. Clean Windows VM, staging, rollback, and handoff

Trace:
R10.

Procedure:

1. restore a clean Windows VM snapshot.
2. install Lite and Pro independently.
3. run the public-user smoke checklist.
4. uninstall and inspect leftovers.
5. compare isolated artifact hashes to proposed staged copies.
6. append `HANDOFF.md`.

Pass:

- VM test passes without repository, Node project dependencies, or developer environment assumptions;
- installer and uninstall behave correctly;
- staged hashes match isolated verified hashes;
- previous distributions remain unchanged;
- rollback target and artifact inventory are recorded.

## 7. Requirement Traceability

| User request | PRD requirement | Primary tests |
| --- | --- | --- |
| Per-card exposure duration | R1 | T2, T3, T6 |
| Misaligned/jumping selection boxes | R2 | T1, T4, T5, T6 |
| Confusing media import/assignment | R3 | T7, T13 |
| One Export flow for PNG/MP4 | R4 | T9, T13 |
| Conditional timeline/photo reels | R5 | T2, T3, T13 |
| `prepare · 10%` stall | R6 | T1, T10, T11, T17 |
| Install missing Codex/Claude CLI | R7 | T12, T16 |
| Blank video preview | R8 | T1, T8, T17 |
| Cluttered menus | R9 | T13, T14 |
| Debug, package, and distribute | R10 | T15-T18 |

## 8. Gate Matrix

| Gate | Purpose | Required tests | Predecessor |
| --- | --- | --- | --- |
| `G0-workspace-inventory` | Workspace and immutable release inventory | repository status, artifact hashes | none |
| `G1-red-reproduction` | RED reproduction | T1 | `G0-workspace-inventory` |
| `G2-schema-duration-migration` | Schema, duration, migration | T2, T3 | `G1-red-reproduction` |
| `G3-geometry-interactions` | Geometry and interactions | T4, T5, T6 | `G2-schema-duration-migration` |
| `G4-media-live-preview` | Media flow and live preview | T7, T8 | `G3-geometry-interactions` |
| `G5-export-liveness` | Unified export and liveness | T9, T10, T11 | `G4-media-live-preview` |
| `G6-cli-safety-lite-stripping` | Pro CLI safety and Lite stripping | T12 | `G5-export-liveness` |
| `G7-menu-accessibility-performance` | Menu IA, accessibility, performance | T13, T14 | `G6-cli-safety-lite-stripping` |
| `G8-shared-regression` | Shared regression | T15 | `G7-menu-accessibility-performance` |
| `G9-lite-source-build` | Lite source/build verification | T16 Lite | `G8-shared-regression` |
| `G10-pro-source-build` | Pro source/build verification | T16 Pro | `G9-lite-source-build` |
| `G11-isolated-package` | Isolated package verification | T17 package | `G10-pro-source-build` |
| `G12-portable-installed-smoke` | Portable and installed smoke | T17 runtime | `G11-isolated-package` |
| `G13-clean-vm-stage-handoff` | Clean VM, staging, handoff | T18 | `G12-portable-installed-smoke` |

## 9. Standard Verification Commands

The implementation milestone must add and document the M24-specific scripts named below. Until then, they are specifications, not proof.

```powershell
npm run typecheck
npm test
node scripts/verify-m24-red.mjs
node scripts/verify-m24-duration.mjs
node scripts/verify-m24-geometry.mjs
node scripts/verify-m24-media-preview.mjs
node scripts/verify-m24-export-watchdog.mjs
node scripts/verify-m24-cli-safety.mjs
node scripts/verify-m24-ux.mjs
node scripts/verify-m24-regression.mjs

npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron

npm run build:pro
node scripts/verify-edition.mjs --edition pro --scan dist dist-electron

node scripts/package-m24-release.mjs --phase isolated
node scripts/package-m24-release.mjs --phase portable-smoke
node scripts/package-m24-release.mjs --phase installed-smoke
node scripts/package-m24-release.mjs --phase stage --require-vm-evidence
```

The implementation may split commands for maintainability, but the assertions and fail-closed ordering cannot be weakened.

## 10. Manual QA Checklist

Run in Lite and Pro unless explicitly Pro-only:

1. Create a three-card photo reel with `1.25s`, `3s`, and `8.75s` durations.
2. Select, click, drag, resize, undo, and redo every semantic item.
3. Import one image and assign it first to the current card, then all cards.
4. Import one video and assign it to only card 2.
5. play and seek card 2; verify cards 1 and 3 show no leaked video.
6. export current PNG, all PNG ZIP, and MP4 from the same dialog.
7. cancel MP4, retry, and complete.
8. close and reopen the project; confirm mode, durations, placements, and assignments.
9. resize the app and inspect labels, panels, and timeline.
10. in Pro, test one installed and one missing CLI state.
11. in Lite, confirm AI and CLI installation controls are absent or securely locked according to the edition contract.

## 11. Release Stop Conditions

Stop staging immediately when any of the following is true:

- a G0-G13 metadata file is missing, stale, or not `pass`;
- geometry exceeds the threshold at any required zoom or DPI;
- a supported selected-card video remains blank or does not advance;
- any injected export stall exceeds its bounded timeout;
- an orphan process or partial output remains after cancel/failure;
- Lite contains any Pro CLI installation or process bridge;
- packaged behavior differs from source behavior;
- clean VM evidence is absent;
- staged artifact hash differs from isolated verified artifact hash;
- a previous public release would be overwritten.

## 12. Completion Rule

M24 is complete only when:

- T1-T18 pass with fresh evidence;
- G0-G13 are fresh `pass` in dependency order;
- Lite and Pro portable and installed artifacts pass fresh-profile tests;
- the clean Windows VM gate passes;
- proposed release artifacts are staged by hash-preserving copy from isolated verified roots;
- `HANDOFF.md` is append-only updated with commands, evidence, artifact paths, known limitations, and rollback instructions.
