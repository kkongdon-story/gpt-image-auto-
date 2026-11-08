# PRD: V6 M22 Card-first Media, Shorts Video, Direct Canvas, and AI Instruction

## 1. Goal

Cardnews Studio Lite/Pro에 카드 중심 이미지·영상 배치, 가벼운 장면 편집, 하나의 세로형 MP4 출력, 표준 텍스트 직접 편집을 추가한다. Pro AI는 고정 꽁돈 인격을 제거하고 사용자가 관리하는 기본 지침으로 동작하게 한다.

완료 상태는 다음과 같다.

- 선택 카드에서 이미지나 영상을 바로 추가하고 `전역 따름 / 이 카드만 / 비우기`를 선택한다.
- 전역 기본 미디어를 지정해 여러 카드에 공통 적용할 수 있다.
- 카드 배경 영상과 자유 영상 레이어를 배치한다.
- 장면 시간, 영상 in/out, 음량, 기본 전환을 설정한다.
- 카드마다 주 오디오 하나만 재생되고 나머지는 자동 음소거된다.
- 모든 카드를 잇는 `1080x1920`, 30 fps H.264/AAC MP4 한 개를 출력한다.
- 제목, 소제목, 본문, 배지, 푸터를 중앙 작업 보드에서 직접 선택·이동·편집한다.
- 푸터를 카드 오른쪽 끝까지 옮기고 본문 자동 번호를 전역/카드별로 숨길 수 있다.
- Pro에서 편집 가능한 AI 기본 지침이 모든 CLI 제공자 대화에 적용된다.
- Lite/Pro 모두 수동 미디어 편집과 MP4 출력을 제공하고, Lite에는 AI 지침/IPC/CLI 코드가 남지 않는다.
- 기존 프로젝트, 프로젝트 ZIP v1, PNG/PNG ZIP 출력과 M21 편집 계약이 유지된다.

이 문서는 구현 계획이다. M22 실행 명령 전에는 제품 코드, EXE, 설치 파일을 변경하지 않는다.

## 2. Source of Truth

- Interview transcript: `.omx/interviews/m22-media-video-canvas-ai-20260716T021954Z.md`
- Requirements spec: `.omx/specs/deep-interview-m22-media-video-canvas-ai.md`
- Context snapshot: `.omx/context/m22-media-video-canvas-ai-20260716-103438.md`
- Previous milestone: `.omx/plans/prd-v6-m21-canva-editor-bulk-bindings.md`
- Test specification: `.omx/plans/test-spec-v6-m22-media-video-canvas-ai.md`

요구사항 스펙의 Binding Decisions와 Edition Matrix는 사용자 확정값이며 구현 편의로 바꾸지 않는다.

## 3. Current Findings and Root Causes

### 3.1 미디어 흐름

- `Deck.backgroundId`는 전역 배경이고 `CardOverride.backgroundId`는 카드별 override다.
- 현재 데이터는 이미 상속을 표현하지만 업로드/관리와 카드 배치 UI가 떨어져 있어 매 카드마다 긴 패널 동선을 반복한다.
- 배경 라이브러리와 이미지 레이어 라이브러리가 분리되어 같은 파일명이 반복되고 삭제/사용처 추적이 어렵다.
- 외부 절대 경로 대신 userData 복사본과 ID를 쓰는 기존 안전 원칙은 유지해야 한다.

### 3.2 영상과 출력

- `CardLayer`는 text/shape/line/image만 지원한다.
- scene duration, clip range, audio, transition, timeline, MP4 API가 없다.
- `renderDeckOffscreen`은 카드별 HTML/PNG를 생성하는 정적 경로다.
- 기존 경로에 시간 개념을 억지로 넣으면 PNG 결정성과 승인/ZIP 흐름을 깨뜨릴 위험이 크다.
- 패키지에는 encoder dependency가 없다.

### 3.3 중앙 작업 보드

- iframe render 위 React overlay가 custom layer만 직접 다룬다.
- title/subtitle/body/badge/footer는 renderer의 semantic slot이므로 form 편집 중심이다.
- M21에서 표준 콘텐츠를 자유 레이어로 전환하지 않은 이유는 저장/파서/bulk/렌더 호환성이다. M22도 hybrid model을 유지한다.

