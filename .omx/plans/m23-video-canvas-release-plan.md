# M23 작업보드 실제 요소 선택/영상 재생/MP4 품질/배포 계획 초안

> Status: supporting planner draft. The formal source of truth is `prd-v6-m23-canvas-video-timeline-hardening.md` plus `test-spec-v6-m23-canvas-video-timeline-hardening.md`. This draft must not be used alone for implementation or release approval.

## 목표

M23의 목표는 M22의 미디어/영상 기능을 실제 제작 도구 수준으로 닫는 것이다. 핵심 결과는 작업보드에서 카드의 실제 텍스트/배지/푸터/본문 개별 요소를 정확한 박스로 선택, 드래그, 8방향 리사이즈할 수 있고, 선택 카드 영상이 보드에서 실제 재생되며, 1080x1920 MP4가 저화질/카드 간 영상 누수 없이 카드별 duration/trim/전환/timeline 계약대로 출력되는 상태다.

## 현재 근거

- `src/ui/m22MediaUi.ts:18`의 semantic slot은 `title`, `subtitle`, `body`, `badge`, `footer` 5개뿐이며, `body`는 `paragraphs`와 `bullets`를 하나로 합친다(`src/ui/m22MediaUi.ts:115-126`, `src/ui/m22MediaUi.ts:250-258`).
- 일반 레이어는 이미 8방향 리사이즈가 있다. `ResizeHandle`과 `resizeHandles`는 `src/ui/App.tsx:254`, `src/ui/App.tsx:297`에 있고 일반 레이어에만 핸들이 렌더된다(`src/ui/App.tsx:1195-1202`).
- 의미 슬롯은 이동만 있다. `beginSemanticMove`와 semantic drag는 `src/ui/App.tsx:859-883`, `src/ui/App.tsx:960-970`에 있고, semantic slot 박스에는 resize handle이 없다(`src/ui/App.tsx:1207-1228`).
- `mediaPreviews`는 로드되지만(`src/ui/App.tsx:1929-1942`), 카드 HTML preview에 넘기는 `previewAssetCssUrls`에는 `backgroundPreviews`와 `imagePreviews`만 들어간다(`src/ui/App.tsx:1524-1535`). 따라서 작업보드 iframe preview에는 실제 `<video>` 연결 경로가 없다.
- 업로드 한도는 현재 파일 크기 중심이다. `MEDIA_LIBRARY_LIMITS`는 image 25MiB, video 500MiB, project 2GiB만 가진다(`src/storage/mediaLibrary.ts:100-103`), 비디오 width/height/duration/fps/codec 정책은 `readMetadata` 검증에 없다(`src/storage/mediaLibrary.ts:400-414`).
- 프로젝트 archive도 media 200개, video 50개, total 2GiB, video 500MiB 한도다(`src/storage/projectArchive.ts:119-128`).
- timeline 컴파일은 1080x1920/30fps와 card scene duration/transition을 계산한다(`src/domain/videoTimeline.ts:9-12`, `src/domain/videoTimeline.ts:50-112`).
- 그러나 frame producer는 자체 단순 timeline을 만들며 transition을 쓰지 않는다(`electron/videoFrameProducer.ts:138-154`). exporter는 `compileVideoTimeline`의 frame count/audio를 쓰지만(`electron/main.ts:3579-3614`, `electron/lite-main.ts:296-331`), 영상 프레임 캡처와 timeline 계약이 분리되어 있다.
- FFmpeg 인코딩은 `h264_mf`, `yuv420p`, `+faststart`만 지정하고 bitrate/quality/GOP가 없다(`electron/videoExporter.ts:210-221`).
- M22 handoff 기준 Lite/Pro build, packaged verify-edition, package security, 무설치 EXE smoke, MP4 smoke는 통과 이력이 있다(`HANDOFF.md:2432-2442`). M23은 이 release path를 확장하되 새 품질 게이트를 추가한다.

## 최소 데이터 계약

### 1. Semantic Item ID

기존 `SemanticSlotId`는 화면 요소 식별 단위로 부족하므로 `SemanticItemId`를 새 계약으로 둔다.

