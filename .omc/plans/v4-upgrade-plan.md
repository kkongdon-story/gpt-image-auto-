# Cardnews Studio v4 업그레이드 계획 (2026-07-07)

> **사용자 결정(확정)**: 이미지 검색 = Pixabay API 우선(키 미입력 시 브라우저 폴백, Unsplash는 추후 확장) · 진행 범위 = 전체 A→F 순차, Phase마다 검증.

사용자 요구 5건을 6개 Phase로 구체화. deck-factory(토큰 계약·폰트 임베드·게이트 설계)와
cardprinter(계약 파일·결정론 렌더) 벤치마킹 반영.

---

## 요구사항 → Phase 매핑

| # | 요구 | Phase |
|---|------|-------|
| 1 | 외부 AI로 스타일 코드 생성 → 프로그램에 추가 (design.md 루트) | B |
| 2a | 카드별/전체 배경 이미지 선택 | A+C |
| 2b | Unsplash/Pixabay 무료 이미지 다운로드 | D |
| 2c | 카드별 배지/제목/소제목 간격·위치 조절 | C |
| 2d | 조도/명도/채도 색감 조절 (Canva풍) | C |
| 2e | 카드 비율 1:1 / 16:9 / 4:3 / 4:5 | A |
| 3 | 좌측 미리보기 레일 크기 조절(드래그) + 리액티브 스케일 | E |
| 4 | Canva풍 깔끔한 라이트 UI | E |
| 5 | deck-factory/cardprinter 벤치마킹 | A/B/F 전반 |

---

## Phase A — 기반 리팩토링 (비율 · 배경 모델 · 폰트 임베드)

모든 후속 작업의 토대. 여기서 데이터 모델을 넓혀야 C/D가 깔끔하게 얹힌다.

### A-1. 카드 비율 시스템
- `AspectRatioId = "1:1" | "4:5" | "16:9" | "4:3"` → 픽셀 매핑:
  - 1:1 = 1080×1080 · 4:5 = 1080×1350(현행 기본) · 16:9 = 1920×1080 · 4:3 = 1440×1080
- `Deck.aspectRatio` 추가. 영향 지점:
  - `cardTemplate.ts`: `.card { width/height }` 파라미터화, safe margin은 비율 불변(84/80px 유지)
  - `offscreenRenderer.ts`: BrowserWindow 크기 = 비율 픽셀
  - `qualityGates.ts`: safezone 계산이 이미 좌표 기반이라 카드 크기만 전달하면 됨 (하드코딩 1080/1350 확인 후 파라미터화)
  - UI: StageCanvas·썸네일 scale 계산을 비율 기반으로 (aspect-ratio CSS 동적 적용)
- 툴바에 비율 셀렉트. workspace/preset/양식.md 메타에 `비율:` 라벨 추가.

### A-2. 배경 모델 통일 — "라이브러리 id 참조"
- 현행: 선택 시 deck assets로 복사(`background.ext`) → 카드별 배경이 불가능한 구조.
- 변경: Deck에 `backgroundId?: string`(전역) + Card에 `backgroundId?: string`(카드별 오버라이드, C에서 UI 연결).
  렌더 시 `findLibraryBackground()`로 직접 경로 해석. deck assets 복사 제거(마이그레이션: 기존 deck.json의 backgroundImage 필드는 무시—워크스페이스가 SSOT).
- `getBackgroundPreview` → `getBackgroundPreview(backgroundId)`로 일반화(카드별 미리보기용, 결과 캐시).

### A-3. 폰트 base64 임베드 (deck-factory §9 벤치마킹 — 최고 가치)
- Pretendard Variable(OFL) woff2 다운로드 → `fonts/` 번들 → 빌드 시 base64 data URI로 `@font-face` 생성.
- 템플릿 `<style>`에 임베드 → **미리보기·오프스크린 렌더·타 PC 배포 전부 동일 픽셀** 보장.
  (현행 리스크: 시스템 폰트 폴백으로 PC마다 렌더가 다름 — cinematic 세리프가 엉뚱한 폰트로 뜨는 문제 확인됨)
- 용량: woff2 서브셋(KS X 1001 완성형 + Latin) ≈ 1.2~2MB. 11개 iframe에 반복 주입되므로
  렌더러에서는 `<link>` blob URL 1회 생성 후 공유, 오프스크린은 임베드 유지.
- `fonts/NOTICE.md`에 OFL 전문 + THIRD_PARTY_NOTICES.md 갱신.
- 세리프(시네마틱용)는 Noto Serif KR 서브셋 추가 검토(용량 보고 결정).

**검증**: 비율 4종 × 스타일 6종 매트릭스 스모크(게이트 전부 pass), 폰트 임베드 전후 SHA 비교로 결정론 확인.

---

## Phase B — 스타일 시스템 v2 + design.md 외부 생성 루트

