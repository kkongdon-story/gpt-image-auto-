# PRD: Cardnews Studio v5 — 완성형 마감 (수정 + 개선)

작성: 2026-07-07 (Claude, 사용자 테스트 피드백 기반)
실행 주체: Codex 또는 후속 Claude 세션 — **이 문서만으로 실행 가능해야 한다**
프로젝트 루트: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

## 0. 목표와 원칙

**목표: 이 프로그램을 "완성형"으로 만든다.** 기능이 있다고 끝이 아니라, 사용자가 실제로 쓸 때 어긋나는 부분이 없어야 한다.

**불변 원칙** (기존 아키텍처 계약 — 위반 금지):
1. 미리보기와 PNG는 **같은 `buildCardHtml()` HTML**에서 나온다. 미리보기 전용 렌더 경로를 만들지 않는다.
2. 렌더는 결정론적이어야 한다 — 같은 입력 = 같은 픽셀. 랜덤/시간 의존 스타일 금지.
3. 품질 게이트(hard-fail: contrast/overflow/font_floor/visual_artifact)는 우회하지 않는다.
4. 파서·템플릿·CSV 등 순수 모듈은 vitest 단위 테스트 먼저(RED→GREEN).
5. 모든 신규 저장 필드는 optional + 관대한 타입 가드 (v3/v4 데이터 하위호환).

**검증 표준 명령** (각 태스크 완료 시 해당분 실행):
```bash
npm run typecheck && npm test && npm run build
node node_modules/electron/cli.js scripts/style-matrix-smoke.mjs
CARDNEWS_SMOKE_ACTION=render-deck CARDNEWS_SMOKE_SCREENSHOT=.omc/evidence/v5/smoke.png CARDNEWS_SMOKE_TEXT=.omc/evidence/v5/smoke.txt node scripts/dev.mjs
```

**알려진 함정** (이번 세션들에서 실제로 밟은 것):
- 이전 빌드 `Cardnews Studio.exe` 실행 중이면 dist:win EBUSY → `taskkill //F //IM "Cardnews Studio.exe"` 후 `rm -rf release` 재시도. OneDrive 동기화 잠금도 원인.
- 미리보기 iframe에 `sandbox` 속성 금지 (OOPIF가 되어 capturePage 스모크에서 블랭크).
- Electron 스크립트에서 오프스크린 창이 닫히면 앱 종료됨 → `app.on("window-all-closed", () => {})` 필수.
- `transform: scale()`은 숫자만 — cqw 등 길이 단위 불가. ResizeObserver로 계산.
- exactOptionalPropertyTypes: optional 필드는 조건부 스프레드(`...(x ? {x} : {})`)로만.
- 히어독으로 한글+백틱 포함 파이썬 패치 스크립트 실행하면 bash 파싱 깨짐 → 파일로 저장 후 실행.

---

## 1. 우선순위 총괄

| # | 항목 | 심각도 | 규모 | Phase |
|---|------|--------|------|-------|
| P0 | git 커밋 (전 작업 무보호 상태) | 치명 | 소 | 즉시 |
| P1 | 문제7: CSV 한글 깨짐 (BOM 누락 — 원인 확정) | 높음 | 소 | V5-1 |
| P2 | 문제2: 폰트 임포트가 렌더에 반영 안 됨(의심) — 진단 후 수정 | 높음 | 중 | V5-1 |
| P3 | 문제3: 배경 기본값 = 없음 | 중 | 소 | V5-1 |
| P4 | 문제1: 스타일 관리 탭 콘텐츠 오버플로 | 중 | 소 | V5-1 |
| P5 | 문제9: @kkongdon_story 크레딧 노출 | 중 | 소 | V5-1 |
| P6 | 문제6: 세팅/프로젝트 명시적 저장·불러오기 | 중 | 중 | V5-2 |
| P7 | 문제4: 레이어 캔버스 직접 편집 (Canva식 드래그) | 높음(가치) | **대** | V5-3 |

V5-1(빠른 수정 묶음) → V5-2 → V5-3(대형) 순서로. 각 Phase 끝에 검증 표준 명령 + 스모크.

---

## 2. P0 — git 커밋 (즉시)

**현황**: 마지막 커밋 cc09957(v2.3.0, 크롬 익스텐션 시절) 이후 전부 미커밋. 앱 전체(v3+v4)가 워킹트리에만 존재.