- 형식: `card-{cardIndex}:{kind}:{stableKey}`
- 예시:
  - `card-1:title:main`
  - `card-1:subtitle:main`
  - `card-1:paragraph:p0`
  - `card-1:paragraph:p1`
  - `card-1:bullet:b0`
  - `card-1:bullet:b1`
  - `card-1:badge:text`
  - `card-1:badge:image`
  - `card-1:footer:account`
  - `card-1:source:main`
  - `card-1:emphasis:main`
  - `card-1:body-number:main`
- 저장 계약:
  - `CardOverride.semanticItems?: Partial<Record<SemanticItemId, SemanticItemPlacement>>`
  - 기존 `semanticSlots`는 migration input으로만 읽고, M23 UI는 item-level 계약을 우선한다.
  - `SemanticItemPlacement`는 현재 `SemanticSlotPlacement`의 `mode/x/y/width/height/anchor`를 재사용하되, `height`는 모든 선택 가능한 실제 요소에 필수 저장값으로 정규화한다.
- 선택 박스 기준:
  - iframe 내부 `[data-slot]` 실제 DOM rect를 우선 측정한다.
  - DOM rect가 없는 optional 요소는 선택 박스를 만들지 않는다.
  - 사용자가 수동 배치한 item만 override에 저장한다.

### 2. Timeline Mapping

`compileVideoTimeline`을 단일 출처로 삼는다.

- `CompiledVideoTimeline.scenes[]`는 `cardIndex`, `startMs`, `durationMs`, `endMs`, `transition`, `transitionMs`, `sources[]`를 가진다.
- frame producer는 자체 `buildTimeline`을 폐기하거나 `compileVideoTimeline` 결과를 입력받아 사용한다.
- frame index -> timestamp -> scene lookup은 동일 함수로 공유한다.
- transition 구간은 `scene.transitionMs`가 0보다 클 때만 렌더링하며, 전환 중에는 이전 카드와 다음 카드의 프레임을 명시적으로 합성하거나, 구현 전까지 export를 실패 처리한다. 묵시적 무시는 금지한다.

### 3. Card Media Ownership

카드 간 영상 누수를 막기 위해 media ownership을 명시한다.

- Deck/global media: `deck.backgroundMedia`가 `asset`이면 모든 카드 기본값으로만 사용한다.
- Card media: `overrides[cardNumber].backgroundMedia`가 `asset`이면 해당 카드에만 소유된다.
- Layer media: `overrides[cardNumber].layers[].kind === "video"`이면 해당 카드와 해당 layer id에만 소유된다.
- Export frame HTML에는 현재 scene의 owned media만 주입한다. 이전 카드 DOM/비디오 요소 재사용은 금지한다.
- fresh card load마다 `video.src`, playing state, currentTime, DOM root가 scene-local임을 probe로 검증한다.

## 구현 순서와 파일 범위

### 0. M23 RED Fixture와 재현 게이트

파일 범위:

- 신규 테스트/fixture: `electron/videoFrameProducer.test.ts`, `electron/videoExporter.test.ts`, `src/domain/videoTimeline.test.ts`, 필요 시 `scripts/smoke-video-export.mjs`
- evidence 출력: `.omc/evidence/v6/m23-canvas-video-timeline-hardening/`

작업:

1. 사용자 MP4와 동일한 특성의 작은 deterministic fixture를 만든다: 1080x1920, 30fps, 30초, 무음, 낮은 bitrate, 카드1에만 눈에 띄는 텍스트/색상 마커.
2. 10 cards, 각 3000ms, 카드1에만 영상, 카드2 이후에는 마커가 없어야 하는 RED fixture를 만든다.
3. 현재 구현에서 frame-5.8 또는 카드2 구간의 누수 여부를 실패로 고정한다.

수용 기준:

- RED fixture가 현재 코드에서 실패하거나, 실패하지 않으면 “사용자 파일 전용 재현 필요”로 별도 evidence를 남긴다.
- 누수 판정은 픽셀/텍스트 OCR/색상 마커 중 최소 1개 이상으로 자동화한다.

차단 게이트:

- 카드1 영상 누수 재현 또는 부재 증거 없이 exporter 수정 착수 금지.

### 1. Semantic Item Contract 확장

파일 범위:

- `src/domain/types.ts`
- `src/domain/media.ts`
- `src/ui/m22MediaUi.ts`
- `src/storage/deckStore.ts`
- `src/storage/projectArchive.ts`
- 관련 tests: `src/domain/media.test.ts`, `src/storage/projectArchive.test.ts`, `src/ui/m22MediaUi.test.ts`

