# PRD: V6 M23 Canvas, Video Preview, Timeline, Export Quality, and Release Hardening

## 1. Goal

M23은 M22에서 추가된 직접 편집과 영상 내보내기를 실제 배포 가능한 제작 도구 수준으로 닫는다. 완료 결과는 다음과 같다.

1. 사용자는 중앙 작업보드에서 보이는 제목, 소제목, 각 문단, 각 불릿, 배지, 푸터 및 보조 요소를 실제 렌더 영역과 맞는 테두리로 선택한다.
2. 선택한 요소를 드래그하고 8방향 핸들로 크기를 조절하며, 같은 좌표가 미리보기, PNG, MP4에 일관되게 적용된다.
3. 선택 카드에 배정한 업로드 영상이 중앙 작업보드에서 실제 재생되고 다른 카드로 이동하면 완전히 정리된다.
4. 카드별 장면 길이, 영상 구간, 전환을 한눈에 조절하는 제한형 CapCut 스타일 타임라인을 제공한다.
5. MP4는 1080x1920/30fps에서 텍스트가 뭉개지지 않고 카드 간 영상 누수가 0건이어야 한다.
6. Lite/Pro 소스 검증, 격리 패키징, fresh-profile smoke, clean Windows 설치 검증을 통과한 새 설치형/무설치형만 M23 배포 폴더에 들어간다.

“실패가 없어야 한다”는 요구는 무오류를 선언하는 방식이 아니라, 재현 가능한 실패를 먼저 테스트로 고정하고 한 게이트라도 실패하면 배포물을 만들거나 최신 배포로 표시하지 않는 방식으로 충족한다.

## 2. Source of Truth

- Context snapshot: `.omx/context/m23-video-editor-debug-20260717T102000Z/context.md`
- Planner draft: `.omx/plans/m23-video-canvas-release-plan.md`
- User MP4: `C:\Users\js480\Downloads\cardnews-2026-07-17.mp4`
- User MP4 SHA-256: `7430FEE21713CC771AADAC7FE8038508E7B003689E1D9A2E50E678AF0A50A1BE`
- User screenshot: `C:\Users\js480\AppData\Local\Temp\codex-clipboard-39a1f320-f8ca-4eac-8e15-dd58434f4990.png`
- Forensic frames: `.omx/context/m23-video-editor-debug-20260717T102000Z/`
- Parent requirements: `.omx/plans/prd-v6-m22-media-video-canvas-ai.md`
- Parent tests: `.omx/plans/test-spec-v6-m22-media-video-canvas-ai.md`
- This PRD's test contract: `.omx/plans/test-spec-v6-m23-canvas-video-timeline-hardening.md`

If implementation and this document disagree, this PRD and its test spec win for M23. M21/M22 behavior not explicitly changed here remains a regression contract.

## 3. Confirmed Findings

### 3.1 Attached export

`ffprobe` confirms that the attached output is 1080x1920, 30fps, 900 frames, and exactly 30 seconds. That is ten fixed three-second cards. Its video bitrate is only 203,682bps and total file size is 768,361 bytes. This is not an acceptable 1080x1920 text-heavy export profile.

Forensic frames also prove that card-1 source-video content appears again during later-card intervals. The exact first cause is not yet proven, so M23 begins with a synthetic ownership fixture and separate state/DOM/frame diagnostics.

### 3.2 Editor

- The semantic model currently groups the whole body into one slot.
- Paragraphs and bullets do not have stable rendered item IDs.
- Custom layers have resize handles, but semantic items do not.
- Overlay geometry is not seeded from every rendered element's measured rectangle.

### 3.3 Preview

- Video preview metadata is loaded, but the selected-card board has no complete live-video source path.
- Inactive-card disposal and media ownership are not asserted.

### 3.4 Timeline/export

- Domain timeline compilation and frame-production timeline lookup are separate implementations.
- Transition overlap is not a proven frame-production contract.
- Frame capture does not assert the expected card index and active media IDs before every capture.
- The exporter has no explicit `h264_mf` rate-control, quality, or GOP profile.
- Current smoke tests bypass the real card renderer and therefore cannot catch the user's leak.