### 3.4 푸터와 본문 번호

- 푸터는 pixel translate와 작은 clamp에 묶여 있어 카드 폭 전체를 이동할 수 없다.
- 본문 번호는 렌더 시 항상 계산되며 표시 정책이 없다.

### 3.5 AI

- 현재 AI system/action prompt에 Kkongdon 브랜드와 인격이 고정돼 있다.
- Pro UI가 system message를 prepending하고 Electron이 CLI 입력으로 직렬화한다.
- Lite는 AI API를 노출하지 않지만 새 설정키/문자열까지 검증하지 않으면 번들 누출이 생길 수 있다.

## 4. Scope

### In scope

1. 공용 미디어 catalog/resolver와 안전한 image/video import.
2. 카드 중심 background media assignment와 전역 기본 media.
3. 배경 video와 자유 video layer.
4. card scene duration, clip in/out, volume, basic transition.
5. 카드별 primary audio one-source rule.
6. deterministic 1080x1920 MP4 composition/export.
7. title/subtitle/body/badge/footer semantic slot selection, movement, inline edit.
8. footer normalized placement and legacy offset compatibility.
9. body number global default and per-card inherit/show/hide.
10. Pro editable AI default instruction and prompt priority.
11. project archive v2 media manifest and v1 import.
12. Lite/Pro edition stripping, performance, security, accessibility, failure UX.

### Out of scope

- 자동 자막/음성 인식.
- 영상 필터, 효과, 색보정, 키프레임.
- 멀티트랙 timeline, multi-audio mixing, BGM.
- 화면/카메라 녹화.
- 직접 SNS 업로드.
- Canva 전체 기능과 UI 복제.
- 표준 콘텐츠를 custom layer로 일괄 마이그레이션.
- MP4 개별 카드 파일 또는 가로형/정사각형 동영상 preset.
- WebCodecs-only exporter.
- M22 계획 단계의 EXE 패키징.

## 5. Edition Matrix

| Feature | Lite | Pro |
| --- | --- | --- |
| 미디어 라이브러리 | Enabled | Enabled |
| 카드별/전역 이미지·영상 | Enabled | Enabled |
| 자유 영상 레이어 | Enabled | Enabled |
| 장면 시간/in-out/음량/전환 | Enabled | Enabled |
| MP4 출력 | Enabled | Enabled |
| semantic slot 직접 편집 | Enabled | Enabled |
| 푸터 전체 X 이동 | Enabled | Enabled |
| 본문 번호 표시 제어 | Enabled | Enabled |
| AI 기본 지침 | Stripped/locked | Enabled |
| CLI AI chat/actions | Stripped/locked | Enabled |
| Bulk generation | Stripped/locked | Enabled |

수동 제작은 공통이고 AI/대량 생성은 Pro 전용이라는 V6 불변 원칙을 유지한다.

## 6. RALPLAN-DR

### Principles

1. 새 필드가 없는 프로젝트는 이전과 동일하게 열린다.
2. PNG renderer는 정적이고 결정적인 계약으로 유지한다.
3. video exporter는 같은 card render model을 재사용하되 별도 timeline/API를 가진다.
4. semantic content와 free layer를 구분해 bulk/content 의미를 보존한다.
5. 외부 media path는 저장하지 않고 관리 저장소의 ID만 persist한다.
6. 한 카드에서 실제로 들리는 audio source는 하나다.
7. manual media 기능은 Lite/Pro 공통, AI instruction은 Pro-only다.
8. export 실패가 기존 프로젝트나 원본 media를 손상시키면 안 된다.

### Options considered

#### Option A: 기존 PNG를 생성한 뒤 슬라이드쇼 MP4로 변환

- 장점: 구현이 단순하고 PNG renderer를 그대로 사용한다.
- 단점: 배경 video, 자유 video layer, clip in/out, audio를 표현하지 못한다.
- 결정: 거부.

#### Option B: renderer 전체를 Canvas/WebGL timeline editor로 재작성

- 장점: 장기적으로 자유로운 영상 효과를 구현하기 쉽다.
- 단점: 현재 HTML/CSS 템플릿, PNG parity, 한글 typography, old project를 동시에 흔든다.
- 결정: 거부.

