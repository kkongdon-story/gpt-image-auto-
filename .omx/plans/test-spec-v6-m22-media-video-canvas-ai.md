# Test Spec: V6 M22 Media, Video, Canvas, and AI

## 1. Scope and Gate Rule

이 명세는 M22 PRD의 R1-R12를 Lite/Pro, 저장/복원, preview/PNG/MP4, archive, security, performance까지 검증한다.

Evidence root:

```text
.omc/evidence/v6/m22-media-video-canvas-ai/
```

Gate order:

1. T1 RED baseline.
2. T2-T4 domain/storage/media inheritance.
3. T5-T8 video/editor/footer/body-number.
4. T9 AI/edition separation.
5. T10-T12 frame/MP4/archive.
6. T13 PNG/full regression.
7. T14 Lite/Pro build and strip verification.
8. T15 manual visual/performance/accessibility QA.
9. T16 evidence audit/HANDOFF.

앞 gate가 실패하면 뒤 gate를 진행하지 않는다. 이 milestone에서는 EXE/NSIS 패키징을 하지 않는다.

## 2. Evidence Contract

각 자동 gate는 같은 basename의 `.log`와 `.meta.json`을 남긴다.

```json
{
  "gate": "T00",
  "command": "literal command",
  "startedAt": "ISO-8601",
  "completedAt": "ISO-8601",
  "exitCode": 0,
  "gitHead": "sha",
  "edition": "shared|lite|pro",
  "artifacts": [
    { "path": "relative/path", "sha256": "hex", "bytes": 1 }
  ]
}
```

Manual gate meta에는 tester, app build hash, Windows version, result, observations를 추가한다. 로그를 만들기 위해 실패 exit code를 숨기거나 `|| true` 같은 우회를 사용하면 gate 실패다.

## 3. Required Fixtures

### 3.1 Legacy fixtures

1. M20/M21 이전 workspace: M22 field 없음.
2. archive manifest v1: background/font/custom image layer 포함.
3. footer legacy offset `-40`, `0`, `40` fixture.
4. 10-card body sequence with automatic `01..09`.
5. existing CSV v2 semantic/custom text binding fixture.
6. PNG golden fixtures for 4:5, 1:1, 16:9, 4:3.

### 3.2 Media fixtures

1. PNG/JPEG image, transparency 포함.
2. H.264/AAC MP4 3초, 1080x1920, audio 있음.
3. H.264 MP4 1초, audio 없음.
4. landscape video, portrait video, square video.
5. 같은 파일명에 다른 hash인 두 파일.
6. 한글·공백·괄호가 포함된 파일명.
7. 손상 MP4, 확장자 위장 파일, 0-byte file.
8. allowed limit 경계와 limit 초과 파일.
9. archive traversal entry `../escape.mp4`와 absolute/drive path entry.
10. missing media reference fixture.

### 3.3 Composition fixtures

1. 3 static cards, each 2 seconds, no transition.
2. image background + one video layer.
3. video background + two video layers, 모두 audio 있음.
4. clip start/end가 source 범위 안/밖인 경우.
5. scene보다 짧은 video.
6. none/fade/slide transition 조합.
7. primary audio background, primary audio layer, no primary audio.
8. 10-card stress project with mixed media.

### 3.4 Semantic editing fixtures

1. title/subtitle/body/badge/footer 모두 표시.
2. 일부 slot이 비어 있거나 숨김.
3. 한글 IME, 공백, 줄바꿈, bullet line.
4. standard slots와 custom text/shape/line/image/video layers 혼합.
5. footer at left/safe-right/physical-right.
6. body-number global/card override truth table.

### 3.5 AI fixtures

1. generic reset instruction.
2. custom Korean instruction.
3. blank, whitespace-only, max length, over-limit instruction.
4. Claude/Codex/Gemini provider request capture.
5. malicious instruction attempting to disable card schema/safety rule.
6. Lite source/dist/app archive forbidden-symbol fixture.

## T1. RED Baseline and Regression Lock

목적: 구현 전에 현재 결함과 보존할 M21 동작을 동시에 고정한다.

Before-change assertions:

- current-card media quick assignment UI가 없다.
- video kind/domain/timeline/MP4 API가 없다.
- title/subtitle/body/badge/footer 전부가 overlay selectable하지 않다.
- footer가 clamp를 넘어 physical right edge에 도달하지 못한다.
- body number visibility setting이 없다.
- AI prompt에 fixed Kkongdon brand strings가 있다.

Preservation assertions:

- current preview and PNG golden outputs pass.
- M21 custom layer inline edit/clipboard/page/bulk tests pass.
- Lite edition regression and Pro AI baseline tests pass before expected prompt replacement.

Command:

```powershell
npx vitest run src/render-engine src/storage src/domain src/ui
```

Evidence:

- `t01-red-baseline.log`
- `t01-red-baseline.meta.json`
- `t01-current-media-flow.png`
- `t01-current-footer-limit.png`

RED test files must fail for the intended missing behavior only. Existing green regressions must stay green.

## T2. Domain Normalization and Legacy Migration

Targets:

```text
src/domain/types.ts
src/domain/media*.test.ts
src/storage/deckStore.test.ts
src/storage/projectArchive.test.ts
```

Assertions:

- M22 optional fields absent means legacy defaults.
- legacy `backgroundId` global/card/null states map to equivalent effective media.
- new `BackgroundMediaSelection` rejects invalid mode/id combinations.
- scene duration, transitionMs, clip range, volume, geometry, opacity normalize finite bounds.
- semantic slot flow is default; invalid card coordinates clamp safely.
- body number global default is show; card default is inherit.
- unknown/malformed M22 fields do not crash workspace load.
- normalize is idempotent.
- save/load round-trip preserves valid fields.

Command:

```powershell
npx vitest run src/domain src/storage/deckStore.test.ts src/storage/projectArchive.test.ts
```

Evidence:

- `t02-domain-migration.log`
- `t02-domain-migration.meta.json`
- `t02-normalized-fixtures.json`

## T3. Media Catalog, Import, Deletion, and Security

Targets:

```text
src/storage/mediaLibrary.test.ts
electron/media*.test.ts
```

Assertions:

- image/video import copies into managed userData root and returns stable ID.
- persisted workspace contains ID/relative managed path, not original absolute path.
- MIME, extension, and signature validation agree.
- metadata includes dimensions; video includes duration/audio/poster.
- Korean/space/same-name imports work without overwrite.
- hash duplicate handling is deterministic.
- corrupt, disguised, zero-byte, oversized files are rejected with typed errors.
- managed path containment prevents `..`, drive path, UNC, symlink escape.
- used asset deletion is blocked and reports every use site.
- unused asset deletion removes media and generated poster atomically.
- missing media returns recoverable placeholder state.

Command:

```powershell
npx vitest run src/storage/mediaLibrary.test.ts electron/media-import.test.ts
```

Evidence:

- `t03-media-security.log`
- `t03-media-security.meta.json`
- `t03-import-manifest.json`

## T4. Card-first Media Inheritance and UI

Targets:

```text
src/domain/mediaResolver.test.ts
src/ui/cardMediaControls.test.tsx
src/render-engine/cardTemplate.test.ts
```

Truth table:

| Card state | Global | Effective |
| --- | --- | --- |
| inherit | asset A | A |
| inherit | none | style background |
| none | asset A | no media, style fallback policy only |
| asset B | asset A | B |
| asset missing | asset A | missing local warning, no silent substitution |

Assertions:

- image/video import from selected card assigns local media in one flow.
- segmented control and persisted state never disagree.
- global change updates inherit cards only.
- card rail badge distinguishes inherited/local image/local video/missing.
- duplicate/delete/reorder card operations preserve/remap media override.
- UI stays on current tab/card after assignment.
- preview and renderer use the same resolver.

Command:

```powershell
npx vitest run src/domain/mediaResolver.test.ts src/ui/cardMediaControls.test.tsx src/render-engine/cardTemplate.test.ts
```

Evidence:

- `t04-card-media.log`
- `t04-card-media.meta.json`
- `t04-inheritance-states.png`
- `t04-rail-badges.png`