**작업**:
1. `.gitignore` 확인/보강: `node_modules/`, `dist/`, `dist-electron/`, `release/`, `.omc/`, `.omo/`, `fonts/*.woff2`는 **커밋 포함**(재현성 — 2MB 하나뿐) 판단하되 원치 않으면 다운로드 스크립트로 대체.
2. 전체 diff 리뷰 후 논리 단위로 커밋(최소 1커밋이라도 즉시). 메시지 예: `feat: v1.0 Cardnews Studio — Electron 카드뉴스 에디터 (v3 에디터 + v4 스타일/레이어/CSV 파이프라인)`.
3. 이후 각 V5 Phase 완료마다 커밋.

**수용 기준**: `git status` 클린(의도된 ignore 제외), 빌드 산출물 미포함.

---

## 3. V5-1 빠른 수정 묶음

### 3.1 문제7: CSV 한글 깨짐 — 원인 확정됨

**근본 원인**: UTF-8 **BOM 없이** 저장된 CSV를 Excel이 CP949로 열어 한글이 깨짐.
- `electron/main.ts` ~1313행: `exportBulkCsvTemplate` 핸들러 (defaultPath `cardnews-bulk-template.csv`) — BOM 없음.
- `electron/main.ts` 1124행: `bulk-report.csv` 작성 — BOM 없음.

**수정**:
```ts
const utf8Bom = "﻿";
await fs.writeFile(filePath, utf8Bom + csvContent, "utf8");
```
- 위 두 곳 모두 적용. **반대로 `importBulkCsvFile`/`parseBulkCsv`는 들어오는 텍스트의 선두 BOM을 strip**해야 한다(자기가 내보낸 파일을 다시 불러올 때): `text.replace(/^﻿/, "")` — `src/domain/csvBulk.ts` 파서 입구에서 처리 + 단위 테스트 추가(BOM 붙은 입력 파싱).

**수용 기준**: 내보낸 템플릿 CSV를 Excel에서 열었을 때 한글 정상(수동 확인 1회) + BOM 라운드트립 테스트 GREEN.

### 3.2 문제2: 폰트 임포트 무반응(의심) — 진단 → 수정

**현황 파이프라인** (동작해야 하는 경로):
- 렌더러: `App.tsx` 438행 `getFontData(fontId)` → `buildPreviewFontFaceCss`(blob URL) → `setFontCss` → `buildCardHtml`에 주입.
- 오프스크린: `main.ts` 989행 `buildRenderFontCss(deck.fontId)` → data URI @font-face.
- 템플릿: `normalizeTypography()` (cardTemplate.ts ~585행) — fontId 있으면 `"Cardnews User Font", "Pretendard", ...`를 **제목/본문/레이어 전부에** 적용.

**의심 원인 (우선순위 순으로 진단)**:
1. **@font-face 매칭 실패로 조용한 Pretendard 폴백**: `buildFontFaceCss(src, {family, format...})`가 만든 face의 `font-weight` 범위가 정적 폰트와 안 맞거나(`45 920` variable 범위를 정적 TTF에 지정하면 브라우저별로 매칭 문제), `format()` 문자열이 확장자와 불일치(`truetype`/`opentype`/`woff2` — `fontCssFormatForExtension` 검증).
2. h1은 `font-weight: 900` 요구 — 사용자가 넣은 Regular(400) 폰트가 faux-bold 합성되어 "별 차이 없어 보임"일 수도. 이는 버그가 아니라 UX 문제 → 폰트 적용 시 weight를 폰트가 가진 값으로 완화하는 옵션 or 안내.
3. 미리보기 blob URL이 srcDoc iframe에서 로드 실패(콘솔 net::ERR 확인).

**진단 절차** (수정 전에 반드시):
```bash
# 1. 손글씨 계열 등 확연히 다른 무료 폰트(TTF)를 UI로 임포트 → 렌더
# 2. 산출 계약 파일 확인: renders/render-*/card-01.html 에 @font-face("Cardnews User Font") 존재?
# 3. 오프스크린 창에서 document.fonts.check('16px "Cardnews User Font"') 결과를 로그로 찍는 임시 코드
# 4. 같은 텍스트를 fontId 없이 렌더한 PNG와 SHA 비교 — 같으면 미적용 확정
```

