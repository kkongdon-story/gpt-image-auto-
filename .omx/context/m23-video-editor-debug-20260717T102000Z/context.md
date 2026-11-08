# M23 Video Editor Debug Context

## Task statement

M22 이후 추가된 직접 편집과 동영상 기능을 배포 가능한 수준으로 고친다. 계획 범위는 다음 세 가지다.

1. 작업보드의 제목, 소제목, 각 문단, 각 불릿, 배지, 푸터 등 실제 요소를 정확한 테두리로 선택하고 드래그 및 8방향 크기 조절할 수 있게 한다.
2. 선택 카드의 업로드 영상을 작업보드에서 실제 재생하고, 파일 한도와 실패 메시지를 명확히 한다.
3. 카드별 시간, 영상 구간, 전환을 조절하는 단일 트랙 타임라인을 만들고, 카드 간 영상 누수와 저화질 MP4를 제거한 뒤 Lite/Pro 배포 산출물까지 검증한다.

## User evidence

- 사용자 MP4: `C:\Users\js480\Downloads\cardnews-2026-07-17.mp4`
- SHA-256: `7430FEE21713CC771AADAC7FE8038508E7B003689E1D9A2E50E678AF0A50A1BE`
- 사용자 스크린샷: `C:\Users\js480\AppData\Local\Temp\codex-clipboard-39a1f320-f8ca-4eac-8e15-dd58434f4990.png`
- 포렌식 프레임 폴더: `.omx/context/m23-video-editor-debug-20260717T102000Z/`
- 연락처 시트: `contact-sheet-1s.png`

## MP4 probe result

Bundled `resources/ffmpeg/ffprobe.exe`로 확인한 결과:

| Field | Value |
| --- | --- |
| Container | MP4 |
| Video codec/profile | H.264 Constrained Baseline |
| Resolution | 1080x1920 |
| Pixel format | yuv420p |
| Frame rate | 30fps |
| Duration | 30.000s |
| Frames | 900 |
| Video bitrate | 203,682bps |
| Container bitrate | 204,896bps |
| File size | 768,361 bytes |
| Audio stream | none |

The 30-second/900-frame result matches ten default 3-second cards exactly. The 0.204Mbps video bitrate is far below an acceptable 1080x1920 text-heavy export profile and directly explains the visible quality loss.

## Visual findings

- `frame-2_8.png`: card 1 interval에서 영상 내용과 큰 흰색 한글이 보인다.
- `frame-3_0.png`, `frame-3_2.png`: card 2 경계 직후에는 일시적으로 정상 카드만 보인다.
- `frame-5_8.png`: card 2 interval인데 card 1에만 있어야 할 영상의 흰색 문자가 카드 뒤에서 다시 보인다.
- `contact-sheet-1s.png`: 이후 카드에도 원본 영상 내용이 간헐적으로 섞인다.

This proves a per-card media-isolation failure in the exported file. It does not by itself prove whether the first fault is global-selection inheritance, stale DOM/video reuse, local-time looping, or transition capture. M23 must lock a deterministic RED fixture before changing the exporter.

## Current implementation findings

### Semantic editing

- `src/ui/m22MediaUi.ts` exposes only five coarse semantic slots: `title`, `subtitle`, `body`, `badge`, `footer`.
- Paragraphs and bullets are concatenated into one `body` draft, so the board cannot select each content item independently.
- `src/ui/App.tsx` gives custom layers 8 resize handles, but semantic slots only get move behavior.
- `src/render-engine/cardTemplate.ts` emits repeated `data-slot="paragraph"` and `data-slot="bullet"` values without stable item IDs.
- Existing semantic overlays use coarse normalized defaults instead of the rendered element's measured DOM rectangle.

### Preview playback

- `src/ui/App.tsx` loads `mediaPreviews`, but `previewAssetCssUrls` merges only background and image previews.
- The central preview has no selected-card live `<video>` binding. It therefore shows a poster/area instead of playable media.
- There is no lifecycle assertion that pauses and disposes the previous card's video when card selection changes.

### Media validation

