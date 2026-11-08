# Test Spec: V6 M23 Canvas, Video Preview, Timeline, Export Quality, and Release

## 1. Scope and Gate Rule

This specification verifies `.omx/plans/prd-v6-m23-canvas-video-timeline-hardening.md`.

The test strategy is deliberately layered:

1. Unit tests prove normalization, identity, geometry, timeline, and argument construction.
2. Integration tests prove renderer DOM, live video lifecycle, frame ownership, and migration.
3. Real-pipeline tests render HTML cards through Electron/Chromium and encode with the bundled FFmpeg.
4. Quantitative media tests inspect frames and the final MP4.
5. Packaged-app and clean-VM tests prove that source-only behavior survives distribution.

No later gate runs after an earlier failure. “Known failure”, “manual check pending”, and “works on source” are not passing release verdicts.

## 2. Evidence Contract

Evidence root:

`.omc/evidence/v6/m23-canvas-video-timeline-hardening/`

Each gate writes:

- `{gate}.log`
- `{gate}.meta.json`
- any referenced screenshots, JSON probes, videos, frame directories, or reports

Minimum metadata schema:

```json
{
  "schemaVersion": 1,
  "milestone": "M23",
  "gate": "G0-context-and-red",
  "startedAt": "ISO-8601",
  "finishedAt": "ISO-8601",
  "command": "exact command",
  "cwd": "absolute path",
  "exitCode": 0,
  "sourceCommit": "git sha or null",
  "dirtyDigest": "sha256 of status/diff manifest",
  "edition": "shared|lite|pro",
  "machine": {},
  "inputs": [],
  "outputs": [],
  "assertions": [],
  "verdict": "pass"
}
```

Rules:

- A `pass` verdict requires exit code 0 and every assertion true.
- Missing evidence is `blocked`, not `pass`.
- Artifact entries include size and SHA-256.
- Video gates include OS build, CPU, GPU, RAM, FFmpeg version, encoder help output, and driver-visible encoder result.
- Screenshots include viewport size, display scale, card ratio, and selected test ID.
- A human QA note may supplement but never replace an automated acceptance assertion.
- Performance evidence without OS build, CPU, RAM, GPU, display scale, FFmpeg version, and encoder capability output is `blocked`.
- Preview/export media-origin evidence must prove that every resolved path is under a registered library or controlled per-run temporary root; arbitrary `file://` or out-of-root paths are release-blocking failures.

## 3. Required Fixtures

### F1. Legacy project fixtures

- M21 project without M22 media fields.
- M22 project with coarse semantic slots.
- M22 project containing global background media, one card-specific media override, video layers, scene timing, and transitions.
- M22 archive containing an already accepted 300-500MiB video metadata record; fixture may use a sparse/mock payload for unit coverage and a bounded real file for integration.

### F2. Semantic card fixture

One card containing:

- header and page number
- badge text and image
- two title lines
- subtitle
- three paragraphs
- three bullets
- source
- emphasis
- body number
- footer
- next hint

Each item has a unique text/color marker and stable content item ID.

### F3. Geometry matrix

- 100%, 125%, 150%, and 200% Windows display scale where CI/VM supports them.
- Portrait 4:5 and 9:16 card formats.
- Two font families, including a loaded user font.
- Long Korean text that wraps at least three lines.

### F4. Ownership/leak fixture

- Ten cards with unique solid corner markers.
- Card 1 alone owns a video with a moving forbidden magenta block and large white `CARD1_ONLY` marker.
- Card 2 has no video.
- Card 3 owns a different blue marker video.
- Later cards mix background images and no media.
- Transitions cover none, fade, slide-left, and slide-up.
- Persisted assignment JSON and expected ownership manifest are stored beside the fixture.

### F5. Video import fixtures

- Valid: MP4/H.264/yuv420p, 1080x1920, 30fps, AAC and no-audio variants.
- Boundary valid: exactly 300MiB metadata boundary, 180.000s, 60fps, maximum allowed pixel area.
- Invalid: 300MiB plus one byte, 180s plus one frame, 61fps, over-4K side, excessive pixel area, unsupported codec, unsupported container, malformed MP4, missing video stream.
- Cancellation fixture large enough to cancel during streaming copy.

### F6. Quality fixtures

- Motion/text stress video with scrolling Korean text, thin lines, gradients, and movement.
- Static card reference for lossless-vs-encoded SSIM/PSNR.
- Black/white frame sequence for blank-frame detection.
- Audio fixture with unique 440Hz and 880Hz tones owned by different cards.