## 4. Scope

### In scope

- Stable semantic item IDs for all rendered editable content.
- Actual DOM-rect selection, drag, 8-direction resize, snap, keyboard nudge, and undo/redo.
- Selected-card background-video and video-layer playback.
- Safe local media URL/protocol, lifecycle disposal, poster fallback, decode errors, and upload policy.
- Card timeline strip, playhead, card duration, fit-to-video duration, trim in/out, transition controls, and duration indicators.
- One canonical compiled timeline for UI, preview, video frame production, audio, and exporter.
- Deterministic card/media ownership and transition rendering.
- MP4 rate-control/quality profile and objective output verification.
- Lite/Pro shared functionality, Lite stripping regression, archive migration, documentation, packaging, install smoke, hashes, rollback, and HANDOFF update.

### Out of scope

- A multi-track professional NLE.
- Arbitrary keyframes, speed ramps, color grading, masks, captions generated from audio, or waveform editing.
- Import-time transcoding of unsupported codecs.
- 4K or 60fps final MP4 export.
- New AI or bulk-generation functionality.
- Code signing certificate purchase or SmartScreen reputation.
- Overwriting the existing M22 distribution.

## 5. Edition Matrix

| Capability | Lite | Pro |
| --- | --- | --- |
| Semantic item selection/drag/resize | Enabled | Enabled |
| Video import/preview | Enabled | Enabled |
| Timeline/duration/trim/transition | Enabled | Enabled |
| MP4 export | Enabled | Enabled |
| Project archive migration | Enabled | Enabled |
| AI/provider workflows | Locked/stripped by existing rule | Enabled |
| Bulk generation | Locked/stripped by existing rule | Enabled |

M23 may not weaken the existing Lite forbidden-symbol scan to make shared video code pass.

## 6. RALPLAN-DR

### Principles

1. One persisted composition must drive board, PNG, and MP4.
2. Every visible editable object needs a stable identity and measurable geometry.
3. Media belongs to an explicit card/layer; inheritance must be resolved before render.
4. A release claim requires real pixels, a real encoder, and packaged-app evidence.
5. Backward compatibility and rollback beat a destructive schema shortcut.

### Decision drivers

1. Eliminate card-to-card media leakage and low-quality output with deterministic proof.
2. Improve editing without introducing a second renderer or a full NLE rewrite.
3. Preserve Lite/Pro separation and existing M22 projects.

### Option A: Extend the existing DOM renderer and normalized placement model

Pros:

- Board, PNG, and MP4 can share the current HTML/CSS renderer.
- Existing card styles, archive data, and custom layers remain reusable.
- The implementation can be gated incrementally.

Cons:

- Accurate iframe geometry and pointer routing require careful scale handling.
- Transition rendering must explicitly coordinate two card render surfaces.

### Option B: Replace the editor with Fabric/Konva and keep HTML only for export

Pros:

- Mature canvas selection and resize interactions.
- Easier freeform manipulation in the editor.

Cons:

- Creates two layout engines and makes preview/export drift likely.
- Requires a broad data and rendering rewrite and a new dependency.
- Does not directly solve export media ownership.

### Option C: Adopt a full video composition framework or embed an external editor

Pros:

- More complete timeline and transition primitives.

Cons:

- Large dependency, license, bundle, and packaging surface.
- Incompatible with the requested constrained workflow and current architecture.
- Migration risk is too high for a corrective milestone.

### Decision

Choose Option A. Reuse the current renderer and transform math, add stable item identity, and make `CompiledVideoTimeline` plus a frame ownership manifest the single export contract. Options B and C are invalidated for M23 because they increase renderer divergence and release risk before fixing the proven defects.

## 7. Domain Contracts

### 7.1 Semantic item identity

Add a persisted `SemanticItemId` contract. IDs are stable across save/load and do not depend solely on current array position.

Required kinds:

- `header`
- `page-number`
- `title`
- `subtitle`
- `paragraph`
- `bullet`
- `badge-text`
- `badge-image`
- `footer`
- `source`
- `emphasis`
- `body-number`
- `next-hint`