#### Option C: WebCodecs만 사용해 앱 안에서 MP4 생성

- 장점: 외부 binary가 줄어든다.
- 단점: Electron/OS codec 지원과 audio muxing이 release 계약으로 충분히 안정적이지 않다.
- 결정: M22 primary path로 거부. 미래 adapter 후보로만 남긴다.

#### Option D: 별도 timeline compiler + offscreen frames + pinned LGPL FFmpeg

- 장점: 같은 renderer를 재사용하고 H.264/AAC output을 검증 가능하며 PNG path와 분리된다.
- 단점: binary provenance, license notice, package size, Windows Media Foundation 실패 처리가 필요하다.
- 결정: 채택.

### Decision

M22는 optional schema extension, unified media resolver, hybrid semantic overlay, separate video timeline/exporter 구조로 구현한다. FFmpeg build는 LGPL 조건을 만족하고 `h264_mf`/AAC를 포함하는 고정 artifact를 사용한다. `libx264`, GPL/nonfree build는 금지한다.

## 7. Domain Contracts

아래 이름은 구현 중 기존 naming에 맞게 조정할 수 있으나 의미와 상태 전이는 유지한다.

```ts
type MediaKind = "image" | "video";

interface MediaAssetRef {
  id: string;
  kind: MediaKind;
  displayName: string;
  relativePath: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  durationMs?: number;
  hasAudio?: boolean;
  posterRelativePath?: string;
}

type BackgroundMediaSelection =
  | { mode: "inherit" }
  | { mode: "none" }
  | { mode: "asset"; mediaId: string };

interface CardSceneSettings {
  durationMs: number;
  transition: "none" | "fade" | "slide-left" | "slide-up";
  transitionMs: number;
  primaryAudioSourceId: string | null;
}

interface CardVideoLayer extends CardLayerBase {
  kind: "video";
  mediaId: string;
  objectFit: "cover" | "contain";
  clipStartMs: number;
  clipEndMs: number | null;
  volume: number;
}

type SemanticSlotId = "title" | "subtitle" | "body" | "badge" | "footer";

interface SemanticSlotPlacement {
  mode: "flow" | "card";
  x: number;
  y: number;
  width?: number;
  height?: number;
  anchor: "top-left" | "top-center" | "top-right";
}

type BodyNumberMode = "inherit" | "show" | "hide";
```

Workspace/Deck에는 전역 media selection, scene defaults, body number default가 optional로 추가된다. CardOverride에는 background selection, scene, semantic slot placements, body number mode가 optional로 추가된다. 기존 `backgroundId`는 read compatibility를 유지하며 새 media selection이 있으면 새 계약이 우선한다.

`AppSettings.aiDefaultInstruction`은 Pro-only 설정이다. shared workspace나 Lite project archive에 저장하지 않는다.

## 8. Storage and Archive Architecture

1. 신규 import는 `userData/.../media/<id>/<safe-name>`에 복사한다.
2. media ID는 파일명과 분리된 안정적 식별자다.
3. hash 중복은 같은 binary를 재사용하되 UI entry 정책은 구현 시 결정할 수 있다.
4. legacy background/image library는 즉시 물리 이전하지 않는다. unified catalog adapter에서 함께 조회한다.
5. 삭제 전 workspace, card background, image/video layer, archive draft 사용처를 검사한다.
6. 사용 중인 media는 강제 삭제하지 않고 사용처 목록을 보여준다.
7. archive manifest v2는 media metadata와 relative ZIP path를 기록한다.
8. import 시 새 ID로 remap하고 모든 참조를 원자적으로 갱신한다.
9. archive v1은 기존 loader로 읽고 media v2 field 없는 상태로 정규화한다.

## 9. Video Export Architecture

### 9.1 Compile

`compileVideoTimeline(workspace)`는 card 순서, scene duration, effective background media, video layers, primary audio, transitions를 immutable composition으로 만든다. 이 단계에서 누락 media, invalid clip, duration overflow, audio collision을 검사한다.

### 9.2 Render