- `src/storage/mediaLibrary.ts` primarily enforces file-size limits and allows up to 500MiB per video.
- It lacks a release contract for duration, resolution, frame rate, codec/profile, and pixel format.
- The validation path reads the source into memory before a complete capability decision, which is unsafe for very large files.
- `electron/videoMediaProbe.ts` returns width, height, duration, and audio presence, but not enough metadata to enforce the required policy.

### Timeline and frame production

- `src/domain/videoTimeline.ts` already compiles scene duration and transition overlap.
- `electron/videoFrameProducer.ts` builds a separate simplified timeline and does not consume that compiled contract.
- The producer has no frame-level ownership assertion for the active card and media IDs.
- Video local time loops with modulo behavior even when the user did not request looping.
- Existing tests use fake pixels or solid RGBA input and do not exercise the full renderer-to-FFmpeg path for multiple cards.

### Encoding

- `electron/videoExporter.ts` selects `h264_mf`, yuv420p, 30fps, and faststart, but does not define a rate-control, target bitrate, quality, or GOP profile.
- Bundled FFmpeg reports that `h264_mf` supports `rate_control`, `scenario`, `quality`, and `hw_encoding`; standard bitrate/GOP arguments still need a real preflight encode.

## Constraints

- Lite and Pro must share the editor, video preview, timeline, and MP4 export fixes.
- Lite must continue to strip or lock Pro AI and bulk-only functionality.
- Existing M22 projects and media archives must remain loadable.
- Existing M22 distribution must not be overwritten; M23 uses a new immutable staging folder.
- No new full NLE dependency is assumed. The target is a constrained one-card-track editor, not a complete CapCut clone.
- Public release cannot be declared from source tests alone. Packaged fresh-profile smoke and a clean Windows VM/install check are release gates.
- Code signing and SmartScreen reputation are external release concerns; unsigned-warning elimination is not part of this milestone.

## Decisions already safe to make

- Use one canonical compiled timeline for UI, preview, frame production, audio, and export.
- Give every rendered semantic item a stable ID and store normalized placement overrides by that ID.
- Mount a live video only for the selected card; rail thumbnails and inactive cards use posters.
- Import policy: MP4/H.264, AAC or no audio, maximum 300MiB, maximum 180 seconds, maximum 4K pixel area, maximum 60fps; retain legacy archive readability up to the previous hard limit.
- Scene duration: 0.5 to 180 seconds; total export hard limit 600 seconds.
- Default MP4 quality target: 1080x1920, 30fps, H.264 yuv420p, peak-constrained VBR around 10Mbps, two-second maximum GOP, with actual ffprobe and visual-quality gates.

## Unknowns that implementation must resolve with RED tests

1. Whether the card-1 video is assigned globally in persisted state or leaks only inside the render session.
2. Whether transition overlap contributes to the leak independently of stale video DOM reuse.
3. Which `h264_mf` rate-control options are honored on all supported Windows machines.
4. Whether current parsed content can carry stable paragraph/bullet IDs without a schema migration; if not, archive migration must seed and persist them.
5. The lowest supported-machine preview performance. The release profile must be reduced before shipping if the selected-card playback gate fails.

## Likely code touchpoints

- `src/domain/types.ts`
- `src/domain/media.ts`
- `src/domain/videoTimeline.ts`
- `src/ui/m22MediaUi.ts`
- `src/ui/App.tsx`
- `src/render-engine/cardTemplate.ts`
- `src/storage/mediaLibrary.ts`
- `src/storage/projectArchive.ts`
- `electron/videoMediaProbe.ts`
- `electron/videoFrameProducer.ts`
- `electron/videoExporter.ts`
- `electron/main.ts`
- `electron/lite-main.ts`
- `scripts/smoke-video-export.mjs`
- `scripts/verify-edition.mjs`
- `usage.html`
- `HANDOFF.md`

## Stop condition

Planning is complete only when the PRD and test spec receive sequential Architect then Critic approval and the durable consensus record marks `ralplan_consensus_gate.complete` as true. Implementation release is complete only when all M23 gates pass and newly staged Lite/Pro installer and unpacked artifacts have matching hashes and fresh-profile/VM evidence.
