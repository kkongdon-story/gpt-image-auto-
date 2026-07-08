# PRD: Cardnews Studio v6 — Lite/Pro 에디션 분리 + 편집 완성 + 프로그램 내 AI

작성: 2026-07-08 (Claude Fable, 사용자 확정 답변 반영)
실행 주체: Codex 또는 후속 Claude 세션 — **이 문서만으로 대화 맥락 없이 실행 가능해야 한다**
프로젝트 루트: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`
선행 문서: `.omc/plans/v5-completion-prd.md`(불변 원칙·함정 승계), `HANDOFF.md`(진행 SSOT)
기준 커밋: `887b331` (typecheck 0 · vitest 68/68 · dev+패키징 스모크 green)

---

## 0. 하네스 규칙 (실행 에이전트가 반드시 따를 것)

### 0.1 불변 원칙 (위반 = 즉시 중단하고 재설계)

1. **단일 렌더 계약**: 미리보기와 PNG는 같은 `buildCardHtml()` HTML에서 나온다. 미리보기 전용 렌더 경로 금지.
2. **결정론**: 같은 입력 = 같은 픽셀. 랜덤/시간 의존 스타일 금지.
3. **게이트 우회 금지**: hard-fail 게이트(contrast/overflow/font_floor/visual_artifact)는 완화하지 않는다.
4. **styleSafety 완화 금지**: `src/render-engine/styleSafety.ts`의 allowlist는 확장만 허용(문법 단위 명시 추가), raw string 허용 회귀 금지.
5. **순수 모듈 TDD**: 파서/변환/검증 로직은 vitest RED→GREEN 후 통합.
6. **하위호환**: 신규 저장 필드는 전부 optional + 관대한 타입 가드. v5 workspace/preset/deck/.cardnews가 v6에서 그대로 열려야 한다.
7. **멘션 계약**: footerAccount는 모든 경계에서 `kkongdon_story` 형태(@ 없이)로 정규화 유지.

### 0.2 검증 표준 명령 (각 마일스톤 완료 시 전부 실행)

```powershell
npm run typecheck; npm test; npm run build
node node_modules/electron/cli.js scripts/style-matrix-smoke.mjs
$env:CARDNEWS_SMOKE_ACTION='layer-controls-regression'; node node_modules/electron/cli.js .
# v6 신규 스모크(각 마일스톤에서 추가): chrome-style-regression, line-endpoint-regression, edition-lite-regression
```

### 0.3 알려진 함정 (이번 프로젝트에서 실제로 밟은 것 — 재발 금지)

- **OneDrive EPERM/EBUSY**: `dist:win`이 `win-unpacked.tmp` rename에서 실패하면 → `npx electron-builder --win nsis -c.directories.output="$env:LOCALAPPDATA/cardnews-release"`로 우회, 설치 exe만 `release/`로 복사. 실행 중인 `Cardnews Studio.exe`도 잠금 원인(taskkill 후 재시도).
- 미리보기 iframe에 `sandbox="allow-same-origin"`은 유지하되 `allow-scripts` 금지. sandbox 자체를 제거하지 말 것.
- Electron 스크립트에서 오프스크린 창 닫힘 → 앱 종료: `app.on("window-all-closed", () => {})` 필수.
- `transform: scale()`은 숫자만. 스케일은 ResizeObserver로 계산.
- exactOptionalPropertyTypes: optional 필드는 조건부 스프레드(`...(x ? {x} : {})`)로만.
- 한글+백틱 포함 패치 스크립트는 bash 히어독 금지 — 파일로 저장 후 실행.
- `npm run X | tail`은 실패를 exit 0으로 가린다 — 빌드류는 로그 파일로 리다이렉트 후 exit code 별도 확인.
- 커밋: 마일스톤마다. 빌드 산출물/`.omo/`는 커밋 금지(.gitignore 준수).

### 0.4 진행 규칙

- 마일스톤 순서 준수(§9). 순서를 바꾸면 에디션 게이팅(M3) 이전에 만든 기능의 배치가 꼬인다.
- 각 요구사항의 "수용 기준"을 스모크 액션으로 자동화한 뒤 완료 선언.
- 막히면 이 문서의 해당 섹션에 "구현 노트"를 추가 기록하고 HANDOFF.md 갱신.

---

## 1. Lite/Pro 기능 매트릭스 (사용자 확정 — 변경 금지, 애매하면 사용자에게 질문)

| 기능 | Lite | Pro |
|------|:----:|:----:|
| 내장 스타일 프리셋 11종 + 비율 4종 + 포인트색/어둡기 | ✅ | ✅ |
| 카드 편집(라벨 문법·구조화 폼 §5)·추가/삭제·미리보기·PNG/ZIP 내보내기 | ✅ | ✅ |
| 배경 이미지 (라이브러리 + Pixabay 검색) | ✅ | ✅ |
| 양식.md 내보내기/불러오기 | ✅ | ✅ |
| 폰트 임포트 | ✅ | ✅ |
| 커스텀 스타일 임포트 (design.md/JSON) | ✅ | ✅ |
| 양식 프리셋(이름 저장) + 워크스페이스 자동저장 | ✅ | ✅ |
| 헤더/멘션/페이지번호 **내용(텍스트)** 변경 | ✅ | ✅ |
| 헤더/멘션/페이지번호 **스타일**(색·위치·글꼴·번호형식·표시여부) §2 | ❌ | ✅ |
| 콘텐츠 디자인 전체: 레이어(텍스트/도형/선/이미지)·카드별 오버라이드(색감/레이아웃)·편집 오버레이 | ❌ | ✅ |
| 배지 모양/이미지 배지 + 배경 자동 제거 §4 | ❌ | ✅ |
| 넘김기호(>>>>) 이미지 교체 §6 | ❌ | ✅ |
| CSV 벌크 생성 | ❌ | ✅ |
| .cardnews 프로젝트 파일 저장/열기 | ❌ | ✅ |
| 프로그램 내 AI (CLI 챗봇 + 대본→자동적용 + 이미지 생성) §8 | ❌ | ✅ |
| 크레딧(@kkongdon_story 링크) | ✅(제거불가) | ✅ |

Lite 목표: "최소한의 카드뉴스를 퀄리티 있게" — 스타일·배경·양식 중심. 위 표에 없는 신규 기능이 생기면 **기본 Pro**로 두고 사용자에게 질문.

---

## 2. R1 — 크롬(헤더/멘션/페이지번호) 편집 시스템

**현상**: 헤더/멘션은 텍스트만 바꿀 수 있고, 페이지번호는 아예 못 바꿈. 색·위치·글꼴 변경 불가.

### 2.1 데이터 모델 (`src/domain/types.ts`)

```ts
export type ChromeSlotStyle = {
  readonly color?: string;        // #rrggbb — styleSafety 색상 규칙 재사용
  readonly fontSize?: number;     // 18~48 (게이트 font_floor=18 준수)
  readonly fontWeight?: number;   // 100~950
  readonly useDeckFont?: boolean; // true면 deck.fontId 폰트 적용
  readonly offsetX?: number;      // -40~40 px (세이프존 72px 침범 방지 상한)
  readonly offsetY?: number;      // -40~40 px
};