작업:

1. `SemanticItemId`, `SemanticItemPlacement`, `semanticItems` override 계약 추가.
2. 기존 `semanticSlots`를 읽어 `title/subtitle/body/badge/footer`의 fallback placement로 변환하되, 본문 paragraph/bullet 개별 item은 DOM 측정 기본값으로 둔다.
3. project archive v2 media/reference 보존과 별개로 semantic item override가 roundtrip되는지 고정한다.
4. AI/bulk edition rule을 깨지 않도록 `BulkBindingTarget`은 텍스트 내용 치환에만 유지하고, placement override는 bulk 자동 생성 대상에서 제외한다.

수용 기준:

- 기존 workspace/project는 깨지지 않고 로드된다.
- 새 workspace 저장 후 reload하면 `paragraph:p0`, `bullet:b0` 등 개별 item placement가 보존된다.
- Lite stripping 테스트가 Pro AI/bulk 금지 심볼 기준을 계속 통과한다.

차단 게이트:

- 저장/불러오기 roundtrip 실패 시 UI 작업 착수 금지.

### 2. 실제 DOM Rect 기반 선택 박스와 8방향 리사이즈

파일 범위:

- `src/ui/App.tsx`
- `src/ui/m22MediaUi.ts`
- `src/ui/*.test.ts`
- 필요 시 stylesheet 포함 파일

작업:

1. iframe 내부 `[data-slot]` rect를 `getBoundingClientRect()`로 수집해 작업보드 overlay 좌표로 변환한다.
2. `title`, `subtitle`, `paragraph[]`, `bullet[]`, `badge text/image`, `footer`, `source`, `emphasis`, `body-number`를 실제 DOM rect 기준으로 선택 박스화한다.
3. 일반 레이어의 `ResizeHandle`/`transformResizeRect` 경로를 semantic item에도 재사용한다.
4. move, resize, nudge, inline text edit의 target을 `selectedLayerId | selectedSemanticItemId`로 분리한다.
5. 박스 border는 실제 요소 rect와 최대 2px 이내로 맞춘다.

수용 기준:

- 제목/소제목/각 문단/각 불릿/배지/푸터가 각각 독립 선택된다.
- 모든 semantic item은 드래그와 8방향 resize handle을 제공한다.
- `Shift` snap bypass, arrow nudge 동작이 일반 레이어와 동일하게 작동한다.
- 본문 전체가 하나로만 잡히는 회귀가 없다.

차단 게이트:

- 실제 DOM rect와 overlay box 오차가 desktop scale별 2px 초과면 다음 단계 금지.

### 3. 작업보드 선택 카드 실제 영상 재생

파일 범위:

- `src/ui/App.tsx`
- `src/render-engine/cardTemplate.ts`
- `src/ui/m22MediaUi.ts`
- 필요 시 preload/API type: `src/domain/cardnews-api.ts`

작업:

1. `mediaPreviews` 또는 별도 `mediaPlaybackUrls`를 `previewAssetCssUrls`/video source mapping에 포함한다.
2. iframe preview에서도 `data-media-kind="video"` 요소에 실제 `<video>`를 붙인다.
3. 선택 카드가 바뀌면 이전 카드 video DOM/source를 정리하고 새 카드 owned media만 로드한다.
4. 편집 모드에서는 선택 박스 조작이 우선이고, 미리보기 모드에서는 영상 재생/일시정지 UI가 가능하도록 pointer policy를 정리한다.

수용 기준:

- 선택 카드 배경 영상과 video layer가 작업보드에서 실제 재생된다.
- 카드 전환 후 이전 카드 영상이 새 카드 DOM에 남지 않는다.
- 이미지 poster fallback은 유지된다.

차단 게이트:

- preview iframe에 실제 `<video>`가 없거나 카드 전환 후 이전 media id가 남으면 timeline/export 수정 금지.

### 4. 업로드 Limits 명시와 검증 강화

파일 범위:

- `src/storage/mediaLibrary.ts`
- `src/storage/projectArchive.ts`
- `electron/videoMediaProbe.ts`
- `src/ui/App.tsx`
- `usage.html`
- `README.md` 또는 release guide

확정 수치:

- 단일 이미지: 25MiB 유지.
- 신규 단일 영상: 300MiB hard max. 기존에 정상 수용된 300-500MiB archive asset은 읽기만 허용하고 신규 복제/재등록은 금지한다.
- 프로젝트 전체 media: 2GiB 유지.
- 프로젝트 media 개수: 전체 200개, video 50개 유지.
- 단일 영상 duration: hard max 180초.
- 해상도: min 320x320, 총 pixel area 최대 8,294,400, 어느 한 변도 3840 초과 금지.
- fps: 1-60 허용, export는 30fps로 정규화.
- codec/container: MP4/H.264 video와 AAC 또는 무음만 신규 import 허용. MOV/WebM과 미지원 codec은 변환 안내와 함께 거부한다.

수용 기준:

- import 실패 메시지에 파일 크기, duration, resolution, fps, codec/container 중 어떤 제한을 넘었는지 표시된다.
- UI에 한도 설명이 보인다.
- docs/release guide에 동일 수치가 반복된다.

차단 게이트:

- UI/문서/실제 validator 한도가 서로 다르면 release candidate 금지.

### 5. 단일 Timeline 기반 duration/trim/transition/CapCut형 Track

파일 범위:

- `src/domain/videoTimeline.ts`
- `electron/videoFrameProducer.ts`
- `src/ui/App.tsx`
- `src/ui/m22MediaUi.ts`
- `src/domain/videoTimeline.test.ts`
- `electron/videoFrameProducer.test.ts`

작업:

1. `compileVideoTimeline` 결과를 UI summary, timeline bar, frame producer, audio segment 생성의 단일 입력으로 만든다.
2. UI에는 CapCut형 단일 트랙을 추가한다: 카드 segment 1줄, 각 segment width는 duration 비례, trim marker와 transition overlap만 표시한다.
3. 카드별 duration, background/video layer trim, transition이 track에 즉시 반영된다.
4. 전환 구현 범위를 명시한다. M23에서 fade/slide를 구현하지 못하면 transition 선택 시 MP4 export 전에 fail-fast하고 UI에 “preview only” 또는 “export unsupported”를 표시한다.

수용 기준:

- 10 cards 기본값은 30,000ms, 900 frames로 표시된다.
- 특정 카드 duration을 2000ms로 바꾸면 track width와 total frame count가 즉시 바뀐다.
- trim start/end가 scene duration보다 길어도 normalize 후 export가 실패하지 않는다.

차단 게이트:

- UI summary와 exporter frame count가 1 frame 이상 다르면 MP4 export 금지.

### 6. MP4 품질과 카드 간 누수 제거

파일 범위:

- `electron/videoExporter.ts`
- `electron/videoFrameProducer.ts`
- `electron/main.ts`
- `electron/lite-main.ts`
- `scripts/smoke-video-export.mjs`
- 신규/수정 테스트

작업:

1. FFmpeg args에 품질 정책을 추가한다.
   - `h264_mf` 유지 시 target bitrate `-b:v 6000k`, maxrate `9000k`, bufsize `12000k`, GOP `-g 60`, keyint `60`에 해당하는 가능한 옵션을 적용한다.
   - Windows MF에서 일부 옵션이 무시되면 preflight로 실제 ffmpeg stderr/ffprobe 결과를 확인하고 fallback encoder 정책을 둔다.
2. export frame producer가 scene 전환 시 완전히 새 HTML 파일/DOM/video source를 로드하고, `loadedCardIndex` 재사용이 누수 원인이 아닌지 RED fixture로 확인한다.
3. 현재 scene에 속하지 않는 `data-media-id`가 있으면 capture 전에 실패시킨다.
4. ffprobe 기반 품질 검증을 smoke에 추가한다.

정량 품질 기준:

- 출력: MP4, 1080x1920, 30fps, yuv420p.
- duration: expected duration 대비 오차 <= 1 frame, 30fps 기준 33.34ms.
- frame count: expected frames와 동일하거나 ffprobe rounding 때문에 최대 1 frame 오차.
- 평균 video bitrate: motion/text fixture에서 6Mbps 이상. 정적 fixture는 bitrate 예외 대신 SSIM 0.97 이상과 PSNR 36dB 이상으로 판정한다. 사용자 첨부 출력과 같은 약 0.204Mbps 결과는 high profile에서 실패다.
- GOP/keyframe: keyframe 간격 <= 2초.
- leakage: 카드2 이후 frame sample에서 카드1 전용 마커 픽셀/문자 검출 0건.
- audio 없음 입력은 audio stream 없음 또는 의도한 mute 상태로 통일한다.