- 별도 hidden/offscreen BrowserWindow를 `1080x1920`으로 고정한다.
- 같은 card template과 font loader를 사용한다.
- renderer에 scene time을 명시적으로 전달한다.
- HTML video element를 deterministic seek한 뒤 `seeked`, `requestVideoFrameCallback` 또는 동등한 readiness gate를 기다린다.
- 매 frame을 BGRA/RGBA stream으로 encoder stdin에 전달한다.
- 모든 frame을 메모리나 PNG 폴더에 보관하지 않는다.

### 9.3 Encode and mux

- pinned FFmpeg 실행 파일을 child process로 호출한다.
- preflight가 version/hash/buildconf/`h264_mf`/AAC를 확인한다.
- H.264 `h264_mf` software mode, AAC, 30 fps, 1080x1920, yuv420p/nv12 호환, `+faststart`를 사용한다.
- selected primary audio만 scene audio graph에 연결한다.
- transition overlap만큼 총 duration을 명시적으로 계산한다.
- temp file은 output directory의 `.partial.mp4`이며 성공 후 rename한다.

### 9.4 Progress, cancel, failure

- progress는 compile, prepare, render/encode frame, finalize 단계와 percent를 노출한다.
- cancel은 renderer loop, FFmpeg process, temp files를 정리한다.
- Windows N/Media Foundation 부재, unsupported/corrupt media, disk full, permission error를 사용자 문장으로 구분한다.
- 실패 로그에는 개인 절대 경로와 AI 대화 내용을 불필요하게 노출하지 않는다.

## 10. UX Flows

### 10.1 Card-first media

선택 카드의 Content 패널 상단에 `이 카드 미디어` 영역을 둔다.

- 상태 segmented control: `전역 따름 / 이 카드만 / 비우기`.
- 명령: 이미지 추가, 영상 추가, 라이브러리 열기.
- 선택 결과: thumbnail/poster, 파일명, 종류, 해상도, 영상 길이.
- card rail badge: inherited, local image, local video, scene duration.

Design 패널에는 `전역 기본 미디어`를 유지한다. 전역값 변경은 inherit 카드만 즉시 바뀐다.

### 10.2 Video layer and scene

- Layer toolbar의 video icon으로 자유 video layer를 추가한다.
- layer inspector에서 object fit, opacity, clip start/end, volume을 조절한다.
- scene inspector에서 duration, transition, primary audio를 선택한다.
- primary audio 후보는 현재 카드의 audio-bearing background/video layers만 표시한다.
- 다른 source의 mute는 자동 상태로 보이고 임의로 동시에 unmute할 수 없다.

### 10.3 Direct semantic editing

- single click: semantic slot select.
- drag: normalized placement update.
- double click/Enter: inline text edit.
- Escape: edit cancel or selection clear.
- IME composition 중 Enter/Escape는 commit/cancel하지 않는다.
- body editor는 기존 line/bullet semantic을 보존한다.
- footer는 전역 콘텐츠임을 명확히 표시하고 이동/스타일과 텍스트 변경 범위를 구분한다.

### 10.4 MP4 export

Export 탭에 MP4 section을 PNG와 분리한다.

- output summary: 1080x1920, 30 fps, 예상 길이, 예상 크기 범위.
- preflight error를 export 시작 전에 보여준다.
- 시작 후 단계/진행률/경과 시간/취소를 제공한다.
- 완료 후 파일 열기와 폴더 열기를 제공한다.

### 10.5 AI default instruction

Pro AI settings에 multiline `기본 지침`과 저장/초기화 버튼을 둔다. 값이 비어 있으면 generic reset value를 사용한다. UI는 이것이 앱 전체 CLI 대화에 적용된다는 점과 구조화 카드 적용 규칙은 앱이 별도로 보존한다는 점을 짧게 표시한다.

## 11. Requirements

### R1. Unified media catalog and secure import

- image/video metadata, poster, duration, audio 여부를 관리한다.
- legacy libraries를 unified query로 보여준다.
- supported MIME과 실제 file signature를 함께 확인한다.
- 최대 파일/프로젝트 한도를 중앙 상수로 둔다.
- 사용처 기반 삭제와 누락 복구를 제공한다.

Acceptance:

- 한글/공백/동일 파일명 import가 충돌 없이 동작한다.
- 외부 원본 삭제 후에도 앱 media가 열린다.
- 사용 중 삭제가 차단되고 사용처가 표시된다.
- path traversal/symlink/unsupported/corrupt/oversized 입력이 거부된다.

### R2. Card-first media inheritance

- global default와 card `inherit/none/asset`을 구현한다.
- current card에서 직접 import 후 local assignment까지 완료한다.
- legacy `backgroundId`를 동일 시각 결과로 해석한다.

Acceptance:

- global 변경은 inherit 카드에만 반영된다.
- none은 global/style image를 의도적으로 비운다.
- local image/video가 global을 덮는다.
- save/reload/archive round-trip 후 상태가 유지된다.

### R3. Video background and free layer

- supported video를 full-card background와 free layer로 재생한다.
- object fit, normalized geometry, z-order, opacity, clip range, volume을 지원한다.
- poster/paused frame으로 thumbnail과 정적 편집 상태를 안정화한다.

Acceptance:

- preview/MP4 geometry가 pixel tolerance 안에서 일치한다.
- invalid clip은 normalize되거나 명확히 거부된다.
- 짧은 clip은 final frame hold를 사용한다.

### R4. Scene timing, transition, and audio

- global scene defaults와 per-card scene settings를 구현한다.
- mandatory transitions: none, fade. 추가 transition은 최대 두 개다.
- primary audio 하나만 선택할 수 있다.

Acceptance:

- timeline duration 계산이 transition overlap을 포함해 deterministic하다.
- non-primary source는 compile 결과에서 muted다.
- primary source 삭제 시 무음으로 안전하게 fallback하고 경고한다.

### R5. MP4 exporter

- new domain API, preload API, IPC handler, renderer/export service를 추가한다.
- PNG API를 변경하지 않는다.
- FFmpeg preflight, frame streaming, audio mux, progress, cancel, atomic finalize를 구현한다.

Acceptance:

- ffprobe metadata와 frame count/duration이 contract를 만족한다.
- Korean/space output path가 동작한다.
- cancel/failure 후 orphan process와 partial file이 없다.
- unsupported host에는 actionable error가 나온다.

### R6. Semantic slot direct editing

- title/subtitle/body/badge/footer를 overlay selectable object로 노출한다.
- renderer는 stable `data-slot` geometry를 제공한다.
- semantic slot placement와 inline edit를 저장한다.
- flow mode가 legacy default다.

Acceptance:

- 다섯 slot 모두 중앙에서 select/move/edit된다.
- IME, space, newline이 유실되지 않는다.
- M21 custom layer selection/editing regression이 없다.
- bulk binding과 semantic content field가 유지된다.

### R7. Footer full-width placement

- legacy pixel offset와 new normalized card placement union을 지원한다.
- anchor/box 계산으로 실제 card right edge까지 이동한다.
- safe-area snap은 제공할 수 있으나 physical edge 이동을 막지 않는다.

Acceptance:

- 4:5, 1:1, 16:9, 4:3 preview/PNG에서 같은 위치다.
- old offset-only fixture가 이전 위치로 렌더된다.
- out-of-range/NaN은 card bounds로 normalize된다.

### R8. Body number visibility

- global default `show/hide`와 card `inherit/show/hide`를 구현한다.
- computed numbering sequence는 숨김 여부와 무관하게 card order 기준을 유지한다.

Acceptance:

- 모든 조합이 truth table과 일치한다.
- legacy project는 show다.
- 한 카드를 hide해도 다음 카드 번호가 재번호화되지 않는다.

### R9. Pro editable AI default instruction

- fixed Kkongdon system/action kernel을 general prompt contract로 교체한다.
- setting 저장/불러오기/초기화/max length를 구현한다.
- provider별 chat call에 같은 priority order를 적용한다.
- raw chat은 user text를 그대로 최신 user message로 전달한다.

Acceptance:

- Claude/Codex/Gemini adapter payload에서 default instruction이 한 번만 나타난다.
- reset은 versioned generic default를 복원한다.
- Kkongdon prompt strings가 source/runtime payload에 없다.
- action parse/schema safety는 instruction override로 해제되지 않는다.

### R10. Archive v2 and migration