export type ChromeConfig = {
  readonly header?: ChromeSlotStyle & { readonly visible?: boolean };
  readonly footer?: ChromeSlotStyle & { readonly visible?: boolean };
  readonly pageNumber?: ChromeSlotStyle & {
    readonly visible?: boolean;
    readonly template?: string;   // 기본 "{n} / {total}". 허용 토큰: {n} {total} {n2}(2자리 패딩)
  };
};
// Deck / DeckDraft / WorkspaceState / DeckPreset 에 chrome?: ChromeConfig 추가
```

### 2.2 구현 로직

1. **검증** (`src/domain/chromeConfig.ts` 신규, 순수 + 테스트):
   - `normalizeChromeConfig(input: unknown): ChromeConfig | undefined` — 범위 클램프(offset ±40, fontSize 18~48), color는 hex 검증, template은 허용 토큰 외 문자 이스케이프 대상이므로 **텍스트로만 취급**(HTML 이스케이프는 템플릿에서).
   - `renderPageNumber(template, n, total): string` — 토큰 치환. 잘못된 토큰은 문자 그대로.
2. **템플릿** (`cardTemplate.ts`):
   - `.chrome-label`/`.page-no`/footer 슬롯에 chrome 값 반영: `color`, `font-size`, `font-weight`, `transform: translate(offsetX, offsetY)`, `visible:false`면 요소 자체 미출력(메트릭 슬롯도 함께 사라져 게이트 일관).
   - 페이지번호 텍스트 = `renderPageNumber(...)` 결과를 escapeHtml.
   - data-slot 메트릭 유지 → 세이프존/대비 게이트가 offset·색 변경을 자동 검증(offset 상한 ±40이므로 72px 세이프존 이내지만, 사용자가 fontSize를 키우면 게이트가 잡음 — 정상 동작).
3. **UI** (Pro 전용 섹션): 인스펙터 디자인 탭에 "상단/하단 바" 패널 — 슬롯 3개(헤더/멘션/페이지번호) 각각: 표시 토글, 색 스와치+피커, 크기/굵기 슬라이더, X/Y 오프셋 슬라이더, 페이지번호는 형식 셀렉트(`{n} / {total}`, `{n2}`, `{n}`, 직접입력). "덱 폰트 적용" 체크.
   - **Lite**: 이 패널 자체가 번들에 없음(§7). 내용 변경(헤더/멘션 input)은 기존 topbar 그대로.
4. **영속화**: workspace/preset/deck 저장·로드에 chrome 필드 왕복. isDeckDraft/isWorkspaceState 가드에 optional 검증 추가.

### 2.3 수용 기준

- 페이지번호를 `{n2}` 형식+흰색+아래로 10px 이동시킨 렌더 PNG가 미리보기와 일치.
- `visible:false`인 슬롯은 PNG에 없고 게이트 이슈 0.
- 신규 스모크 `chrome-style-regression`: chrome 설정 적용 → srcDoc에서 color/transform/텍스트 검증 + 렌더 게이트 pass.
- v5 workspace(chrome 없음) 로드 정상.

---

## 3. R2 — 선 레이어 끝점(2점) 편집

**현상**: 선이 rect+rotation 모델이라 선택 영역이 bounding box 전체로 잡혀 과도하게 넓음. 일반 도구처럼 **끝점 2개 드래그로 위치·길이·기울기**를 조정해야 함.

### 3.1 데이터 모델 변경

```ts
// CardLayer의 line kind를 끝점 모델로 전환
{ kind: "line"; id; x1: number; y1: number; x2: number; y2: number; // 카드 % 좌표
  thickness: number; color: string; opacity; zIndex }