차단 게이트:

- ffprobe가 resolution/fps/duration/bitrate를 확인하지 못하면 release 금지.
- 카드1 마커가 카드2 이후에서 1건이라도 검출되면 release 금지.

### 7. Lite/Pro 공통 기능과 AI/Bulk Edition Rule 유지

파일 범위:

- `src/domain/editionFilter.ts`
- `src/domain/cardnews-api.ts`
- `scripts/build-edition.mjs`
- `scripts/verify-edition.mjs`
- `electron/main.ts`
- `electron/lite-main.ts`
- `src/edition/**`

작업:

1. 작업보드 semantic item, 영상 preview, media import, MP4 export, timeline은 Lite/Pro 공통 기능으로 유지한다.
2. AI chat/provider, bulk CSV/template bulk, project file, background removal 등 Pro 전용 rule은 기존 verify-edition 기준으로 유지한다.
3. Lite scan allowlist에는 공유 미디어/MP4 API만 남기고 AI/bulk 심볼 유입은 계속 실패시킨다.

수용 기준:

- `npm run build:lite` 후 `node scripts/verify-edition.mjs --edition lite --scan dist dist-electron` 통과.
- Pro build에서 AI/bulk 기능 smoke가 기존처럼 통과.
- Lite에서 M23 공통 기능은 잠기지 않는다.

차단 게이트:

- Lite에 AI/bulk forbidden symbol이 남으면 package 금지.

### 8. 테스트/검증 게이트

필수 순서:

1. `npm run typecheck`
2. `npm test`
3. M23 targeted tests:
   - semantic item id/placement roundtrip
   - DOM rect overlay geometry
   - media import limits
   - timeline mapping
   - RED leakage fixture
   - ffprobe quality probe
4. `npm run build:lite`
5. `node scripts/verify-edition.mjs --edition lite --scan dist dist-electron`
6. `npm run build:pro`
7. 실제 MP4 smoke: 사용자와 동일 특성의 1080x1920/30fps/30sec 무음 저화질 입력 포함

차단 게이트:

- 위 순서 중 하나라도 실패하면 package 단계 진입 금지.

### 9. Source -> Lite/Pro Build -> Isolated Package -> Fresh Profile Smoke -> Staged Release/Rollback

파일/산출 범위:

- `electron-builder.lite.json`
- `electron-builder.pro.json`
- `scripts/prepare-pro-package.mjs`
- `scripts/verify-package-security.mjs`
- `scripts/verify-edition.mjs`
- `scripts/verify-packaged-render.mjs`
- `release/distribution/Cardnews-Studio-M23-{timestamp}/`
- `.omc/evidence/v6/m23-canvas-video-timeline-hardening/`

단계:

1. Source gate
   - typecheck/test/targeted smoke 통과.
   - working tree diff와 plan/test evidence를 기록.
2. Lite build
   - `npm run build:lite`
   - Lite dist/dist-electron `verify-edition`.
3. Pro build
   - `npm run build:pro`
   - `scripts/prepare-pro-package.mjs`.
4. Isolated package
   - Lite installer, Lite win-unpacked, Pro installer, Pro win-unpacked 생성.
   - package security scan.
   - app.asar와 win-unpacked verify-edition 재검사.
5. Fresh profile smoke
   - `%LOCALAPPDATA%/CardnewsStudio/M23-smoke-{edition}-{timestamp}` 같은 격리 profile 사용.
   - Lite/Pro 각각 무설치 EXE 직접 실행.
   - workspace-ready, selected card video playback, semantic item drag/resize, MP4 export, ffprobe, leakage smoke 확인.
6. Clean Windows VM smoke
   - Node/npm/source workspace가 없는 clean Windows snapshot에서 Lite/Pro installer 설치, 첫 실행, 영상 import/재생, semantic drag/resize, timeline, MP4 export, ffprobe, 종료, uninstall, residue 확인을 수행한다.
   - VM evidence가 없으면 `blocked`이며 public-ready staging을 할 수 없다.