Each parsed paragraph/bullet receives a persisted item key when it first enters a project. A legacy project gets deterministic keys during normalization and those keys are saved on the next write. Reordering preserves the key with the content item.

`SemanticItemPlacement` stores normalized `x`, `y`, `width`, `height`, `anchor`, and `mode`. DOM rectangles seed unset geometry; saved normalized geometry becomes authoritative after the first user transform.

### 7.2 Geometry and transform

- Renderer emits `data-semantic-item-id` on each editable element.
- A geometry probe waits for fonts, images, and video metadata, then returns measured rectangles and board scale.
- Overlay and renderer use the same normalized coordinate space.
- Text resize changes the wrapping/container box; it does not silently change font size.
- Media/shape/video resize changes actual visual dimensions.
- Font size remains an explicit typography command in the floating toolbar.
- Default clamp keeps at least 8px of a selected object reachable inside the card; holding the existing free-move modifier may bypass snap, not the reachability clamp.

### 7.3 Media ownership manifest

Every preview/export frame receives a resolved manifest:

```ts
type FrameOwnershipManifest = {
  cardIndex: number;
  sceneId: string;
  localTimeMs: number;
  activeMediaIds: string[];
  activeVideoLayerIds: string[];
};
```

Global background media is resolved to each card before rendering. Card-specific media and video layers belong only to their card. A frame capture fails if the DOM contains an unexpected media ID or lacks an expected one.

### 7.4 Video source and scene limits

New imports use this policy:

| Limit | Contract |
| --- | --- |
| Container | MP4 |
| Video codec | H.264/AVC |
| Audio | AAC or none |
| Pixel format | Browser/FFmpeg compatible 4:2:0 path |
| File size | 300MiB hard import limit |
| Source duration | 180 seconds maximum |
| Resolution | 320x320 minimum; at most 8,294,400 pixels and no side above 3840 |
| Frame rate | 1 to 60fps |
| Project media total | 2GiB |
| Scene duration | 0.5 to 180 seconds |
| Export total | 600 seconds maximum |

Legacy archives containing an already accepted 300-500MiB asset remain readable, but the UI warns and does not duplicate that asset. Validation performs `stat` and ffprobe before any full-buffer read; hash/copy uses streaming I/O.

### 7.5 Timeline

`CompiledVideoTimeline` is the only accepted mapping from output timestamp to scene. It includes:

- exact scene start/end/duration
- transition type and overlap
- source clip in/out
- duration mode: `fixed` or `fit-primary-video`
- primary audio source
- resolved media ownership
- exact output frame range at 30fps

Frame count uses a single rounding rule. UI total duration, preview playhead, frame producer, audio segments, and ffprobe expectation all consume the same compiled object.

### 7.6 Video end behavior

- Video looping is off by default.
- If a fixed scene is longer than the trimmed source, the final decoded frame is held.
- `fit-primary-video` sets scene duration to `clipOut - clipIn` within limits.
- Current time is clamped to the clip; modulo is used only when an explicit future loop flag is true.

### 7.7 Encoding profile

The default `high` profile targets:

- H.264 via bundled `h264_mf`
- 1080x1920
- 30fps
- yuv420p
- `rate_control=pc_vbr`
- target bitrate around 10Mbps
- max bitrate around 14Mbps
- buffer around 20Mbps
- `quality=85`
- `scenario=archive`
- GOP at most 60 frames
- faststart

The exact accepted arguments are established by a startup/export preflight using the bundled binary. Unsupported or ignored rate control is an export error, not a silent fallback to 0.2Mbps. A different bundled encoder may be selected only after license, packaging, and objective-quality gates are updated.

### 7.8 Controlled media origin

- Preview/export URLs may resolve only from registered media-library asset IDs or a per-run controlled temporary render root.
- Arbitrary absolute paths and direct `file://` URLs are forbidden at the renderer boundary.
- The main process canonicalizes the resolved path and verifies that it stays under an allowed root before opening it.
- Temporary object/protocol URLs are revoked on card switch, project close, cancellation, and app exit.
- Failed imports remain unregistered and partial/quarantined files are deleted before the operation returns.
- Any origin/path assertion failure blocks preview/export and is a release-blocking security failure.