### B-1. StylePreset 토큰 어휘 확장 (deck-factory §1 벤치마킹)
```
v2 추가 토큰: surfaceLadder[3](bg-1/2/3), inkScale{ink,body,mute,faint},
hairline, eyebrowStyle, titleTracking, badgeRadius, bulletShape,
scrimStops(사진 스크림 그라디언트 정밀 제어)
```
- 기존 6종 프리셋을 v2 토큰으로 재작성(하위호환: v1 필드 유지 + v2 optional).
- "카드당 accent 1곳" 원칙을 기본 스타일에 반영(강조 하이라이트 vs 강조 pill 동시 사용 시 게이트 경고 — F에서).

### B-2. design.md — 외부 AI용 스타일 계약 문서
- 앱에서 **[design.md 내보내기]** 버튼 → 문서 구성:
  1. 역할 지시문: "첨부한 카드뉴스 레퍼런스 이미지들을 분석하여 아래 JSON 스키마에 맞는 스타일 코드를 만들어라"
  2. StylePreset v2 JSON 스키마(필드별 설명 + 허용값/형식)
  3. 제약 규칙: textBackdrop↔ink WCAG 4.5:1 이상, accent 1곳 원칙, 사진형이면 usesPhoto+defaultDim 필수 등
  4. 완성 예시 2개(newsprint·cinematic의 JSON 직렬화) — few-shot
  5. 출력 형식 지시: "코드블록에 JSON만 출력"
- 사용 흐름: 사용자가 웹챗봇/바이브코더에 design.md + 레퍼런스 이미지 첨부 → JSON 수령 → 앱에 입력.

### B-3. 커스텀 스타일 임포트
- "스타일 관리" 패널: **JSON 붙여넣기 textarea** + **.json 파일 열기** 두 경로.
- 검증 파이프라인(순수 함수 `parseStyleJson()`, 테스트 필수):
  - 타입 가드(전 필드) → id 정규화(`custom-` prefix, 중복 시 숫자 suffix) → 색상 hex 검증
  - **사전 대비 검사**: ink vs textBackdrop WCAG 계산 → 4.5:1 미만이면 경고(등록은 허용, 게이트가 최종 방어)
- 저장: `userData/library/styles.json`. 드롭다운에 "── 내 스타일 ──" 구분선 아래 표시. 삭제 버튼.
- 커스텀 스타일도 프리셋/워크스페이스/양식.md에서 id로 참조 가능.

**검증**: parseStyleJson 단위 테스트(정상/필드누락/색상오류/대비미달/중복id), 커스텀 스타일 렌더 스모크.

---

## Phase C — 카드별 컨트롤 (배경 · 색감 · 레이아웃)

Canva식 자유 드래그 대신 **"형태는 계약, 값만 조절"**(deck-factory §7) — 파라미터 슬라이더로 결정론 유지.

### C-1. 카드별 오버라이드 데이터 모델
```ts
type CardOverride = {
  backgroundId?: string | null;   // null = 배경 없음 강제, undefined = 전역 따름
  adjust?: { brightness: number; contrast: number; saturation: number }; // 0.5~1.5, 기본 1
  layout?: {
    align: "left" | "center";     // 텍스트 정렬
    offsetY: number;              // 콘텐츠 세로 위치 -20~+20 (%)
    gapBadge: number;             // 배지↔제목 간격 0.5~2.0 (배율)
    gapSubtitle: number;          // 제목↔소제목 간격 0.5~2.0
  };
  dim?: number;                   // 카드별 어둡기 오버라이드
};
```
- 저장 위치: 워크스페이스/프리셋에 `overrides: Record<cardIndex, CardOverride>`.
  (라벨 문법이 아닌 UI 전용 값 — 양식.md에는 넣지 않아 문법 단순성 유지)
- 렌더: `buildCardHtml`이 override 반영 — 색감은 `.photo { filter: brightness() contrast() saturate() }`,
  레이아웃은 CSS 변수(`--offset-y`, `--gap-badge`…)로 주입. CSS filter는 동일 입력=동일 픽셀이라 결정론 안전.

### C-2. UI — 카드 편집 패널에 탭 추가
- 카드 패널을 [내용 | 디자인] 2탭으로: 내용=현행 textarea, 디자인=이 카드 전용 컨트롤
  (배경 셀렉트 · 밝기/대비/채도 슬라이더 3개 · 정렬 버튼 · 세로 위치/간격 슬라이더 · [전역 설정으로 초기화])
- 미리보기 즉시 반영(기존 디바운스 파이프라인에 overrides 포함).

**검증**: override 반영 템플릿 단위 테스트, 극단값(밝기 1.5 + 어둡기 0)에서 대비 게이트가 잡는지 확인.

---

## Phase D — 무료 이미지 검색·다운로드 (Unsplash/Pixabay)