### F7. User regression reference

- Probe metadata and sampled frames from `C:\Users\js480\Downloads\cardnews-2026-07-17.mp4`.
- The original user file is read-only input and is never overwritten.

## T1. RED Baseline and Root-cause Branching

Purpose: prove the current defect and prevent a broad unverified exporter patch.

Steps:

1. Build F4 with card-1-only video assignment.
2. Save persisted assignment and resolved ownership manifests.
3. Export with the pre-M23 pipeline.
4. Sample every frame or every frame in transition windows plus at least 10fps elsewhere.
5. Detect the forbidden marker after card 1.
6. Record DOM media IDs and loaded scene/card IDs before each sample.
7. Classify the first divergence:
   - persisted state wrong
   - inheritance resolver wrong
   - DOM/session stale
   - seek/decode timing wrong
   - transition compositor wrong
   - encoder-only artifact

Pass condition:

- The current defect is reproduced with an automated failure, or an evidence-backed narrower branch proves that only the user's persisted input is corrupt.
- The harness fails when a deliberate cross-card leak is injected.
- The harness passes when all non-owner media is removed.

Evidence:

- `G0-context-and-red.log/.meta.json`
- assignment JSON
- ownership JSONL
- DOM probe JSONL
- frame contact sheet and detector report
- attached MP4 ffprobe JSON

Release impact: implementation may not edit export ownership before T1 distinguishes the branch.

## T2. Semantic Item IDs and Legacy Migration

Assertions:

- Every F2 item receives a non-empty unique stable ID.
- Paragraph/bullet IDs survive reorder, text edit, save/load, and project archive round-trip.
- Deleting an item removes only its placement override.
- Adding an item does not reuse a still-live ID.
- M22 coarse title/subtitle/body/badge/footer placement is preserved through normalization.
- Migration backup is written before the first schema-changing save.
- A forced write failure leaves the original project byte-identical.

Target files:

- `src/domain/types*.test.ts`
- `src/domain/media.test.ts`
- `src/storage/projectArchive.test.ts`
- `src/ui/m22MediaUi.test.ts`

Pass condition: all assertions pass and F1 archives reopen in both editions.

## T3. Renderer Item Manifest and DOM Geometry

Assertions:

- Renderer emits exactly one `data-semantic-item-id` for every expected F2 item.
- No optional absent item gets a selectable empty rectangle.
- Geometry probe waits for `document.fonts.ready`, image completion, and selected video metadata/first-frame readiness.
- Measured rectangles are finite, positive, and within the board coordinate conversion.
- At every F3 supported scale, overlay edge error is no more than 2 CSS pixels.
- Scroll and board zoom do not change normalized placement.

Visual oracle:

- Save screenshots with renderer element outlines and overlay outlines in different colors.
- Pixel-difference script reports maximum and mean edge distance.

Pass condition: no item exceeds 2px maximum edge error.

## T4. Selection, Drag, Resize, Text Edit, and History

Playwright/Electron scenarios:

1. Click each F2 item and verify smallest topmost target selection.
2. Repeated click cycles overlapping items deterministically.
3. Drag each item to all four quadrants.
4. Exercise all eight handles.
5. Verify alignment guide and snap; verify modifier bypass.
6. Arrow nudge and Shift+Arrow nudge.
7. Undo and redo one whole gesture at a time.
8. Double-click text, edit Korean spacing/newlines, commit, cancel, and reload.

Assertions:

- Text container resize changes wrapping bounds, not font size.
- Media/shape/video resize changes the visual dimensions.
- Inline editor is transparent unless the element backdrop is explicitly non-transparent.
- Original glyphs are hidden while inline editing; duplicate visible glyph count is zero.
- An item remains recoverable inside the card after extreme drag.
- Saved placement equals reloaded placement within normalization tolerance.

Pass condition: every item kind passes the same transform suite.

## T5. Board, PNG, and MP4 Composition Equivalence

Create a golden F2 composition after several transforms.

Compare:

- central board screenshot
- PNG export
- decoded MP4 frame at the stable scene midpoint

Normalize only anti-aliasing and color-profile variance. Assert:

- item bounding-box center delta <= 2 output pixels
- item width/height delta <= 2 output pixels
- no missing or duplicated item
- text wrapping line count is identical
- z-order is identical

Pass condition: all three surfaces match the same saved composition.

## T6. Media Import Limits, Streaming, and Cleanup

Unit/integration assertions:

- `stat` rejects over-size input before reading the body.
- ffprobe validates duration, dimensions, pixel count, fps, codec, pixel format, and audio codec.
- Each invalid F5 file yields the exact Korean reason and allowed limit.
- Hash and copy use streaming I/O; test instrumentation proves no full-file buffer allocation.
- Cancellation removes partial files and media index entries.
- A valid boundary file is accepted.
- A plus-one boundary file is rejected.
- Legacy 300-500MiB archive media remains readable but cannot be duplicated as a new import.
- UI text, validator constants, archive limits, and usage guide are generated from or checked against one policy object.

Performance assertion:

- Import memory growth is bounded to stream buffers plus 100MiB on the reference machine.

Pass condition: no leaked file, index entry, stream, or process remains after any failure path.

## T7. Selected-card Live Video Playback

Scenarios:

- background video
- free video layer
- background plus free layer
- no-audio and AAC audio
- invalid/decode-failed source
- rapid card switching

Assertions:

- Selected card creates real `<video>` nodes with the expected safe URL and media IDs.
- Play advances `currentTime` and visible pixels change.
- Scrub lands within one frame of the requested time.
- Preview starts muted and audio requires user action.
- Inactive rail cards use posters and have zero live video decoders.
- Switching cards pauses and disposes previous nodes and revokes temporary URLs.
- After 50 card switches, live nodes and media URLs equal the selected card's expected count.
- Error state names the failed constraint and preserves the project.

Reference performance:

- First playable frame <= 2.0 seconds.
- Presented-frame ratio >= 95% over a 10-second 1080x1920/30 sample.

Pass condition: stale previous-card media IDs = 0.

## T8. Canonical Timeline Compilation

Unit assertions:

- Default ten-card project compiles to 30,000ms and 900 frames.
- Scene duration boundaries 500ms and 180,000ms normalize correctly.
- Total over 600,000ms is rejected.
- `fit-primary-video` equals trimmed clip length.
- Fixed scene longer than clip uses final-frame hold metadata.
- Frame-index-to-scene lookup is deterministic at every boundary.
- Transition overlap is represented exactly once.
- UI summary, preview, producer, audio, and exporter receive the same compiled digest.
- Removing duplicate producer timeline logic changes no accepted no-transition timestamps.

Pass condition: no consumer recomputes scene start/end independently.

## T9. Timeline UI and Interaction

Scenarios:

- 1, 10, 50, and 100 cards.
- mixed 0.5s, 3s, 30s, and 180s scenes.
- zoomed out and in.

Assertions:

- Segment width is proportional to compiled duration.
- Duration label and total update during and after handle drag.
- Numeric duration and drag handle stay synchronized.
- `영상 길이에 맞춤` uses trim length.
- Trim handles cannot cross and expose exact times.
- Transition control is located between the owning pair of scenes.
- Playhead scrubs the project within one frame.
- Space, Home, End, arrows, and focus order are accessible.
- Timeline layout remains stable without text/button overlap.

Pass condition: visual, keyboard, and compiled-data assertions pass at all card counts.

## T10. Frame Ownership, Seek, and End Behavior

For every F4 output frame, log the expected and actual ownership manifest.

Assertions:

- Loaded card index equals compiled scene card index.
- Actual active media IDs exactly equal expected IDs.
- Non-owner media causes capture failure before the frame is written.
- Active video seek waits for `seeked` and a decoded-frame callback.
- Local time is clamped, not modulo-looped.
- A scene longer than its clip holds the final frame.
- A scene shorter than its clip never samples after trim-out.
- Renderer and video sessions close after scene completion and cancellation.

Pixel oracle:

- `CARD1_ONLY` marker count after card 1 = 0.
- Card-specific corner marker mismatch count = 0.

Pass condition: ownership mismatch and forbidden marker counts are both zero.

## T11. Transition Rendering

Test `none`, `fade`, `slide-left`, and `slide-up` at 0ms, 250ms, 500ms, and allowed maximum overlap.

Assertions:

- Outgoing and incoming cards are rendered in independent scene surfaces.
- Transition progress at first/mid/last overlap frames matches expected composition.
- No third-card or stale media ID appears.
- Preview and MP4 transition boundary differ by no more than one frame.
- Transition duration cannot exceed normalized scene constraints.
- An unavailable compositor path fails before FFmpeg starts.

Pass condition: pixel fixture and ownership fixture both pass every transition variant.

## T12. FFmpeg Capability and Quality-profile Preflight

Use the bundled binaries only.