## 8. UX Contract

### 8.1 Board selection

- Hover: thin neutral outline.
- Selected: blue outline, eight handles, item label, rotation only where already supported.
- Labels are shown only on hover/selection to avoid the screenshot's cluttered full-board labels.
- Click selects the smallest topmost item under the pointer; repeated click cycles overlapping items.
- `Tab` cycles items, arrows nudge 1px-equivalent, `Shift+Arrow` nudges 10px-equivalent.
- Drag shows alignment guides and snap feedback.
- Undo/redo treats one drag/resize gesture as one history operation.

### 8.2 Text editing

- Double-click or Enter enters inline text edit.
- The original rendered glyphs are hidden while the editor is active so duplicate text never overlaps.
- The editor background is transparent unless the element itself has a backdrop.
- Escape cancels, Ctrl+Enter commits, blur follows the existing safe commit rule.

### 8.3 Live video preview

- Only the selected card mounts live `<video>` elements.
- Side thumbnails and inactive cards use posters.
- Preview provides play/pause, current time, duration, mute, and scrub.
- Autoplay starts muted; audio starts only after user action.
- Card switch pauses, removes sources, revokes temporary URLs, and resets state.
- Unsupported/decode-failed media shows a Korean error with the exact failed constraint.

### 8.4 Timeline

A collapsible bottom panel provides one card track rather than a full editing suite.

- Each card is a proportional segment with thumbnail, number, and seconds.
- A playhead scrubs the compiled project preview.
- Dragging a card segment's right edge changes duration.
- The selected card exposes numeric duration and `영상 길이에 맞춤`.
- Primary video trim-in/trim-out handles are visible inside the segment.
- Transition controls live between segments for `none`, `fade`, `slide-left`, and `slide-up`.
- Timeline zoom changes pixels-per-second, not data.
- Space toggles play/pause; Home/End move to project bounds.

## 9. Requirements

### R1. RED reproduction and baseline evidence

- Create a deterministic multi-card fixture with a card-1-only moving forbidden marker.
- Capture persisted assignment, resolved ownership, DOM media IDs, and sampled output frames.
- Preserve the attached MP4 probe and forensic images as baseline evidence.
- Exporter edits are blocked until the leak is reproduced or conclusively isolated as input-state corruption.

### R2. Stable semantic item model and migration

- Persist stable IDs for each paragraph and bullet.
- Normalize legacy coarse `semanticSlots` without losing placement.
- Round-trip new item placements through workspace and project archive.
- Back up a project before first schema-changing save and leave the original intact on failure.

### R3. Pixel-accurate selection and transforms

- Render and select all required semantic kinds independently.
- Measured overlay error must be no more than 2 CSS pixels at supported desktop scales.
- Drag, 8-direction resize, snap, nudge, undo/redo, and overlap cycling must work.
- The same saved placement must match board, PNG, and MP4.

### R4. Live selected-card playback

- Bind resolved card-owned videos to real live video elements.
- Provide lifecycle cleanup and safe local URL handling.
- Show poster until metadata/first frame is ready.
- Prove that switching cards leaves no previous-card video element or media ID.

### R5. Bounded import and project safety

- Enforce the limits in section 7.4 before expensive reads.
- Probe codec, duration, dimensions, fps, pixel format, and audio codec.
- Stream hash/copy operations and clean partial files after cancellation/failure.
- Keep UI, validator, archive, and user guide limits identical.

### R6. Canonical timeline and CapCut-like constrained UI

- Replace duplicate timeline math with `CompiledVideoTimeline` consumers.
- Implement proportional card segments, duration handles, trim, playhead, zoom, and transition controls.
- Show each card's duration and total project duration continuously.
- `fit-primary-video` must display the whole trimmed source unless a hard limit is reached, in which case export is blocked with an actionable error.

### R7. Deterministic media isolation