**수정 방향** (진단 결과에 따라):
- face 선언을 `font-weight: 100 900;` 고정 + `font-style: normal;`로 단순화하고, 정적 폰트에서도 매칭되게 한다. format 문자열: ttf→`truetype`, otf→`opentype`, woff2→`woff2`.
- **document.fonts.ready 이후 사용자 폰트 로드 확인**을 offscreenRenderer 대기 로직에 포함(`document.fonts.check`). 실패 시 렌더 에러로 표면화(조용한 폴백 금지): `render_failed: "사용자 폰트를 로드하지 못했습니다"`.
- UI: 폰트 셀렉트 옆에 해당 폰트로 그린 "가나다 ABC" 미니 샘플(blob face를 UI 문서에도 등록: `document.fonts.add(new FontFace(...))`) — 적용 여부가 눈에 보이게.
- 테스트: cardTemplate에 fontId 주입 시 `font-family` 문자열에 "Cardnews User Font"가 제목/본문/레이어 CSS에 모두 나타나는지 단위 테스트.

**수용 기준**: 확연히 다른 폰트 임포트 → 미리보기와 PNG 모두 육안으로 폰트 변경 확인(증거 스크린샷) + 폰트 로드 실패가 조용히 넘어가지 않음.

### 3.3 문제3: 배경 이미지 기본값 = 없음

**현황**: 신규 실행 시 `backgroundId` 초기값은 null이지만, (a) 배경 "파일 추가" 시 즉시 적용되고, (b) 워크스페이스 복원이 이전 배경을 되살리고, (c) 샘플 초기화 상태에서 newsprint가 사진 없이도 그라디언트를 깔아 "배경이 있는 것처럼" 보임.

**요구 해석**: "처음 시작(그리고 초기화) 상태는 배경 이미지 없음"이 보장되고, 배경은 **사용자가 명시적으로 선택했을 때만** 적용된다.

**수정**:
1. `addBackgroundToLibrary` 후 자동 적용 로직이 남아 있으면 제거 — 라이브러리 등록만 하고, 드롭다운 선택은 사용자가 한다. (등록 직후 편의를 위해 자동 선택을 유지하고 싶다면 "추가 후 적용" 체크박스로 명시화 — 기본 off.)
2. `resetWorkspace()`가 backgroundId를 null로 확실히 되돌리는지 확인(이미 되어 있으면 통과).
3. 기본 스타일을 배경 의존이 없는 것으로 검토: 초기 styleId를 `minimal`(단색)로 바꾸거나, newsprint 유지 시 "사진 없음" 상태의 기본 그라디언트가 자연스러운지 확인만.
4. CSV bulk의 `background` 컬럼 미지정 행도 배경 없음으로 렌더되는지 확인.

**수용 기준**: 새 userData(임시 폴더로 실행)에서 첫 화면 배경 없음 · 초기화 후 배경 없음 · 파일 추가만으로는 적용 안 됨(또는 명시 옵션).

### 3.4 문제1: "디자인 > 스타일 관리" 패널 오버플로

**현상**: 스타일 관리 탭에서 콘텐츠(긴 버튼 행, JSON textarea, 스타일 이름 등)가 패널 박스를 벗어남.

**수정 체크리스트** (`src/ui/styles.css` + 해당 패널 JSX):
- 패널 내 flex row에 `min-width: 0` (flex 자식이 줄어들 수 있게 — 오버플로 단골 원인).
- 버튼 여러 개인 행은 `flex-wrap: wrap` 허용.
- 긴 텍스트(스타일 이름/파일명)는 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- textarea/select `max-width: 100%; box-sizing: border-box`.
- 인스펙터 패널 공통으로 `overflow-x: hidden` 방어.
- 수정 후 창 최소 폭(1080px)과 좁은 인스펙터 상태에서 스모크 스크린샷 육안 확인.

**수용 기준**: 최소 창 크기에서 스타일 관리 탭의 모든 요소가 패널 내부에 머무는 스크린샷.

### 3.5 문제9: @kkongdon_story 크레딧 (은근하지만 눈에 띄게)

**요구**: 프로그램 사용자들에게 제작자 스레드 `https://www.threads.com/@kkongdon_story` 링크가 보이되, 과하지 않게.

**구현**:
1. **상시 크레딧 pill**: 좌측 하단(슬라이드 레일 아래) 또는 인스펙터 최하단에 고정 작은 배지:
   `made by 꽁돈 ↗` — 클릭 시 `shell.openExternal(threads URL)` (IPC `openExternalLink(url)` 신설, **화이트리스트**: threads.com/@kkongdon_story 만 허용).
   스타일: 11px, muted 색, hover 시 accent — "은근히".