Required checks:

- `ffmpeg -version`
- `ffmpeg -h encoder=h264_mf`
- two-second trial encode using the intended `rate_control`, `quality`, `scenario`, bitrate, buffer, pixel format, and GOP arguments
- ffprobe of trial output

Assertions:

- Encoder starts and produces H.264 yuv420p at 1080x1920/30.
- Trial output duration/frame count is correct.
- Keyframe spacing is at most 60 frames.
- Rate-control/profile options are reflected in stderr and actual output behavior.
- A forced unsupported-option fixture fails preflight with actionable Korean text.

Pass condition: actual encoder behavior, not argument presence, satisfies the profile.

## T13. Real MP4 Quality and Integrity

Run the complete card-renderer-to-FFmpeg pipeline.

Assertions:

- Resolution: 1080x1920.
- Frame rate: 30/1.
- Pixel format: yuv420p.
- Codec: H.264.
- Duration difference: <= 33.34ms.
- Frame-count difference: <= 1.
- GOP: <= 60 frames.
- Motion/text fixture average video bitrate: >= 6Mbps.
- Static fixture: SSIM >= 0.97 and PSNR >= 36dB.
- Blank-frame detector: 0 unexpected frames.
- Forbidden-marker detector: 0 after owner scene.
- No mysterious white-text/ghost region exists outside the expected composition. For the 30-second F4 fixture, decode and compare all 900 frames against the lossless expected frame at the same compiled timestamp. Ignore only pixels with maximum channel delta below 48 and connected components below 64 pixels. Fail when the remaining unexpected area exceeds 0.02% of a frame, when any forbidden marker/OCR token appears outside its owner scene, or when any connected component overlaps a protected text-safe region not present in the expected frame.

Regression assertion:

- The high profile must reject or clearly fail any result with attached-output-equivalent ~0.204Mbps quality.

Pass condition: all quantitative assertions pass on the reference machine and packaged smoke machine.

## T14. Audio Ownership and A/V Sync

Assertions:

- No-audio project has no unintended audio stream.
- One primary audio source per card is audible; all other sources are muted.
- 440Hz and 880Hz tones appear only in their owner intervals.
- Transition overlap follows the documented audio crossfade/mute rule.
- Audio start/end differs from video by <= 50ms.
- Cancellation cleans temporary audio files.

Pass condition: frequency ownership and sync checks pass.

## T15. M21/M22, PNG, and Edition Regression

Required commands, followed by M23-targeted tests:

```powershell
npm run typecheck
npm test
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
npm run build:pro
```

Additional assertions:

- Existing M21 editing, clipboard, bulk-binding schema, and PNG behaviors remain green.
- Existing M22 media assignment, project archive, and AI default-instruction tests remain green.
- Lite exposes shared M23 editor/video controls.
- Lite source output contains zero AI/provider/bulk forbidden symbols.
- Pro AI/bulk smoke remains green.

Pass condition: all commands exit 0 and no snapshot is updated without an explained intended UI change.

## T16. Performance, Accessibility, and Failure UX

Measure on source and packaged builds:

- editor idle CPU with selected static card
- editor CPU/memory with selected video playing
- timeline interaction latency with 100 cards
- memory after 50 card switches
- export cancel latency and process cleanup

Thresholds:

- Pointer-to-transform visual response p95 <= 50ms on reference machine.
- Timeline duration update p95 <= 100ms.
- Memory after switch loop returns within 15% of settled baseline after GC/idle window.
- Cancel acknowledgement <= 1 second; child processes gone <= 5 seconds.
- No unlabeled timeline controls or keyboard traps.
- Korean error messages contain cause, limit, and recovery action.

Pass condition: thresholds and accessibility assertions pass.

## T17. Isolated Lite/Pro Packaging and Fresh-profile Smoke

Packaging must use a unique run root, for example:

`.omc/build/m23-{runId}/{lite|pro}/`

It must not write a final release folder directly.

For each edition:

1. Build and edition-verify source outputs.
2. Package unpacked and installer outputs.
3. Run package-security checks.
4. Scan unpacked files and `app.asar` for edition correctness.
5. Launch unpacked EXE with a unique user-data directory.
6. Open F2/F4 project, play selected video, move/resize text, export MP4, and run T13 probes.
7. Install to a clean per-run location/profile and repeat the critical smoke.
8. Close the app and verify no process remains.

Assertions:

- Source, packaged, and installed behavior are consistent.
- Lite has zero forbidden symbols.
- Installer and unpacked artifacts have recorded hashes.
- No runtime path points back to the source workspace.
- App data is written only to intended user-data/media roots.

Pass condition: both editions pass unpacked and installed fresh-profile smoke.

## T18. Clean Windows VM, Staging, Rollback, and Handoff

Clean VM prerequisites:

- Supported Windows version with no Node/npm/source workspace.
- Snapshot before install.
- Display scale 100% and one non-100% pass where practical.

VM scenarios for Lite and Pro:

- installer launch and install
- first launch
- bundled/default assets load
- import valid MP4
- central-board playback
- semantic drag/resize
- timeline duration/trim/transition
- MP4 export and T13 probe
- app close, uninstall, and residue inspection

Staging rules:

- Only after VM pass, copy artifacts to `release/distribution/Cardnews-Studio-M23-{runId}/`.
- Compare source isolated-output SHA-256 with staged SHA-256.
- Write `distribution-manifest.json`, `SHA256SUMS.txt`, user guide, release notes, evidence index, and rollback target.
- Set manifest `status` to `approved` only after all checks.
- On failure, retain evidence, mark the candidate `rejected`, and keep M22 as current rollback distribution.
- Append results to `HANDOFF.md`.

Pass condition:

- VM verdicts pass for both editions.
- Hash mismatch count = 0.
- Manifest/evidence references resolve.
- Previous M22 folder is unchanged.

## 4. Gate Mapping

| Gate | Tests | Required verdict |
| --- | --- | --- |
| G0 context and RED | T1 | pass |
| G1 schema round-trip | T2 | pass |
| G2 board geometry | T3-T5 | pass |
| G3 preview and import | T6-T7 | pass |
| G4 timeline consistency | T8-T9 | pass |
| G5 ownership and transition | T10-T11 | pass |
| G6 video quality | T12-T14 | pass |
| G7 regression/editions/security | T15-T16 | pass |
| G8 isolated package | T17 package half | pass |
| G9 fresh-profile package smoke | T17 smoke half | pass |
| G10 clean VM install smoke | T18 VM half | pass |
| G11 stage and handoff | T18 staging half | pass |

## 5. Requirement Traceability

| PRD requirement | Tests |
| --- | --- |
| R1 RED reproduction | T1 |
| R2 semantic identity/migration | T2 |
| R3 transforms | T3-T5 |
| R4 live playback | T7 |
| R5 import safety | T6 |
| R6 timeline/UI | T8-T9 |
| R7 media isolation | T10 |
| R8 transitions | T11 |
| R9 MP4 quality | T12-T14 |
| R10 performance/accessibility | T16 |
| R11 edition safety | T15, T17 |
| R12 release/rollback | T17-T18 |

## 6. Standard Verification Sequence

Implementation creates an M23 gate runner that executes tests in the following order and refuses to skip a failed prerequisite:

```powershell
omx ultragoal create-goals --force --brief-file .omx/plans/m23-ultragoal-brief.md --json
omx ultragoal status --json
omx ultragoal complete-goals --json
npm run typecheck
npm test
node scripts/verify-m23-red.mjs
node scripts/verify-m23-canvas.mjs
node scripts/verify-m23-preview.mjs
node scripts/verify-m23-timeline.mjs
node scripts/verify-m23-video-pipeline.mjs
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
npm run build:pro
node scripts/package-m23-release.mjs --phase isolated
node scripts/package-m23-release.mjs --phase fresh-profile-smoke
node scripts/package-m23-release.mjs --phase stage --require-vm-evidence
```

The first `status` output must reference the M23 brief/PRD and must not reference the stale M13 PRD. In the same Codex task, clear a completed prior aggregate goal with `/goal clear` before creating the M23 Codex goal; alternatively execute M23 in a new task.

The `verify-m23-*` and `package-m23-release.mjs` commands are planned M23 harness additions, not claims that they already exist.

## 7. Completion Rule

The milestone cannot be marked complete when any of the following is true:

- A required test is skipped or evidence is missing.
- The attached-user regression or F4 ownership fixture leaks one frame.
- Board/PNG/MP4 geometry exceeds tolerance.
- Video quality depends only on command-line arguments rather than measured output.
- Lite source or package contains one forbidden symbol.
- Only source or unpacked app was tested.
- Clean Windows VM evidence is absent.
- Staged hashes differ from isolated outputs.
- M22 was overwritten or rollback is undefined.

Only all-green G0-G11 evidence authorizes a public-ready M23 Lite/Pro distribution.