```

**마이그레이션(필수, 순수 함수 + 테스트)**: `migrateLineLayer(old)` — 구모델 `{x,y,width,height,rotation}` → 중심 `C=(x+w/2, y+h/2)`, 길이 `L=width`(% 단위, 카드 px로 환산해 회전 적용 후 재환산), 각도 θ=rotation:
`x1 = Cx − (L/2)·cosθ`, `y1 = Cy − (L/2)·sinθ·(cardW/cardH 보정)`, x2/y2는 +. 주의: %는 축마다 스케일이 달라 **px로 변환 → 회전 → %로 역변환**해야 정확하다. 로드 경계(deckStore parse, workspace 로드)에서 1회 변환, 저장은 신모델로만.

### 3.2 렌더 (`cardTemplate.ts`)

끝점 → px 변환 후: `length = hypot(dx,dy)`, `angle = atan2(dy,dx)`. 기존 div 렌더 유지:
`left/top = (x1,y1)px; width = length px; height = thickness px; transform: rotate(angle) ; transform-origin: 0 50%`. 메트릭 슬롯 bbox는 끝점 AABB로 계산(대비 게이트용 백드롭 동일).

### 3.3 편집 오버레이 (`App.tsx` StageCanvas)

- 선 레이어 선택 UI: **8방향 핸들 제거** → 끝점 핸들 2개(원형 12px)만.
- 히트테스트: 클릭점→선분 거리 ≤ `max(thickness/2 + 6px, 10px)` 일 때만 선택(점-선분 거리 공식 사용). bounding box 히트 금지.
- 드래그: 끝점 핸들 = 해당 끝점만 이동(각도·길이 자동 변화). 선 몸통 드래그 = 두 끝점 평행 이동. Shift+끝점 = 15° 스냅.
- 인스펙터 컨트롤: 기존 "각도" 입력 유지(두 끝점을 중심 기준 회전으로 환산), 두께/색 유지. x1y1/x2y2 숫자 입력은 고급 접기.
- 기존 스모크 `layer-controls-regression`의 line 항목을 신모델 기대값으로 갱신 + `line-endpoint-regression` 추가(끝점 드래그 시뮬레이션 → x2/y2 변경 확인, 몸통 밖 클릭 시 비선택 확인).

### 3.4 수용 기준

- 선 근처(≤10px)에서만 선택되고, 끝점 드래그로 기울기 조정, PNG 결과 일치.
- 구버전 workspace의 선이 시각적으로 동일 위치·각도로 열림(마이그레이션 테스트: 회전 0°/90°/45° 케이스).

---

## 4. R3 — 배지 확장: 모양 선택 + 이미지 배지 + 배경 자동 제거 (Pro)

### 4.1 배지 모양

```ts
// CardOverride에 추가
badge?: {
  readonly shape?: "pill" | "rect" | "none";  // 기본: 스타일 프리셋 badgeRadius 따름
  readonly imageId?: string;                  // 이미지 라이브러리 참조 — 지정 시 텍스트 배지 대신 이미지
  readonly imageHeight?: number;              // 40~200px, 기본 96
};
```

- `shape:"rect"` → border-radius 8px, `"pill"` → 999px, `"none"` → 배경/패딩 제거(텍스트만).
- 라벨 문법 `배지:`가 비어 있고 imageId만 있으면 이미지 배지만 출력. 텍스트+이미지 동시엔 이미지 우선.
- 렌더: `<img class="badge-image" src="file://...">` (오프스크린) / data URL(미리보기 — 배경 미리보기와 동일한 IPC 캐시 패턴 재사용). 높이 고정·폭 자동, 상단 배지 위치에 배치. 메트릭 슬롯 `badge-image`(safezone 게이트 적용, 대비 게이트는 이미지라 제외 — slot 이름 prefix로 대비 검사 스킵 목록에 추가).

### 4.2 이미지 라이브러리 일반화

- 현 배경 라이브러리(`library/backgrounds`)와 별도로 `library/images/` + `images.json` 신설(배지·넘김기호·레이어 이미지 공용). 배경과 같은 구조(id/displayName/extension), 같은 검증(25MB/포맷). deckStore의 배경 함수를 제네릭화(`imageLibrary.ts`로 분리 권장 — 250LOC 분할 계획과 일치).

### 4.3 배경 자동 제거 ("누끼") — 구현 로직

GPT 생성 캘리그라피처럼 **단색 배경** 이미지 전제. 1차 구현은 의존성 없는 색상 기반:

```
입력: 이미지 파일 → main 프로세스 nativeImage → 비트맵(BGRA)
1. 배경색 추정: 네 모서리 5×5 픽셀 평균 → 최빈 색 C_bg
2. 플러드필: 네 모서리에서 BFS로 |px − C_bg| ≤ tolerance(기본 28, 유클리드 RGB 거리)인
   연결 영역을 배경으로 마킹 (내부 폐색 영역은 보존 — 글자 안 구멍은 별도 옵션)