2. **정보 모달**: 앱 이름/버전/제작자/스레드 링크/폰트·이미지 라이선스 고지. topbar 브랜드 클릭으로 오픈.
3. usage.html 상단에도 크레딧 + 링크.
4. (선택, 사용자 확인 필요) 내보내는 ZIP에 `README.txt` 한 줄 크레딧 — 카드 PNG 자체에는 넣지 않는다(사용자 콘텐츠 오염 금지).

**수용 기준**: 앱 어느 탭에서든 크레딧이 1곳 이상 보이고 클릭 시 기본 브라우저로 스레드가 열림. 렌더 산출물에는 영향 없음.

---

## 4. V5-2 — 문제6: 세팅/프로젝트 명시적 저장

**현황**: workspace.json 자동 저장(800ms 디바운스)은 이미 있음. 사용자가 원하는 것은 "지금 상태를 파일로 저장해두고 나중에/다른 PC에서 불러오기"로 해석.

**구현: `.cardnews` 프로젝트 파일 (ZIP 컨테이너)**
```
project.cardnews (zip)
├── manifest.json      # version, createdAt, appVersion
├── workspace.json     # 현재 WorkspaceState 전체 (cards/style/ratio/overrides/fontId/backgroundId)
├── presets.json       # (선택 포함) 양식 프리셋
├── styles.json        # 커스텀 스타일
├── backgrounds/       # 워크스페이스가 참조하는 배경 파일만 (id.ext)
└── fonts/             # 참조하는 사용자 폰트만
```
- IPC: `exportProject()` (save dialog, adm-zip으로 조립) / `importProject()` (open dialog → 검증 → userData에 배경/폰트 병합(id 충돌 시 재부여 + workspace 참조 갱신) → workspace 적용).
- UI: 내보내기 탭에 [프로젝트 저장(.cardnews)] [프로젝트 열기] 버튼.
- 검증: 새 userData에서 import 시 카드/스타일/배경/폰트가 완전 복원되는 라운드트립 스모크.
- 테스트: manifest/참조 무결성 검증 함수는 순수 모듈로 분리해 단위 테스트.

**수용 기준**: A PC에서 저장한 .cardnews를 (userData 비운 상태에서) 열면 동일한 미리보기가 재현.

---

## 5. V5-3 — 문제4: 레이어 캔버스 직접 편집 (대형)

**현상 문제**: 레이어(텍스트/도형/선/이미지)를 좌표 숫자 입력으로만 배치 — 실용성 없음. 텍스트박스 기본이 흰 배경이라 못 씀.

**목표 UX (Canva 작업대 최소 구현)**: 중앙 미리보기 위에서 레이어를 **클릭 선택 → 드래그 이동 → 핸들 리사이즈 → 더블클릭 텍스트 편집**. 기본 슬롯(제목/배지 등)은 이번 범위에서 제외 — **레이어만** 대상 (범위 명시적 제한).

### 5.1 아키텍처 — "오버레이 편집 레이어" (결정론 렌더 유지)

핵심: iframe(진실의 원천, buildCardHtml 결과)은 손대지 않고, **iframe 위에 같은 스케일의 투명 오버레이 div**를 얹어 편집 UI만 담당한다. 레이어의 x/y/w/h는 이미 override 데이터로 알고 있으므로 iframe 내부 좌표를 읽을 필요가 없다.

```
<div class="stage-canvas">           // 기존
  <iframe srcDoc={html} />           // 기존 미리보기 (pointer-events: none 으로 전환)
  <div class="edit-overlay">         // 신규: 카드 좌표계 → scale 변환 동기화
    {layers.map(l => <LayerBox />)}  // absolute: l.x*scale, l.y*scale, ...
    <SelectionHandles />             // 선택 레이어의 8방향 핸들
  </div>
</div>
```