- workspace normalization은 optional M22 fields를 지원한다.
- archive v2에 media manifest/files/posters를 포함한다.
- v1 import와 old workspace load를 유지한다.

Acceptance:

- v1 fixture가 before screenshot/PNG와 동등하다.
- v2 export/import가 media references를 remap한다.
- malformed manifest, duplicate IDs, missing media가 안전하게 처리된다.

### R11. Edition separation

- R1-R8/R10/R12는 shared manual feature다.
- R9와 기존 AI execution은 Pro-only다.
- Lite UI는 AI control을 disabled shell로 남기지 않고 edition contract에 맞게 제거/잠금한다.

Acceptance:

- `verify-edition.mjs --edition lite`가 source/dist/app.asar scan을 통과한다.
- Lite에서 media/MP4가 정상 작동한다.
- Pro AI와 기존 bulk 회귀가 없다.

### R12. Performance, accessibility, and failure UX

- editor idle 상태에서 video frame loop를 불필요하게 돌리지 않는다.
- rail thumbnail/poster는 lazy load한다.
- media metadata 읽기와 archive hash는 renderer UI thread를 장시간 block하지 않는다.
- controls에 label, keyboard focus, status live region을 제공한다.
- export progress는 화면과 log 양쪽에 남긴다.

Acceptance:

- 10-card fixture의 editor interaction p95가 M21 baseline 대비 20% 이상 악화되지 않는다.
- MP4 export memory가 전체 raw frame 크기에 비례해 무제한 증가하지 않는다.
- keyboard-only로 card media assignment, slot edit, export cancel이 가능하다.

## 12. Security and License Gates

1. media file signature/MIME/extension allowlist.
2. normalized safe filenames and managed-root containment.
3. ZIP extraction path containment and decompressed size/count limits.
4. child-process executable path fixed to packaged trusted resource.
5. FFmpeg arguments passed as argv array, not shell command string.
6. output/temp path containment and no overwrite without explicit user action.
7. encoder checksum and expected build configuration verification.
8. LGPL notice, FFmpeg source/build recipe URL or bundled corresponding source offer.
9. `--enable-gpl`, `--enable-nonfree`, `libx264` forbidden scan.
10. logs redact unnecessary absolute paths and conversation contents.

## 13. Implementation Milestones

### M22-0. RED baseline and contracts

- M21/PNG/old-project/edition fixtures를 고정한다.
- optional domain types, normalize tables, archive v2 schema, timeline contract tests를 RED로 추가한다.

### M22-1. Media catalog and card-first assignment

- R1, R2, archive-neutral storage foundation.
- Lite/Pro 공통 UI.

### M22-2. Video layer and scene model

- R3, R4 domain/editor/preview.
- 아직 MP4 release claim을 하지 않는다.

### M22-3. Semantic slot board

- R6, R7, R8.
- preview/PNG parity와 M21 bulk semantic 회귀를 먼저 통과한다.

### M22-4. MP4 pipeline

- R5, encoder preflight, deterministic frame clock, audio mux, cancel/failure.
- LGPL/security gate를 포함한다.

### M22-5. AI default instruction

- R9, R11 Pro path와 Lite stripping.
- Kkongdon hard-coded prompt 제거.

### M22-6. Archive, performance, full regression

- R10, R12, full Lite/Pro matrix.
- EXE packaging은 별도 release milestone에서만 수행한다.

각 milestone은 targeted tests, typecheck, full test, build, evidence audit를 통과한 뒤 커밋한다. Commit message는 repo Lore protocol을 따른다.

## 14. Gate Order and Evidence

Evidence root:

```text
.omc/evidence/v6/m22-media-video-canvas-ai/
```

각 gate는 `.log`와 `.meta.json`을 남긴다. `.meta.json`은 command, startedAt, completedAt, exitCode, gitHead, edition, artifact hashes를 포함한다.

표준 gate 순서:

1. RED baseline.
2. domain/storage targeted tests.
3. media/editor targeted tests.
4. semantic-slot/PNG parity tests.
5. timeline/export unit/integration tests.
6. AI/edition stripping tests.
7. `npm run typecheck`.
8. `npm test`.
9. `npm run build:pro`.
10. `npm run build:lite`.
11. `node scripts/verify-edition.mjs --edition lite` with source/dist scans.
12. manual visual and MP4 smoke.
13. evidence audit and HANDOFF append during implementation.