## T5. Video Background and Free Video Layer

Targets:

```text
src/domain/cardLayers.test.ts
src/ui/StageCanvas.test.tsx
src/render-engine/cardTemplate.test.ts
```

Assertions:

- video layer add/select/move/resize/delete/duplicate/paste works.
- normalized geometry and z-index round-trip.
- cover/contain and opacity render correctly.
- video background obeys card/global resolution.
- clip start/end UI clamps to media duration and keeps start < end.
- no-audio video is excluded from primary audio candidates.
- idle non-selected cards use poster and do not run playback loops.
- selected-card preview seek is stable after card switch.
- static screenshot at known time matches golden tolerance.

Command:

```powershell
npx vitest run src/domain/cardLayers.test.ts src/ui/StageCanvas.test.tsx src/render-engine/cardTemplate.test.ts
```

Evidence:

- `t05-video-layer.log`
- `t05-video-layer.meta.json`
- `t05-video-preview-t0000.png`
- `t05-video-preview-t1500.png`

## T6. Scene Timeline, Transition, and Primary Audio

Targets:

```text
src/domain/videoTimeline.test.ts
src/ui/sceneControls.test.tsx
```

Assertions:

- default and per-card duration normalize to documented range.
- none/fade/slide transition durations cannot exceed adjacent scene constraints.
- total duration calculation includes transition overlap exactly once.
- frame timestamps are integer/rational and do not accumulate floating drift.
- one valid primary source is audible; every non-primary source is muted.
- selecting a new primary replaces the old one atomically.
- deleting/missing primary falls back to null with warning.
- source shorter than scene produces final-frame hold, not loop.
- source longer than scene obeys clip range.
- timeline compile is pure and deterministic.

Command:

```powershell
npx vitest run src/domain/videoTimeline.test.ts src/ui/sceneControls.test.tsx
```

Evidence:

- `t06-timeline-audio.log`
- `t06-timeline-audio.meta.json`
- `t06-compiled-timeline.json`
- `t06-audio-graph.json`

## T7. Semantic Slot Direct Editing

Targets:

```text
src/ui/StageCanvas.test.tsx
src/ui/semanticSlotEditing.test.tsx
src/render-engine/cardTemplate.test.ts
src/domain/csvBulk.test.ts
```

Assertions:

- title/subtitle/body/badge/footer each expose stable `data-slot` geometry.
- single click selects only intended slot; custom layers retain selection behavior.
- drag persists normalized placement without changing semantic content field.
- double-click/Enter opens inline edit with matching font/box/alignment.
- only underlying selected slot text is hidden while editing; no duplicate glyphs.
- transparent slot/layer does not gain a white edit background.
- compositionstart/end protects Korean IME from Enter/Escape interception.
- trailing space, repeated space, newline, bullet prefix survive commit.
- Escape restores original text and geometry.
- body remains semantic lines/bullets and bulk bindings still target semantic fields.
- preview, PNG model, and video frame model receive identical slot placement.

Command:

```powershell
npx vitest run src/ui/StageCanvas.test.tsx src/ui/semanticSlotEditing.test.tsx src/render-engine/cardTemplate.test.ts src/domain/csvBulk.test.ts
```

Evidence:

- `t07-semantic-edit.log`
- `t07-semantic-edit.meta.json`
- `t07-five-slots.png`
- `t07-ime-edit.png`

## T8. Footer Full-width Placement and Body-number Visibility

Targets:

```text
src/domain/chromeConfig.test.ts
src/render-engine/cardTemplate.test.ts
src/storage/deckStore.test.ts
src/ui/cardDesignControls.test.tsx
```

Footer assertions:

- legacy offset-only input renders at old position.
- card placement x 0/50/100 reaches left/center/right bounds for all ratios.
- right anchor can place footer at physical right edge without clipping text.
- safe-area snap is optional and does not clamp physical-edge mode.
- NaN/Infinity/out-of-range values normalize.
- preview/PNG/video-frame coordinates differ by no more than 1 CSS pixel at canonical size.

Body-number truth table:

| Global | Card | Visible |
| --- | --- | --- |
| show | inherit | yes |
| hide | inherit | no |
| show | show | yes |
| show | hide | no |
| hide | show | yes |
| hide | hide | no |

Additional assertions:

- legacy project is visible.
- hidden card does not alter subsequent computed number.
- cover/closing cards remain unaffected by body number policy.

Command:

```powershell
npx vitest run src/domain/chromeConfig.test.ts src/render-engine/cardTemplate.test.ts src/storage/deckStore.test.ts src/ui/cardDesignControls.test.tsx
```

Evidence:

- `t08-footer-number.log`
- `t08-footer-number.meta.json`
- `t08-footer-ratios.png`
- `t08-body-number-grid.png`

## T9. Pro AI Default Instruction and Lite Stripping

Targets:

```text
src/ui/aiChat.test.ts
src/ui/useAiAssistant.test.ts
electron/ai/cliAdapters.test.ts
src/domain/editionFilter.test.ts
scripts/verify-edition.test.ts
```

Prompt order assertions:

1. immutable app safety/format contract.
2. editable default instruction.
3. action context when used.
4. history.
5. latest user message.

Additional assertions:

- custom instruction appears exactly once in Claude/Codex/Gemini request.
- raw chat preserves latest user text without Kkongdon rewrite.
- blank/whitespace uses generic default.
- over-limit instruction is rejected without truncating silently.
- reset restores versioned generic default.
- malicious instruction cannot disable schema/path/security parser.
- fixed `꽁돈 AI`, Kkongdon brand kernel, `kkongdon_story` prompt strings are absent from active AI prompt sources.
- Lite settings normalization drops `aiDefaultInstruction`.
- Lite preload/domain API has no AI instruction or runChat surface.
- Lite source/dist/app scan forbids AI instruction key, prompt builder, CLI adapters, provider names according to existing edition rules.

Commands:

```powershell
npx vitest run src/ui/aiChat.test.ts src/ui/useAiAssistant.test.ts electron/ai/cliAdapters.test.ts src/domain/editionFilter.test.ts
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
```

Evidence:

- `t09-ai-pro.log`
- `t09-ai-pro.meta.json`
- `t09-lite-strip.log`
- `t09-lite-strip.meta.json`
- `t09-provider-payloads.redacted.json`

## T10. Deterministic Frame Rendering

Targets:

```text
src/render-engine/videoFrameRenderer.test.ts
electron/video-export*.test.ts
```

Assertions:

- same workspace/timeline/time produces same frame hash across two runs.
- requested timestamps map to expected source video frames within one output frame.
- fonts and media are ready before frame capture.
- transition boundary frames match expected alpha/position composition.
- short-video final-frame hold is stable.
- output is exactly 1080x1920 BGRA/RGBA contract.
- frame producer honors backpressure and does not queue the whole project.
- render window/process closes after success, cancel, and failure.

Command:

```powershell
npx vitest run src/render-engine/videoFrameRenderer.test.ts electron/video-export-renderer.test.ts
```

Evidence:

- `t10-frame-determinism.log`
- `t10-frame-determinism.meta.json`
- `t10-frame-hashes.json`
- `t10-transition-contact-sheet.png`

## T11. FFmpeg Preflight and MP4 Export

Targets:

```text
electron/ffmpegPreflight.test.ts
electron/videoExporter.test.ts
src/domain/cardnews-api.test.ts
```

Preflight assertions:

- executable path is fixed under trusted resources and arguments never use a shell string.
- hash/version/buildconf match pinned manifest.
- `h264_mf` and AAC encoder availability is required.
- `--enable-gpl`, `--enable-nonfree`, `libx264` cause gate failure.
- missing Media Foundation returns actionable Windows N guidance.

Export assertions:

- 3-card fixture creates one MP4.
- ffprobe reports width 1080, height 1920, avg frame rate 30, H.264 video, AAC audio when primary exists.
- no-primary fixture has no unintended audio stream or a documented silent track policy.
- duration equals compiled timeline within one frame/audio packet tolerance.
- scene order and sample frame hashes match expected cards.
- selected primary audio is audible; other source signature is absent.
- progress is monotonic and reaches finalize/100%.
- cancel terminates child/render process and removes partial/temp files.
- disk-full, permission, corrupt source, missing encoder return typed user messages.
- Korean/space output directory succeeds.
- existing file requires explicit overwrite confirmation.