### D-1. 공급자 구조
- `imageProviders.ts`: Pixabay·Unsplash 공용 인터페이스 `{ search(query, page): Result<StockImage[]> }`.
- **Pixabay 우선**(키 발급 간단·출처 표기 의무 없음), Unsplash는 2순위(키 + attribution 요구 — 다운로드 시 작가/링크를 라이브러리 항목 메타에 저장).
- API 키: 설정 패널에서 입력 → `userData/settings.json` 저장. main 프로세스에서만 fetch(키가 렌더러에 노출되지 않음).
- **키 없을 때 폴백**: 검색어로 `shell.openExternal("https://pixabay.com/ko/images/search/{q}/")` 브라우저 열기 + "다운로드한 파일을 [파일 추가]로 등록하세요" 안내.

### D-2. UI — 배경 패널에 [무료 이미지 검색]
- 모달: 검색어 입력 → 썸네일 그리드(레이지 로드) → 클릭 시 원본 다운로드 → 배경 라이브러리 자동 등록+적용.
- 다운로드 이미지는 25MB/포맷 검증 재사용. Unsplash면 attribution 문자열 저장 및 내보내기 안내 표시.

**검증**: mock 응답으로 provider 파서 테스트, 키 미설정 폴백 동작 스모크.

---

## Phase E — UI 리뉴얼 (Canva풍 라이트) + 레일 리사이저

### E-1. 라이트 테마 전환 (deck-factory §8 라이트 프로파일 원칙)
- styles.css 토큰 교체: `--bg:#F6F7F9` / 패널 `#FFFFFF` / 텍스트 `#18191B` / hairline `rgba(0,0,0,.08)` /
  accent 보라(#6C5CE7 계열, Canva 감성) 유지 / 그림자 `0 1px 3px rgba(0,0,0,.08)` 섬세하게 / radius 12~16px.
- 밝은 배경 원칙: 과한 음수 트래킹·어두운 그라디언트 금지, 구분은 hairline+여백으로.
- 다크/라이트는 토큰만 갈아끼우는 구조로 두되 이번엔 **라이트 고정**.

### E-2. 좌측 레일 리사이저
- 레일↔스테이지 사이 6px 드래그 핸들. `railWidth` state(90~280px) → grid-template-columns 동적.
- 썸네일 iframe scale을 고정값(0.087) 대신 `railWidth 기반 계산`으로 전환(ResizeObserver 재사용) → 넓히면 썸네일 확대.
- railWidth를 workspace에 저장/복원.

### E-3. 인스펙터 정리
- 패널 5개가 이미 스크롤 길이 초과 조짐 → [디자인 | 콘텐츠 | 내보내기] 3탭 또는 아코디언으로 재편.
- 상태 메시지를 토스트로 승격(Canva풍), 스테이지 하단은 진행률 전용.

**검증**: 스모크 스크린샷 육안 검수 + 기존 스모크 텍스트 마커 유지(smoke 문자열 "렌더 완료:" 등 불변 확인).

---

## Phase F — 품질 게이트 확장 + 통합 검증 + 배포

### F-1. 게이트 확장 (deck-factory 47체크 중 카드뉴스 적합분 선별)
- 신규: ① accent 남용(카드당 강조 요소 >2 경고) ② 폰트 크기 종류 ≤4 ③ 제목 줄 수 상한
  ④ 색감 조절 후 실효 대비(밝기 filter 반영 근사) ⑤ 비율별 safezone
- 기존 hard-fail(대비/오버플로/폰트하한) 유지 + 신규는 warning 등급 분리(`severity: "fail" | "warn"`).

### F-2. 통합 검증
- 매트릭스 스모크 확장: 비율 4 × 스타일 6(+커스텀 1) = 28조합 게이트 pass.
- 마이그레이션 테스트: v3 workspace.json/presets.json 로드 → v4에서 정상 동작(옵셔널 필드 가드).

### F-3. 배포
- 버전 2.0.0, dist:win, 설치파일 갱신. usage.html 도움말 갱신(양식 문법 + design.md 흐름 + 이미지 검색).

---

## 구현 순서·의존성

```
A(비율·배경모델·폰트) ──→ B(스타일 v2·design.md) ──→ F(게이트·검증·배포)
                    └──→ C(카드별 컨트롤) ──┘
D(이미지 검색) ── A-2 이후 아무 때나
E(UI 리뉴얼) ── 독립적, 마지막 직전 권장(레이아웃 대수술이라 다른 diff와 충돌 최소화)
권장: A → B → C → D → E → F
```

## 리스크

| 리스크 | 대응 |
|--------|------|
| 폰트 임베드 용량(iframe 11개 × 2MB) | 렌더러는 blob URL 공유, 임베드는 오프스크린 전용 |
| 16:9 가로형에서 세로형 레이아웃 깨짐 | 비율별 콘텐츠 패딩 프로파일(가로형은 2컬럼 고려) — A에서 단순 스케일 먼저, 필요시 후속 |
| 커스텀 스타일 저품질 JSON | 사전 WCAG 검사 + 게이트 최종 방어 + design.md에 제약 명시 |
| API 키 UX(발급 귀찮음) | 키 없이도 브라우저 폴백으로 전 기능 흐름 유지 |
| v3 데이터 마이그레이션 | 전 신규 필드 optional + 타입 가드 관대하게 |
```