- Render each scene in a card-scoped session.
- Assert ownership before every frame.
- Seek with clamped local time, await `seeked` and a decoded video frame, then capture.
- Do not reuse a previous card's media node or playing state.
- The forbidden marker must appear zero times after card 1.

### R8. Transition correctness

- `fade`, `slide-left`, and `slide-up` render outgoing and incoming cards independently and composite deterministically.
- Transition frames must not turn a media assignment into a global layer.
- Preview and export transition boundaries must match within one frame.
- If a transition path is unavailable on a machine, export fails before encoding; it may not be silently ignored.

### R9. MP4 quality and integrity

- Apply a verified quality profile.
- Validate dimensions, fps, duration, frame count, codec, pixel format, bitrate behavior, GOP, blank frames, leakage, and audio ownership.
- A motion/text fixture must achieve at least 6Mbps average video bitrate under the high profile.
- A static fixture may be below that bitrate only if SSIM is at least 0.97 and PSNR at least 36dB against the lossless reference.
- Attached-output-equivalent 0.204Mbps results must fail the release gate.

### R10. Performance, accessibility, and cancellation

- Only selected-card live videos decode in the editor.
- Import, preview, and export remain cancellable and never leave an active FFmpeg or temporary render session.
- On the release reference machine, 1080x1920/30 preview starts within 2 seconds and maintains at least 95% presented-frame ratio over a 10-second sample.
- Timeline controls have keyboard focus, names, and visible focus states.

### R11. Lite/Pro edition safety

- All M23 editor/video functionality is shared.
- Lite scans continue to reject AI/provider/bulk forbidden symbols.
- Both source output and packaged `app.asar` receive edition verification.

### R12. Release, rollback, and handoff

- Package from an isolated output root, never directly into the current staged release.
- Test unpacked and installed builds with fresh user-data profiles.
- Run a clean Windows VM install/uninstall/export check before marking public-ready.
- Copy only passing artifacts into a new immutable M23 distribution folder.
- Record hashes, commands, exit codes, machine profile, known limitations, and rollback target.
- Append M23 results to `HANDOFF.md`; do not rewrite historical entries.

## 10. Implementation Milestones

### M23-0. Forensic RED harness

- Add full-pipeline leak and low-quality fixtures.
- Record current failure with machine-readable verdicts.
- Exit: root-cause branches can be distinguished by ownership/DOM/frame evidence.

### M23-1. Schema and semantic identity

- Add stable item IDs, placement contract, migration, and archive round-trip.
- Exit: legacy plus new project fixtures pass before UI edits begin.

### M23-2. Unified board transform engine

- Measure real rectangles and reuse custom-layer transform primitives.
- Exit: each semantic item independently selects, moves, resizes, saves, and re-renders.

### M23-3. Safe live-video preview and limits

- Add safe media URL binding, controls, cleanup, preflight, and streaming import.
- Exit: selected-card playback works and card-switch ownership tests pass.

### M23-4. Canonical timeline and UI

- Extend timeline domain and add the constrained bottom track.
- Exit: UI duration/frame expectations equal compile output exactly.

### M23-5. Frame ownership and transitions

- Replace duplicate producer timeline, enforce ownership, fix seek/end behavior, and composite transitions.
- Exit: forbidden-marker leak is zero across all frames and transitions.

### M23-6. Encoder quality and real MP4 gates

- Establish `h264_mf` preflight/profile and objective-quality checks.
- Exit: motion, static, audio, trim, and attached-user-regression exports pass.

### M23-7. Full regression and edition verification

- Run M21/M22 tests, PNG regression, typecheck, unit/integration/E2E, build Lite/Pro, and scans.
- Exit: no changed-behavior regression or forbidden Lite symbols.

### M23-8. Isolated packaging and packaged QA

- Build Lite/Pro installers and unpacked folders in an isolated run directory.
- Run fresh-profile packaged smoke and clean VM install/export/uninstall.
- Exit: every artifact and evidence hash matches.

### M23-9. Staged release and handoff