Commands:

```powershell
npx vitest run electron/ffmpegPreflight.test.ts electron/videoExporter.test.ts src/domain/cardnews-api.test.ts
node scripts/smoke-video-export.mjs --fixture tests/fixtures/m22/mixed-media.json --output .omc/evidence/v6/m22-media-video-canvas-ai/t11-mixed-media.mp4
ffprobe -v error -show_streams -show_format -of json .omc/evidence/v6/m22-media-video-canvas-ai/t11-mixed-media.mp4
```

Evidence:

- `t11-ffmpeg-export.log`
- `t11-ffmpeg-export.meta.json`
- `t11-ffprobe.json`
- `t11-mixed-media.mp4`
- `t11-cancel.log`
- `t11-license-manifest.json`

## T12. Project Archive v1/v2 Round-trip and Security

Targets:

```text
src/storage/projectArchive.test.ts
electron/projectArchive*.test.ts
```

Assertions:

- v1 archive imports with same workspace and PNG golden.
- v2 exports media manifest, image/video binaries, posters, fonts as applicable.
- v2 import remaps every media ID and updates global/card/layer/scene references.
- two assets with same display name do not collide.
- missing optional poster regenerates safely.
- missing required media produces recoverable missing state and report.
- traversal, absolute path, symlink, duplicate manifest ID, excessive file count/size are rejected.
- failed import leaves current workspace/library unchanged.
- export/import under Korean/space path succeeds.

Command:

```powershell
npx vitest run src/storage/projectArchive.test.ts electron/projectArchive-import.test.ts
```

Evidence:

- `t12-archive.log`
- `t12-archive.meta.json`
- `t12-v1-roundtrip.zip`
- `t12-v2-roundtrip.zip`
- `t12-import-report.json`

## T13. PNG, M21, and Full Regression

Assertions:

- PNG current card and full ZIP outputs still exist and use previous API.
- legacy golden PNGs pass approved pixel/structural tolerance.
- image/video fields not used do not change static render HTML.
- video background at selected poster/time has documented PNG policy and deterministic output.
- M21 title placement, inline edit, clipboard, page operations, CSV v2/bulk Pro tests pass.
- warning/approval contrast report behavior remains unchanged.
- no new uncaught console/main-process errors.

Commands:

```powershell
npm run typecheck
npm test
```

Evidence:

- `t13-typecheck.log`
- `t13-typecheck.meta.json`
- `t13-full-test.log`
- `t13-full-test.meta.json`
- `t13-png-diff-report.json`

## T14. Lite/Pro Build and Edition Verification

Commands:

```powershell
npm run build:pro
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
```

Assertions:

- both builds exit 0.
- shared media, video, semantic editor, MP4 symbols exist in both editions.
- AI instruction settings/UI/IPC/providers do not exist in Lite output.
- Pro contains AI default instruction and all supported providers.
- Lite media/MP4 smoke runs without importing a Pro chunk dynamically.
- generated asset manifests contain only intended edition files.
- source maps/logs do not leak user paths or prompt contents into release artifacts.

Evidence:

- `t14-build-pro.log`
- `t14-build-pro.meta.json`
- `t14-build-lite.log`
- `t14-build-lite.meta.json`
- `t14-verify-lite.log`
- `t14-verify-lite.meta.json`
- `t14-edition-manifest.json`

## T15. Manual Visual, Performance, Accessibility, and App Smoke

Run on Windows 10/11 supported environment with a clean userData fixture.

Manual flows:

1. Start Lite and Pro development/build output separately.
2. Import Korean-named image and video from selected card.
3. Switch inherit/local/none and confirm rail/preview.
4. Add free video layer; move/resize; set clip/volume.
5. Select/edit/move all five semantic slots using mouse and keyboard.
6. Move footer to physical right edge at 4:5 and 1:1.
7. Test body-number global/card combinations.
8. Export mixed 3-card MP4, play in Windows player, inspect audio and transitions.
9. Cancel a 10-card export at 30-70% and confirm cleanup.
10. Pro: edit/reset AI default instruction and run each available CLI provider.
11. Lite: confirm no AI instruction/chat route is reachable.