7. Staged release
   - `release/distribution/Cardnews-Studio-M23-{timestamp}/`에 Lite/Pro 설치형/무설치/사용설명서/manifest/SHA256SUMS 배치.
   - 이전 M22/M21 배포 폴더는 덮어쓰지 않는다.
   - G0-G11 전부 `pass`가 아니면 current release pointer, 최신 안내 문서, public-ready status를 변경하지 않는다.
8. Rollback
   - M23 staged release 실패 시 `distribution-manifest.json`에 `status: rejected` 기록.
   - 최신 안내 문서는 이전 통과 배포인 M22 경로로 되돌린다.
   - 실패 evidence와 blocker를 `HANDOFF.md` 또는 M23 release note에 기록한다.

수용 기준:

- isolated build source와 staged release copy의 SHA-256 불일치 0건.
- Fresh profile smoke가 Lite/Pro 모두 통과.
- staged release manifest에 버전, edition, artifact path, sha256, evidence path, known limitations가 포함된다.

차단 게이트:

- fresh profile smoke 없이 staged release 완료 선언 금지.
- staged copy hash mismatch 1건 이상이면 배포 금지.

## 수용 기준 요약

- 실제 요소 선택: title/subtitle/각 paragraph/각 bullet/badge/footer/source/emphasis/body-number가 각각 독립 선택되고 DOM rect와 2px 이내로 맞는다.
- 조작: 모든 선택 가능한 실제 요소가 드래그와 8방향 리사이즈를 지원한다.
- 영상 preview: 선택 카드 작업보드 iframe에서 실제 video가 재생되고 카드 전환 후 이전 media id가 남지 않는다.
- limits: UI/문서/validator의 파일 크기, duration, resolution, fps, codec/container 한도가 일치한다.
- MP4: 1080x1920, 30fps, duration 오차 <= 1 frame, bitrate 기준 통과, GOP <= 2초, 카드 간 영상 누수 0건.
- timeline: UI 단일 트랙, summary, frame producer, audio segment, exporter가 동일 timeline 결과를 사용한다.
- edition: Lite/Pro 공통 M23 기능은 유지되고 Lite에 AI/bulk forbidden symbol이 없다.
- release: source gate -> Lite/Pro build -> isolated package -> fresh profile smoke -> staged release/rollback 경로가 모두 evidence로 남는다.

## 주요 리스크와 대응

- 실제 DOM rect 측정은 iframe scale, font loading, CSS transform에 민감하다. 대응: font/image readiness 이후 측정하고 scale별 geometry smoke를 둔다.
- transition 구현이 frame producer에 없어서 UI와 export가 어긋날 수 있다. 대응: compile timeline을 단일 출처로 만들고, 전환 미구현 상태에서는 export fail-fast를 선택한다.
- Windows `h264_mf`가 bitrate/GOP 옵션을 일부 무시할 수 있다. 대응: ffmpeg stderr와 ffprobe 결과를 품질 게이트로 삼고 fallback encoder 정책을 남긴다.
- 영상 누수 원인은 현재 확정되지 않았다. 대응: RED fixture를 먼저 만들고, DOM 재사용/source ownership/capture timing을 분리 진단한다.
- Lite/Pro shared feature 확장이 Lite stripping을 깨뜨릴 수 있다. 대응: M23 공통 API만 allowlist하고 AI/bulk 금지 심볼 scan을 package 전후 모두 실행한다.

## Non-goals

- 새 AI 기능 추가.
- bulk CSV/template bulk 기능 확장.
- 4K/60fps export 품질 보장.
- 다중 트랙 전문 영상 편집기 구현.
- 다중 OS/다중 하드웨어 조합 전체 자동화. 단, 지정 clean Windows VM 설치/실행/내보내기/제거 검증은 필수다.
- 코드 서명/SmartScreen 해소. 서명 추가는 별도 릴리스 과제다.
- 사용자 제공 원본 MP4 자체를 변환/복구하는 기능.

## 실행 중지 조건

- RED leakage fixture 또는 사용자 파일 기반 재현 증거가 확보되지 않으면 exporter 원인 수정은 보류한다.
- semantic item 저장/복원 roundtrip이 실패하면 UI overlay 확장은 보류한다.
- preview iframe에서 실제 video playback이 안정화되지 않으면 MP4 export 품질 게이트로 넘어가지 않는다.
- Lite `verify-edition` 실패, ffprobe 실패, leakage 1건 이상, fresh profile smoke 실패 중 하나라도 있으면 M23 release는 staged rejected로 종료한다.