앞 gate가 실패하면 뒤 build/release gate로 넘어가지 않는다.

## 15. Acceptance Matrix

| Requirement | Primary tests | Release evidence |
| --- | --- | --- |
| R1 | T2, T3 | import/delete/security logs |
| R2 | T4 | inheritance screenshots + state dump |
| R3 | T5 | preview/frame parity images |
| R4 | T6 | timeline/audio graph JSON |
| R5 | T10, T11 | MP4 + ffprobe + cancel logs |
| R6 | T7 | interaction video/screenshots + DOM state |
| R7 | T8 | multi-ratio screenshots/PNGs |
| R8 | T8 | truth-table test log |
| R9 | T9 | provider payload tests + Lite scan |
| R10 | T2, T12 | v1/v2 round-trip archives |
| R11 | T9, T14 | Lite/Pro build and strip logs |
| R12 | T13, T15 | performance/accessibility/manual QA |

## 16. Risks and Revisit Triggers

| Risk | Mitigation | Revisit trigger |
| --- | --- | --- |
| FFmpeg package/license risk | pinned LGPL build, hash/buildconf gate, notices | required encoder cannot be legally or reliably packaged |
| Media Foundation absent | startup/export preflight and actionable Windows N guidance | supported Windows machines show material failure rate |
| Frame/audio drift | integer frame clock and timeline duration tests | >1 frame or >50ms A/V drift in long fixture |
| Video preview performance | poster when idle, active-card playback only, lazy rail | p95 interaction regression >20% |
| Old project regression | optional fields and golden PNG fixtures | any v1 fixture visual diff outside tolerance |
| Semantic overlay mismatch | renderer-provided geometry, one slot contract | preview/PNG/MP4 placement diverges |
| Lite AI leakage | source/dist/asar forbidden-symbol scan | any AI instruction/API symbol in Lite |
| Archive size explosion | file/total limits, hash dedupe, streaming ZIP | routine projects exceed practical package size |

## 17. Definition of Done

M22 구현 완료는 다음을 모두 만족할 때만 선언한다.

- R1-R12 acceptance가 모두 pass다.
- T1-T16과 표준 gate 명령이 pass다.
- Lite와 Pro에서 공용 media/MP4 기능이 동작한다.
- Pro AI 기본 지침이 동작하고 Lite forbidden scan이 pass다.
- old workspace/archive v1과 PNG golden regression이 pass다.
- MP4 metadata, duration, audio, progress, cancel, Korean path smoke가 pass다.
- FFmpeg security/license evidence가 존재한다.
- `.omc/evidence/v6/m22-media-video-canvas-ai/` evidence audit가 pass다.
- `HANDOFF.md`는 구현 세션에서 append-only로 갱신된다.
- EXE는 별도 release PRD/gate에서만 생성한다.

## 18. Technical References

- Electron offscreen rendering: https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering
- Electron `webContents`: https://www.electronjs.org/docs/latest/api/web-contents
- FFmpeg legal and LGPL compliance checklist: https://ffmpeg.org/legal.html
- FFmpeg codec/Media Foundation encoder documentation: https://ffmpeg.org/ffmpeg-codecs.html
- W3C WebCodecs specification: https://www.w3.org/TR/webcodecs/

라이선스 항목은 구현·배포 gate를 정의하기 위한 엔지니어링 요구사항이며 법률 자문이 아니다. 실제 배포 전에는 사용한 FFmpeg binary의 정확한 build configuration과 배포 조건을 별도로 확인한다.

## 19. Suggested Follow-up Command

```text
[$ultrawork]
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m22-media-video-canvas-ai.md 와
.omx/plans/test-spec-v6-m22-media-video-canvas-ai.md 기준으로 M22-0부터 순서대로 구현해.
각 milestone의 수용 기준과 표준 gate를 통과시키고 증거를
.omc/evidence/v6/m22-media-video-canvas-ai/에 남겨.
Lite/Pro 에디션 경계와 FFmpeg LGPL/security 검증을 완료하고,
HANDOFF.md는 append-only로 갱신해. EXE 패키징은 하지 마.
```