Visual assertions:

- no overlapping controls, clipped labels, nested-card layout, or horizontal panel overflow.
- thumbnail/poster/card stage maintain stable dimensions.
- selected semantic slot and video layer have unambiguous handles.
- progress/error messages are readable and remain in the proper panel.

Performance assertions:

- 10-card fixture editor interaction p95 is no more than 20% slower than recorded M21 baseline.
- idle CPU does not show continuous playback for offscreen/non-selected cards.
- export memory plateaus under streaming design and does not scale with total raw frame bytes.
- cancel returns UI to usable state within 5 seconds after child-process termination request.

Accessibility assertions:

- keyboard reaches media state, import, scene, semantic edit, export, cancel.
- icon buttons have accessible names/tooltips.
- progress and errors use an appropriate live region without repeated spam.
- focus returns to triggering control after dialogs close.

Evidence:

- `t15-manual-qa.md`
- `t15-manual-qa.meta.json`
- `t15-lite-card-media.png`
- `t15-pro-ai-instruction.png`
- `t15-semantic-slots.png`
- `t15-export-progress.png`
- `t15-performance.json`
- `t15-console-main-errors.log`

## T16. Evidence Audit and Handoff

Assertions:

- T1-T15 required logs/meta/artifacts exist.
- every `.meta.json` parses and records exitCode 0 for passing gates.
- referenced MP4/ZIP/PNG hashes match files.
- no gate log hides a failure or uses stale gitHead without explanation.
- requirement-to-test matrix has no uncovered R1-R12 row.
- FFmpeg manifest/license/source/build-recipe evidence exists.
- no EXE/NSIS installer was generated in this milestone.
- `HANDOFF.md` append records implementation commits, changed architecture, exact commands/results, open risks, and next release step.

Recommended audit command:

```powershell
node scripts/verify-m22-evidence.mjs .omc/evidence/v6/m22-media-video-canvas-ai
```

Evidence:

- `t16-evidence-audit.log`
- `t16-evidence-audit.meta.json`
- `m22-requirement-matrix.json`

## 4. Requirement Traceability

| Requirement | Required gates |
| --- | --- |
| R1 media catalog/security | T2, T3, T12, T15 |
| R2 card-first inheritance | T2, T4, T15 |
| R3 video background/layer | T5, T10, T15 |
| R4 scene/audio | T6, T10, T11, T15 |
| R5 MP4 exporter | T10, T11, T14, T15 |
| R6 semantic direct edit | T7, T13, T15 |
| R7 footer placement | T8, T13, T15 |
| R8 body number | T8, T13, T15 |
| R9 AI instruction | T9, T14, T15 |
| R10 archive/migration | T2, T12, T13 |
| R11 edition separation | T9, T14, T15 |
| R12 performance/a11y/failure | T3, T10, T11, T15, T16 |

## 5. Completion Rule

M22는 다음 조건을 모두 만족해야 pass다.

1. T1-T16이 현재 gitHead에서 완료됐다.
2. typecheck, full test, Pro build, Lite build, Lite edition scan이 pass다.
3. v1 project/PNG golden regression이 pass다.
4. `1080x1920`, 30 fps H.264/AAC MP4가 ffprobe와 manual playback을 통과한다.
5. one-primary-audio, final-frame-hold, progress/cancel/cleanup이 검증됐다.
6. 다섯 semantic slot 직접 편집과 footer/body-number 조절이 검증됐다.
7. Lite에 AI instruction/CLI surface가 남지 않고 Pro에서는 정상 작동한다.
8. security/license/evidence audit가 pass다.
9. EXE 패키징은 수행하지 않는다.

하나라도 실패하면 M22는 완료가 아니며, 실패 원인·재현·다음 수정점을 evidence와 HANDOFF에 남긴다.