3. 마킹 픽셀 alpha=0, 경계 1px는 alpha = 거리 비례(간이 안티앨리어스)
4. PNG로 저장 → 이미지 라이브러리 등록
```

- 파일: `src/render-engine/backgroundRemoval.ts` — **순수 함수** `removeBackground(bitmap: Uint8Array, width, height, tolerance): Uint8Array` + vitest(합성 비트맵으로 모서리/내부 보존 검증). main IPC `cardnews:removeImageBackground(sourceId, tolerance)`.
- UI: 이미지 선택 시 "배경 제거" 버튼 + 허용치 슬라이더 + 전/후 미리보기(체커보드 배경) → [적용]이 새 라이브러리 항목 생성(원본 보존).
- 2차(백로그): onnxruntime+u2net 모델 — 이번 범위 아님, 인터페이스만 tolerance 외 `mode:"color"|"model"` 확장 여지.

### 4.4 수용 기준

- 흰 배경 캘리그라피 PNG → 제거 후 배지로 삽입 → 사진 배경 카드에서 배경 없이 합성된 PNG.
- shape 3종 렌더 스냅샷 테스트(HTML 문자열 단위). 게이트 pass.

---

## 5. R4 — 콘텐츠 직관 편집 (Lite 포함)

**현상**: 우측 textarea 원문 편집뿐 — 줄바꿈 어색, 자간 조절 불가, 직관성 부족.

### 5.1 구조화 폼을 1차 편집 UI로 승격

- 카드 [내용] 탭을 **필드형 폼**으로 교체: 유형 셀렉트 / 배지 / 제목(멀티라인) / 소제목 / 본문(문단+불릿 리스트 에디터: 행 추가·삭제·불릿 토글) / 출처 / 강조. 원문 textarea는 "원문 편집(고급)" 토글로 이동 — **양방향 동기화**: 폼→원문은 라벨 문법 직렬화(`serializeCard(card): string` 순수 함수+테스트), 원문→폼은 기존 parseCardText. SSOT는 원문 문자열(cards state) 유지 — 폼은 파생 뷰.
- **명시적 줄바꿈**: 제목/소제목 필드 안 Enter = 렌더 줄바꿈. 문법: 라벨 값 안 `\n`은 직렬화 시 `|` 로 기록(`제목: 첫 줄|둘째 줄`), 파서에 `|`→줄바꿈 지원 추가(이스케이프 `\|` 허용). 템플릿은 `<br/>` 변환(escape 후). deckImporter/CSV도 동일 규칙 — 테스트 추가.

### 5.2 타이포 미세 조정 (CardOverride.typography 확장)

```ts
typography?: {
  // 기존: sizeScale, weight, italic (+deck fontId)
  readonly letterSpacing?: number;  // -0.05 ~ 0.1 em
  readonly lineHeight?: number;     // 1.1 ~ 2.0
  readonly scope?: "all" | "title" | "body"; // 기본 all — title/body 분리 적용
};
```
템플릿에서 CSS 변수 주입(`--ls-title` 등). **Lite/Pro 경계**: 폼 편집+`|` 줄바꿈은 Lite, typography 슬라이더는 콘텐츠 디자인이므로 **Pro**.

### 5.3 수용 기준

- 폼에서 제목 두 줄 입력 → 원문에 `|` 직렬화 → 미리보기/PNG 두 줄 렌더. 원문 직접 수정 시 폼 반영.
- serializeCard(parseCardText(x)) 라운드트립 테스트(전 라벨 필드).
- 자간/행간 슬라이더가 게이트(오버플로) 통과 범위에서 동작.

---

## 6. R5 — 넘김기호(>>>>) 커스텀 이미지 (Pro)

```ts
// Deck 레벨 (+ preset/workspace)
nextHint?: { readonly kind: "arrows" | "image" | "none"; readonly imageId?: string; readonly height?: number /*24~72*/ };
```
- 렌더: kind=image → footer 우측에 `<img>`(높이 기본 40px), none → 미출력. 마지막 카드 ■ 규칙 유지(이미지 지정 시에도 마지막 카드는 미표시… 아니, 마지막 카드도 이미지 유지가 자연스러움 — **마지막 카드는 kind와 무관하게 표시 안 함**으로 통일. 기존 ■도 제거).
- UI: 디자인 탭 "넘김 기호" 셀렉트(기본 화살표/이미지 선택/없음) — 이미지 라이브러리(§4.2)에서 선택.
- 수용: 이미지 넘김기호가 전 카드(마지막 제외) PNG에 반영, 게이트 pass.

---

## 7. R6 — Lite/Pro 에디션 시스템 (최중요)

### 7.1 요구 해석

- Lite = 스레드 무료 배포용, Pro = 강의 수강생용.
- "비활성화로 처리 + 클로드 코드로도 활성화 불가" → **Lite 바이너리에 Pro 코드가 물리적으로 부재해야 한다**(로컬 앱은 코드가 있으면 어떤 방식이든 우회 가능). UI에는 잠금 표시(업셀)만 남기고 기능 코드는 빌드에서 제외.

### 7.2 아키텍처 — 빌드 타임 스트리핑

```
src/edition/
├── edition.ts            # export type Edition = "lite" | "pro"
├── pro/index.ts          # Pro 전용 모듈 배럴: AI, CSV벌크, 레이어편집, 오버라이드 패널,
│                         #   크롬 스타일, 배지확장, 넘김기호, 프로젝트파일, 배경제거
└── lite/index.ts         # 같은 인터페이스의 스텁: 잠금 패널 컴포넌트(NULL 기능) + IPC 미등록
```

1. **Renderer**: Vite alias로 분기 — `vite.config.ts`에서 `resolve.alias['@edition'] = VITE_EDITION==='lite' ? '/src/edition/lite' : '/src/edition/pro'`. `App.tsx`는 `import { ProPanels, proFeatures } from "@edition"`만 사용 → Lite 번들에는 pro/ 하위 코드가 **정적으로 미포함**(tree-shake가 아니라 alias라 확실). **조건부 dynamic import 금지**(번들에 남음).
2. **Main**: entry 분리 — `electron/main.ts`(공용 코어) + `electron/proHandlers.ts`(Pro IPC 전부: renderBulkCsv, AI, exportProject, removeImageBackground, chrome 스타일 저장 허용 등). 빌드 스크립트가 에디션별 tsconfig/entry로 컴파일: `main.pro.ts`는 `registerProHandlers(ipcMain)` import, `main.lite.ts`는 import 자체가 없음. tsc는 진입점 기준 참조 파일만 방출하지 않으므로 **에디션별 out 디렉토리 + 빌드 후 lite out에서 proHandlers 파일 삭제 검증** 또는 esbuild로 main 번들링 전환(권장: esbuild 단일 파일 번들 — define으로 EDITION 주입, 미참조 코드 제거 확실).
3. **Lite의 저장 데이터 처리**: Pro 필드(overrides/layers/chrome 스타일/nextHint)가 든 workspace를 Lite로 열면 — 렌더는 무시(cardTemplate 공용이므로 **렌더 코어는 Pro 필드를 렌더할 수 있음** ← 주의: 렌더 코어에 Pro 렌더가 남으면 "코드 부재" 원칙과 충돌).
   **결정**: cardTemplate도 에디션 분기 — `cardTemplate.core.ts`(공용) + `cardTemplate.pro.ts`(레이어/오버라이드/크롬스타일/배지이미지/넘김이미지 렌더 확장 함수). lite 빌드는 확장 함수가 no-op 스텁. Lite에서 Pro 필드는 로드 시 **드롭**(가드에서 strip) — "Pro에서 만든 파일을 Lite로 열면 Pro 요소는 표시되지 않습니다" 안내 1회.
4. **electron-builder 이중 타깃** (package.json build를 base로 `electron-builder --config` 오버라이드 파일 2개):
   - Pro: appId `story.kkongdon.cardnews`, productName `Cardnews Studio Pro`, artifact `Cardnews-Studio-Pro-Setup-${version}.exe`
   - Lite: appId `story.kkongdon.cardnews.lite`, productName `Cardnews Studio Lite`, artifact `Cardnews-Studio-Lite-Setup-${version}.exe`, 아이콘 변형(색 반전 등) — userData 폴더도 자동 분리됨(productName 기준).
   - scripts: `build:lite`, `build:pro`, `dist:win:lite`, `dist:win:pro` (§0.3 OneDrive 우회 포함한 `scripts/dist.mjs` 래퍼 권장).
5. **스트리핑 검증 게이트(필수 자동화)**: `scripts/verify-edition.mjs` — lite 산출물(asar 추출)에서 금칙 심볼 스캔: `renderBulkCsv`, `registerProHandlers`, `removeImageBackground`, `exportProject`, `aiChat`, `ProPanels` 등. 발견 시 exit 1. dist:win:lite 파이프라인에 포함.
6. **Lite UI 잠금 표시**: lite/index.ts의 스텁 패널 = 자물쇠 아이콘 + "Pro에서 사용 가능 — 강의 안내" + threads/카카오 링크 버튼(기존 openExternal 화이트리스트 재사용).

### 7.3 수용 기준

- Lite exe: Pro 메뉴가 잠금 표시로 보이고 어떤 입력으로도 동작 코드 없음. `verify-edition.mjs` pass. 기본 카드뉴스 제작(스타일/배경/양식/폰트/내보내기) 정상.
- Pro exe: 전 기능 정상(기존 회귀 스모크 전부).
- 신규 스모크 `edition-lite-regression`: lite 빌드에서 Pro IPC invoke 시 "미지원" 오류 반환 확인 + UI 잠금 존재 확인.
- 두 설치파일이 한 PC에 공존 설치 가능(appId/userData 분리).

---

## 8. R7 — 프로그램 내 AI (Pro 전용)

### 8.1 아키텍처

```
electron/ai/
├── cliAdapters.ts   # 프로바이더 어댑터: detect() / run(prompt, opts) / installHint
├── aiHandlers.ts    # IPC: ai:listProviders, ai:chat, ai:generateImage (proHandlers에서 등록)
src/edition/pro/ai/
├── AiPanel.tsx      # 채팅 사이드시트 UI
├── aiPrompts.ts     # 작업 프리셋 프롬프트(순수, 테스트)
```

**CLI 어댑터** (main 프로세스, 검증된 KOS 패턴 재사용 — `spawnSync`/`spawn` + `shell:true` + **stdin으로 프롬프트 전달**(cmd 8191자 제한/인젝션 회피), timeout 120s, maxBuffer 10MB):

| provider | 감지 | 실행 | 비고 |
|----------|------|------|------|
| claude | `claude --version` | `claude -p` (stdin) | 웹검색 가능 |
| codex | `codex --version` | `codex exec` (stdin) | |
| gemini | `gemini --version` | `gemini -p` (stdin) 또는 `gemini prompt` — 구현 시 `--help`로 확인 | |

- 인자에 사용자 문자열 삽입 금지 — **프롬프트는 무조건 stdin**. 고정 플래그만 인자로.
- `ai:chat(providerId, messages)` → 어댑터가 대화 이력을 단일 프롬프트로 직렬화(시스템+최근 N턴) 실행 → 텍스트 반환. 스트리밍은 1차 범위 밖(응답 대기 스피너).

### 8.2 작업 프리셋 4종 (채팅 상단 버튼)

1. **주제 탐색**: 시스템 프롬프트에 브랜드 커널(꽁돈: AI를 일과 삶에 적용하는 관점, 초보자 눈높이) 포함 → 주제 10개 제안.
2. **자료 검색**: 주제를 받아 근거/사례 조사(웹검색 가능 CLI 우선 안내).
3. **대본 작성**: **시스템 프롬프트에 `buildTemplateDocument()` 양식 계약 전문 포함** → "양식.md 형식으로만 출력" 강제 → 응답에서 양식 블록 추출(기존 `stripCodeFence` 패턴) → `parseDeckDocument` 검증 → 성공 시 **[카드에 적용]** 버튼 활성화(기존 importFromFile 적용 경로 재사용). 검증 실패 시 오류를 AI에 재전달하는 [다시 요청] 버튼(1회 자동 재시도).
4. **이미지 생성**: 어댑터 인터페이스 `generateImage(prompt, outPath)` — 1차 구현: codex CLI 이미지 기능이 로컬에서 확인되면 연결, 아니면 **프롬프트 클립보드 복사 + 안내 폴백**("웹에서 생성 후 [파일 추가]"). 생성물은 이미지 라이브러리 등록 → 배지/배경/레이어에 사용.

### 8.3 설정 창 (톱니 아이콘 — topbar 우측)

- 모달 탭: [AI] CLI 3종 상태(감지됨 버전/미설치), 새로고침, 설치 안내(명령어 복사: `npm install -g @anthropic-ai/claude-code` 등 — 구현 시 최신 명령 확인), 기본 프로바이더 선택, 로그인 필요 안내(각 CLI는 자체 로그인 사용 — 키 저장 안 함). [일반] Pixabay 키 등 기존 설정 이관.
- 상태/기본 프로바이더는 settings.json(AppSettings 확장).

### 8.4 보안 규칙 (완화 금지)

- AI 출력은 **절대 코드/명령으로 실행하지 않는다**. 카드 적용은 parseDeckDocument, 스타일은 parseStyleJson+styleSafety 게이트 경유만.
- CLI 실행: providerId는 allowlist 3종만, 실행 파일명 하드코딩, cwd는 앱 데이터 폴더, env 상속 최소화.
- 응답 내 링크는 자동 열지 않음(텍스트 표시만).

### 8.5 수용 기준

- claude CLI 설치 환경: 채팅 왕복 + "대본 작성" → 양식 파싱 → 10장 자동 적용 → 렌더 게이트 pass (E2E 스모크 `ai-draft-regression`, CLI 부재 시 skip 처리).
- CLI 미설치 환경: 설정 창에 미설치+안내 표시, 채팅 진입 시 유도. 크래시 없음.

---

## 9. R8 — 보안 점검 (마지막 마일스톤)

체크리스트(각 항목 증거 파일 `.omc/evidence/v6/security/`):
1. IPC 전수 감사: 모든 `ipcMain.handle` 입력의 타입/범위/allowlist 검증 존재 확인(신규: chrome/badge/nextHint/ai/removeBackground/edition).
2. styleSafety 회귀 테스트 + 신규 문자열 필드(pageNumber template, 이미지 id 등) 이스케이프 확인 — template은 escapeHtml 경유 증명 테스트.
3. 경로 안전: 라이브러리 id → 경로 해석에 `path.basename`/id 형식 검증(traversal 불가), 저장 대화상자 외 임의 경로 쓰기 없음.
4. `shell.openExternal` 화이트리스트 유지(threads/카카오/설치 안내 URL 추가 시 목록에 명시).
5. AI: §8.4 준수 코드 리뷰 + 프롬프트 인젝션 시나리오 테스트(악성 양식 출력 → styleSafety/parser가 차단).
6. Lite 스트리핑: `verify-edition.mjs` + asar 수동 grep 1회.
7. `npm audit` 실행, high 이상 대응. Electron 보안 체크리스트(contextIsolation/sandbox/preload 최소권한) 재확인.
8. 최종: 두 에디션 dist + 설치/실행 QA + 커밋 + HANDOFF.md 갱신.

---

## 10. 마일스톤 및 실행 순서

| M | 내용 | 완료 게이트 |
|---|------|------------|
| M1 | R2 선 끝점(§3) → R1 크롬 편집(§2) | 표준 명령 + line-endpoint/chrome-style 스모크, 마이그레이션 테스트, 커밋 |
| M2 | R4 콘텐츠 폼+줄바꿈(§5) → R3 배지/배경제거(§4) → R5 넘김기호(§6) | 라운드트립·배경제거 단위테스트, 게이트 pass, 커밋 |
| M3 | R6 에디션 시스템(§7) — 구조 도입, 기존 Pro 기능 이동, 이중 빌드 | verify-edition + edition-lite-regression + 두 exe 스모크, 커밋 |
| M4 | R7 AI(§8) — proHandlers에 추가 | ai-draft-regression(조건부), 설정 창 QA, 커밋 |
| M5 | R9 보안(§9) + 버전 2.0.0 + 두 설치파일 + HANDOFF 갱신 | 체크리스트 전 항목 증거, 최종 커밋 |

**순서 근거**: M1·M2는 기존 구조 위 기능 작업(에디션 분리 전에 완성해야 이동이 한 번에 끝남) → M3가 전체를 Pro 모듈로 재배치 → M4는 M3의 pro/ 구조 위에만 추가 → M5 마감.

각 마일스톤 착수 시 TaskCreate로 세분화하고, 완료 시 HANDOFF.md에 결과·증거·다음 단계를 기록할 것.