- 좌표계: 레이어 좌표는 **카드 픽셀 기준(1080×1350 등)** 저장(현행 유지). 오버레이는 `scale = stageWidth / cardWidth`로 화면 좌표 변환. 드래그 델타는 `/scale`로 역변환.
- 드래그 중에는 오버레이 박스만 movement (60fps), **드롭 시점에 override 커밋** → 디바운스된 미리보기 재렌더(기존 250ms 파이프라인). 드래그 중 iframe 재렌더 금지(성능).
- 스냅: 카드 중앙/세이프존(72px) 가이드라인 표시 + 8px 그리드 스냅(shift로 해제).
- 키보드: 방향키 1px(shift 10px) 이동, Delete 삭제, Esc 선택해제.
- 더블클릭 텍스트 레이어 → 오버레이 위 같은 위치에 textarea(같은 폰트/크기 스타일) 인라인 편집 → blur 시 커밋.
- 선택 시 우측 인스펙터 "디자인 탭"이 해당 레이어 속성 폼으로 전환(색/폰트크기/정렬/불투명도/z순서 up/down). 좌표 숫자 입력은 고급용으로 유지하되 접어둠.

### 5.2 텍스트박스 기본값 수정 (즉효 부분 — V5-1에 넣어도 됨)

- 신규 텍스트 레이어 기본: `background: transparent`, `color: 현재 스타일 preset.ink`, 크기 40px, 카드 중앙 배치, placeholder "텍스트 입력".
- 도형 기본: `accent` 색 20% 불투명 채움 + 실선 테두리 없음.
- 게이트: 레이어 텍스트도 data-slot 메트릭에 이미 포함(layer-* slot) — 투명 배경일 때 backdrop은 카드 textBackdrop 사용(현행 확인).

### 5.3 구현 단계 (Codex용 순서)

1. **S1**: 텍스트/도형 레이어 기본값 수정 + 단위 테스트 (cardTemplate layer 렌더 기본값).
2. **S2**: `EditOverlay` 컴포넌트 — 선택/이동만 (핸들 없이). override 커밋 파이프라인 연결. iframe `pointer-events:none`은 **편집 모드 토글**(툴바 "편집 모드" 버튼) 시에만 — 평소에는 현행 유지.
3. **S3**: 리사이즈 핸들 8방향 + 스냅 가이드.
4. **S4**: 더블클릭 인라인 텍스트 편집 + 키보드 단축키.
5. **S5**: 인스펙터 선택-레이어 속성 패널 연동 + z순서.
6. 각 단계마다: typecheck/test + dev 스모크(편집 모드에서 드래그 후 PNG 렌더가 새 좌표 반영하는지 — render-deck 스모크에 레이어 포함 카드 추가).

**수용 기준**: 마우스만으로 텍스트 레이어를 만들고 배치·수정·삭제할 수 있으며, PNG 결과가 미리보기 배치와 일치. 게이트 통과.

---

## 6. 문제8 — 기타 시급/보완 (백로그, 발견 시 처리)

- [ ] advisory 게이트 경고 해소: 본문 카드 폰트 크기 5종 → ≤4로 통합(cardTemplate 스케일 정리), white/minimal 대비 경계 보정.
- [ ] 250 LOC 초과 파일 분할: `.omo/evidence/v4-upgrade/final/programming-size-exceptions.md`의 계획 실행 (deckStore → backgroundStore/presetStore/fontStore/workspaceStore 분리 등).
- [ ] fonts/OFL.txt 라이선스 전문 추가.
- [ ] EXE 코드사이닝 — 공개 배포 시점에 결정.
- [ ] Unsplash 공급자 추가 여부 — 제품 판단 대기.
- [ ] 완료 후 버전 올리기: 사용자와 파일명 변경 합의되면 1.1.0 권장(레이어 편집 포함 시).

---

## 7. 인수인계 노트

- 계획 원본: `.omc/plans/v4-upgrade-plan.md` / 직전 핸드오프 2건: `.omc/handoffs/v4-upgrade-handoff-20260707.md`, `.omc/handoffs/v4-test-feedback-repair-handoff-20260707.md`
- 진행 기록 SSOT: `HANDOFF.md` (Phase 완료마다 갱신할 것)
- 스모크 액션: `parse-preview | render-deck | render-with-background | render-bulk-sample | render-export` (`CARDNEWS_SMOKE_ACTION`)
- 데이터 위치: `%APPDATA%/gpt-cardnews-auto/gpt-cardnews-auto/` (dev) · `%APPDATA%/Cardnews Studio/...` (설치판)
- 마지막 확인 상태(2026-07-07): typecheck 0 · 56/56 tests · 매트릭스 hardGate 전부 pass · release 1.0.0 존재