- Stage a new `release/distribution/Cardnews-Studio-M23-{runId}/` folder.
- Add usage guide, release manifest, SHA256SUMS, rollback pointer, and append-only HANDOFF entry.
- Exit: manifest says `approved` only when all prior gates are green.

## 11. Gate and Evidence Contract

Evidence root:

`.omc/evidence/v6/m23-canvas-video-timeline-hardening/`

Each gate creates:

- `{gate}.log`
- `{gate}.meta.json`
- relevant screenshots, frame samples, MP4, ffprobe JSON, or report files

Every `.meta.json` includes:

- command and working directory
- start/end timestamps
- exit code
- source commit and dirty-state digest
- edition and artifact hashes where applicable
- fixture IDs
- machine/OS/GPU/encoder information for video gates
- `verdict: pass | fail | blocked`

Performance gates also require an explicit reference-machine profile containing OS build, CPU, RAM, GPU, display scale, FFmpeg version, and encoder capability output. If that profile is absent, the performance verdict is `blocked`, never `pass`.

Gate order is strict:

1. `G0-context-and-red`
2. `G1-schema-roundtrip`
3. `G2-board-geometry`
4. `G3-preview-and-import`
5. `G4-timeline-consistency`
6. `G5-frame-ownership-transition`
7. `G6-video-quality`
8. `G7-regression-editions-security`
9. `G8-isolated-package`
10. `G9-fresh-profile-package-smoke`
11. `G10-clean-vm-install-smoke`
12. `G11-stage-and-handoff`

A later gate must refuse to start when an earlier verdict is not `pass`.

## 12. Acceptance Summary

| Area | Release threshold |
| --- | --- |
| Semantic selection | Every required item independently selectable |
| Geometry | Overlay vs rendered rectangle error <= 2 CSS px |
| Transform | Drag + 8 handles + nudge + undo/redo |
| Preview | Real selected-card playback; stale media IDs = 0 |
| Import | Limits and exact Korean errors proven |
| Timeline | UI/preview/export totals differ by <= 1 frame |
| Leakage | Forbidden marker after owning scene = 0 pixels/events |
| Output | 1080x1920, 30fps, H.264, yuv420p |
| Duration | Expected difference <= 1 frame |
| Quality | Motion >= 6Mbps; static SSIM >= .97 and PSNR >= 36dB |
| GOP | <= 60 frames |
| Process cleanup | Orphan renderer/FFmpeg count = 0 |
| Editions | Lite/Pro shared feature passes; Lite forbidden symbols = 0 |
| Distribution | Isolated hashes match staged hashes; VM gate passes |

## 13. Deliberate Pre-mortem

### Scenario 1: Board looks correct but PNG/MP4 moves differently

Cause: DOM pixels become a second source of truth or transforms are applied twice.

Prevention:

- DOM rect only seeds unset normalized placement.
- Golden composition is rendered through board, PNG, and MP4 and compared.
- Release blocks at any placement delta over tolerance.

### Scenario 2: Video leak appears only during transitions or on packaged builds

Cause: renderer/session reuse, implicit global inheritance, or delayed decode callback crosses card boundaries.

Prevention:

- Per-frame ownership manifest and DOM assertion.
- Unique forbidden markers per card and transition-frame exhaustive sampling.
- Fresh-profile packaged smoke and clean VM run, not source-only tests.

### Scenario 3: Bitrate options are accepted but ignored by Media Foundation

Cause: hardware/driver-dependent `h264_mf` behavior.

Prevention:

- Capability and trial-encode preflight on each packaging/test machine.
- Judge actual ffprobe/SSIM/PSNR output, not command-line presence.
- Fail export with remediation rather than silently deliver low quality.

### Scenario 4: Large upload freezes the UI or leaves partial files

Cause: full-buffer read before size/probe checks or uncancelled stream copy.

Prevention:

- `stat` then ffprobe then streaming hash/copy.
- Cancellation and partial-file cleanup integration tests.
- Memory and process telemetry in the import smoke.

### Scenario 5: Lite package accidentally contains Pro-only code

Cause: shared editor extraction broadens an allowlist.

Prevention:

- Do not relax forbidden-symbol definitions.
- Scan source outputs, `app.asar`, and unpacked package separately.
- Block packaging on a single match.

## 14. ADR

### Decision

Keep one DOM/CSS card renderer and extend it with stable semantic item identity, normalized transforms, live selected-card video binding, a canonical compiled timeline, frame ownership assertions, and verified Media Foundation encoding.

### Drivers

- Existing style fidelity and project compatibility.
- Need for board/PNG/MP4 consistency.
- Need to fix proven export defects before broadening editing scope.

### Alternatives considered

- Fabric/Konva editor plus HTML export renderer.
- Full video composition framework or embedded editor.
- Minimal bitrate-only patch.

### Why chosen

It addresses the root contracts while preserving the fewest independent sources of truth. A bitrate-only patch would leave card leakage and editor geometry unresolved.

### Consequences

- M23 requires schema migration and renderer instrumentation.
- Transition rendering becomes an explicit two-scene composition responsibility.
- Packaging takes longer because real MP4 and VM gates are mandatory.

### Follow-ups

- Consider import transcoding only after collecting unsupported-file telemetry.
- Consider waveform or multi-track editing in a separate milestone.
- Add code signing as an independent release-management project.

## 15. Execution Staffing Guidance

Available role types for this implementation:

- `executor`: domain/storage/editor/export implementation
- `designer`: board and timeline interaction review
- `debugger`: leakage and Media Foundation root-cause isolation
- `test-engineer`: full-pipeline fixtures and quantitative gates
- `verifier`: edition/package/release claim audit
- `code-reviewer`: cross-module regression/security review
- `git-master`: milestone commits and clean release history

Recommended lanes:

1. Domain/migration lane: executor, medium reasoning.
2. Editor/UX lane: executor plus designer review, high reasoning.
3. Video pipeline lane: debugger plus executor, high reasoning.
4. Test/evidence lane: test-engineer, high reasoning.
5. Release verification lane: verifier, high reasoning.

Use `$ultragoal` as the durable leader ledger. Use `$team` inside milestones M23-2 through M23-7 only where write scopes are disjoint. A concrete team split is domain/storage, editor UI, video pipeline, and tests/evidence; the leader serializes shared `App.tsx` and release scripts. Team verification is performed by a separate verifier after integration, not by the implementation lane that produced the code.

An explicit `$ralph` fallback is acceptable only if a single owner is intentionally chosen for the long debug/verification loop. It is not the default because this milestone needs durable cross-session gate tracking.

## 16. Definition of Done

M23 is not done when code compiles or an EXE exists. It is done only when:

- R1-R12 are implemented and traced to passing tests.
- All G0-G11 machine-readable verdicts are `pass`.
- The user's leak/quality scenario has a passing real-pipeline regression.
- Lite and Pro unpacked plus installer builds pass fresh-profile smoke.
- A clean Windows VM passes install, launch, video preview, MP4 export, uninstall, and residue checks.
- New staged artifacts have hashes matching isolated outputs.
- `HANDOFF.md` is appended with commands, evidence, artifact paths, limitations, and rollback target.
- The previous M22 distribution remains intact.

## 17. Suggested Follow-up Command

The current repository still contains a completed M13 `.omx/ultragoal` ledger. Start M23 in a new Codex task, or clear the completed Codex goal in the current task with `/goal clear`, then run:

```powershell
omx ultragoal create-goals --force --brief-file .omx/plans/m23-ultragoal-brief.md --json
omx ultragoal status --json
omx ultragoal complete-goals --json
```

Before implementation, verify that `.omx/ultragoal/brief.md` and `.omx/ultragoal/goals.json` reference M23 and do not reference the stale M13 PRD. If verification fails, stop; do not execute an old goal ledger.

Equivalent user-facing invocation after the fresh ledger is created:

```text
[$ultragoal]
.omx/ultragoal/goals.json의 M23 장부를 이어서 완료해. PRD와 test spec의 G0-G11 게이트를 순서대로 지키고 실패한 게이트 뒤로 진행하지 마.
```
