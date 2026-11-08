# 인수인계서 — 정보형 카드뉴스 제작기 재설계

> 이 문서는 작업 세션이 끊기거나(토큰 소진) 다른 에이전트(Codex 등)가 이어받을 때 필요한 전체 맥락을 담는다.
> 결정이 바뀌거나 새 라운드가 진행될 때마다 이 파일을 갱신한다.

## 0. 프로젝트 상태 (한 줄 요약)

기존 "GPT 이미지 자동 생성기" Chrome 익스텐션(ChatGPT DOM 자동화)은 **폐기 결정**.
[cardprinter](https://github.com/kimsh-1/cardprinter) 아키텍처(로컬 결정론 HTML/CSS 텍스트 레이어 + headless Chrome 렌더링)를 참고해 **새로 설계** 중.
딥인터뷰와 omc-plan 컨센서스는 완료. 2026-07-07 Codex/ULW 세션에서 최종 계획 구현을 진행해 Electron + React 앱의 parser, 저장소, 오프스크린 PNG 렌더러, 품질 게이트, 기본 style fallback, Windows unpacked 패키징까지 동작 검증했다. 현재 앱은 기본 newsprint 스타일로 10장 PNG를 생성하고, `slots.json`/`gate-report.json`을 저장하며, 렌더 후 승인 대기 상태를 표시한다.

## 1. 왜 폐기했나

기존 익스텐션은 ChatGPT에 프롬프트를 자동입력해 "AI가 이미지를 생성"하는 방식이라, 텍스트 위치가 매번 미세하게 달라지고 픽셀 단위 일관성을 보장할 수 없었음. 사용자가 cardprinter 데모(신문지형 마스트헤드 + 제목/부제 + 배경사진, 8장 카드 캐러셀)를 보고 방향 전환을 요청 — 로컬에서 HTML/CSS로 텍스트를 결정론적으로 렌더링하는 방식이 훨씬 낫다고 판단.

## 2. cardprinter 검증 결과 (완료)

`https://github.com/kimsh-1/cardprinter` 클론 후 Windows에서 실제 설치·렌더링 성공 (`bash scripts/pipeline.sh examples/sample draft` → 0 FAIL, 2 WARN, PNG 8장 정상 생성).

**Windows 로컬 패치 3개** (원본 리포는 안 건드림, 클론본에만 적용):
1. `export PYTHONUTF8=1` — 한글 로케일(cp949)이 UTF-8 JSON을 못 읽는 문제
2. `pip install brotli fonttools` — WOFF2 폰트 파싱 누락 의존성
3. `scripts/render/export_card.mjs`의 `findChrome()`에 `CARDPRINTER_CHROME` 환경변수 폴백 추가 — 원코드는 Linux 전용 `chrome-headless-shell` 캐시 경로만 찾음. 시스템 Chrome(`C:\Program Files\Google\Chrome\Application\chrome.exe`)으로 대체 가능.

**아키텍처 핵심 (재사용할 부분)**:
- 데이터 계약: `brief.json`(사실/소스) → `copy.json`(카드별 **타입드+가변 필드**: type=cover/image/body/cta, blocks=para/bullets/callout) → `tokens.json`(팔레트/폰트/그리드 디자인시스템)
- 렌더: `scripts/render/build_carousel.mjs`(copy+tokens → HTML 카드) → `scripts/render/export_card.mjs`(headless Chrome로 HTML→PNG, `[data-slot]` 요소의 bbox/색상/폰트크기를 `slots.json`으로 같이 추출)
- **텍스트는 항상 HTML/CSS 레이어** — AI가 이미지 위에 글자를 그리게 하지 않음(철칙). 그래서 위치가 100% 결정론적.
- 품질 게이트(G1~G19, 전부 exit-code): 대비(WCAG), 오버플로(bbox⊂세이프존), 폰트크기 하한, 렌더다양성 등을 **렌더링된 PNG에서 픽셀 실측**해서 강제.
- 톤 티어 시스템: `references/tiers/{luxury,character,brand,newsprint...}.json` — 팔레트/폰트/그리드/모션을 프리셋으로 묶음. 커스텀 티어는 브랜드 BI 이미지에서 `scripts/tiers/palette_extract.py`로 색 추출해 생성 가능(`references/custom-tier-guide.md`).

## 3. 우리 프로젝트에서 달라지는 점 (단순화 요인)

- **배경 이미지**: cardprinter는 AI(gpt-image-2)가 생성 + rembg로 누끼를 따지만, 우리는 **사용자가 직접 업로드**하는 이미지를 그대로 씀 → AI 이미지생성 API, rembg 누끼 파이프라인 전부 불필요.
- **쇼츠/릴스(S7)**: 요청 범위 밖. 카드 캐러셀(PNG)만 필요.
- 따라서 우리가 실제로 필요한 건 cardprinter의 **S2(카피 계약)+S3(tokens)+S5~S6(HTML 카드 빌드 → headless Chrome PNG export)** 부분 뿐. S1(brief 리서치), S4(이미지생성+누끼), S7(쇼츠)는 불필요.

## 4. 지금까지 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 카드 수 | 10장 독립 카드 (배치 생성, 기존 익스텐션의 "10슬롯"과 동일 개념) |
| 카드별 텍스트 구성 | **가변적** — 카드마다 제목만/제목+리스트/제목+본문 등 다름. cardprinter의 `copy.json` type/archetype/blocks 구조와 동일 문제의식 |
| 텍스트 입력 UI | 카드당 자유 textarea 1개 + **라벨 문법**(`제목:`/`소제목:`/`본문:` 등 사용자가 직접 타이핑) — 새 UI 안 만들고 기존 UI 형태 재활용. 이걸 `copy.json` 같은 구조화 데이터로 바꾸는 **파서**가 필요 |
| 배경 이미지 | 사용자 직접 업로드, **전체 카드 공통 1장** |
| 헤더 | 카드 상단 라벨/카테고리 (이미지 안에 실제 렌더링되는 텍스트) |
| 푸터 | SNS 계정명(예: `@kkongdon_story`) (이미지 안에 실제 렌더링되는 텍스트) |
| 출력/렌더링 방식 | **결정론적** — cardprinter와 동일하게 HTML/CSS 텍스트 레이어 + headless Chrome 스크린샷 → PNG (ChatGPT가 그리게 하지 않음) |
| 실행 형태 | **확정**: Claude Code 없는 사람도 쓸 수 있는 **독립 앱** (cardprinter처럼 개인 전용 스킬 아님). 사용자의 다른 프로젝트 "KOS POV Lab"(Electron+React, 별도 리포)과 유사한 형태 예상. cardprinter의 Node/Python 렌더 엔진(headless Chrome PNG export)을 이 앱 내부 로직으로 포장해야 함. Electron은 Chromium을 내장하므로 별도 `chrome-headless-shell` 탐색 로직 없이 BrowserWindow로 직접 렌더링/캡처하는 방식도 검토 가치 있음(설계 단계에서 결정) |
| 카드 비주얼 스타일 | cardprinter 데모(신문지형 `newsprint` 티어: 마스트헤드+제목/부제+배경사진+페이지번호)를 그대로 기본 템플릿으로 채택하고 싶어함 |
| **스타일 학습 기능 (신규, 미결)** | 사용자가 자신의 기존 캐러셀 이미지를 보여주면 그 스타일(폰트/색/레이아웃)을 자동으로 추출해서 맞추는 기능을 원함 — cardprinter의 커스텀 티어 인제스트(`palette_extract.py`, `custom-tier-guide.md` 경로A)와 개념적으로 동일. **디테일 미결: 이미지에서 뭘 추출할지(팔레트만? 폰트도? 레이아웃 구조도?), 몇 장을 줘야 하는지, 결과를 어떻게 확인/승인받는지** |
| 작업 프로세스 요구사항 (신규) | **모든 작업은 이 인수인계서(HANDOFF.md)에 계속 기록**하고, 토큰이 다 차면 Codex 등 다른 에이전트가 이 문서만 보고 이어서 작업할 수 있어야 함 |

## 5. 인터뷰 완료 — 최종 확정 사항

- **내 캐러셀 스타일 학습**: 사용자가 본인 캐러셀 예시 이미지를 올리면 (1) 색상 팔레트, (2) 레이아웃 구조(헤더/본문 배치·여백·정렬), (3) 폰트 분위기(굵기/세리프 여부)를 AI 비전 분석으로 추출 — cardprinter의 `palette_extract.py`(팔레트만 자동)보다 범위가 넓음. 정확한 폰트 파일 매칭은 안 되고 "느낌이 제일 비슷한 번들 폰트"를 고르는 수준.
- **카드 유형 태그**: 카드마다 `유형: 표지` / `유형: 본문` / `유형: 마무리` 태그를 붙이고, 유형별로 완전히 다른 레이아웃 템플릿 적용(cardprinter의 archetype과 동일 사상). 표지=대형 헤드라인 중심, 본문=제목+본문블록, 마무리=CTA 버튼 포함.
- **라벨 목록 (최종)**: `제목:` / `소제목:` / `본문:` (본문 안에서 `-`로 시작하는 줄은 자동으로 불릿 리스트 렌더링) / `출처:` (하단에 작은 글자) / `강조:` (템플릿이 색/박스로 강조 처리, cardprinter의 callout과 동일).
- **품질 게이트**: cardprinter 수준(G1~G19: 대비 WCAG, 오버플로 bbox⊂세이프존, 폰트크기 하한, 렌더다양성 등 픽셀 실측 기반 exit-code 게이트)을 **처음부터 전부 도입**하기로 확정. 개발량은 늘지만 품질 안정성 우선.

## 6. 다음 단계

인터뷰 종료. `.omc/specs/deep-interview-cardnews-rebuild.md` 스펙과 omc-plan 컨센서스는 완료되었고, Phase 1~6 기본 구현 루프까지 진행됐다. 다음 세션이 먼저 할 일은 아래 6-2의 잔여 리스크를 확인한 뒤, 실제 배경 이미지 선택 수동 QA와 실사용 스타일 추출 provider 연결 여부를 결정하는 것이다.

## 6-1. omc-plan 컨센서스 진행 상황 (Codex 인수인계 시점)

- Planner 초안 작성 완료: `.omc/drafts/cardnews-rebuild-plan-draft.md`
  - 핵심 결정: Electron 앱 + **오프스크린 렌더링**(`webPreferences: { offscreen: true }`)으로 카드 HTML → PNG 캡처. `show:false` 일반 창 + `capturePage()`는 채택 안 함(GPU 컴포지팅 스로틀링으로 블랭크 프레임 위험, Architect 검토에서 발견).
  - Phase 1~6 구성, IPC 설계(`window.cardnews.*`), 데이터 영속성(JSON 파일, `app.getPath('userData')`) 포함.
- **Architect 검토**: 완료, 위 오프스크린 렌더링 수정 반영됨. Option B(puppeteer-core+headless Chrome 번들)로의 폴백 경로도 리스크 완화책으로 명시해둠.
- **Critic 재검토(2026-07-06 Codex/ULW)**: 완료, 판정 **REVISE**였고 아래 보완을 반영함.
  1. Acceptance Criteria에 렌더 완료 후 10장 썸네일/게이트 상태/저장 위치/승인·수정·재생성 UX 추가
  2. 렌더 실패, 품질 게이트 실패, 스타일 추출 API 실패의 오류 UX/재시도 경로 명시
  3. 로컬 업로드 이미지의 MIME/확장자/크기 검증, userData 저장, 배경 이미지 외부 전송 금지, 참고 이미지 Vision API 전송 전 사용자 실행 조건 명시
  4. 번들 한글 폰트 라이선스 고지(`fonts/NOTICE.md`, `THIRD_PARTY_NOTICES.md`, 앱 About/설정 화면) 명시
  5. 10장 렌더 큐/동시성 기본 1, 진행률, 카드별 timeout, 성능 목표 명시
  6. stale `show:false` + `capturePage()` 기본 경로를 제거하고, `webPreferences: { offscreen: true }` + `paint` 이벤트 캡처를 기본 경로로 확정
- **최종 계획 확정**: `.omc/plans/cardnews-rebuild-plan.md` 생성 완료. `.omc/drafts/cardnews-rebuild-plan-draft.md`는 superseded draft로 남김.
- **Phase 1 진행(2026-07-06 Codex/ULW)**: Electron + React + Vite + TypeScript 스캐폴드 생성 완료.
  - 추가 파일: `package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html`, `electron/main.ts`, `electron/preload.ts`, `src/domain/*`, `src/ui/*`
  - 구현 내용: secure preload의 `window.cardnews.*` stub, 헤더/푸터 입력, 배경/스타일 선택 버튼 skeleton, 10장 카드 textarea, 진행/상태 inspector
  - 검증: `npm run typecheck` 0, `npm run build` 0, `npm audit --audit-level=high` 0, `npm run dev` 기반 Electron smoke screenshot/text dump 생성
  - 2차 Gate Reviewer REJECT 대응 완료: domain/API 계약 readonly type alias/readonly array로 정리, `tsconfig.node.json`/`tsconfig.web.json` strict flags 보강(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`), env index-signature 접근 수정, smoke capture rejection 처리 보강
  - 증거: `.omc/evidence/phase1-scaffold-dev-rerun.png`, `.omc/evidence/phase1-scaffold-dev-rerun.txt`
  - 최종 rerun 증거: `.omc/evidence/phase1-scaffold-dev-rerun.png`, `.omc/evidence/phase1-scaffold-dev-rerun.txt`
  - ULW 최종 게이트 증거: `.omo/evidence/final-ulw-phase1-scaffold-code-review.md`, `.omo/evidence/final-ulw-phase1-scaffold-final-reviewer.md`, `.omo/evidence/final-ulw-phase1-scaffold-manual-qa.md`, `.omo/evidence/final-ulw-phase1-scaffold-qa-matrix.md`, `.omo/evidence/final-ulw-phase1-scaffold-slop-review.md`, `.omo/evidence/logs/*`
  - 다음 작업: Phase 2 라벨 파서와 domain contract 테스트부터 진행. `parseCardText(raw)`를 먼저 RED 테스트로 고정한 뒤 구현할 것.

## 6-2. 최종 계획 구현 진행 상황 (2026-07-07 Codex/ULW)

- **Phase 2 parser 완료**
  - 추가/변경: `src/domain/cardParser.ts`, `src/domain/cardParser.test.ts`, `src/domain/cardnews-api.ts`, `electron/main.ts`, `electron/preload.cts`, `src/ui/App.tsx`
  - 구현: `유형/제목/소제목/본문/출처/강조` 라벨 파서, `표지|본문|마무리` 타입 매핑, `본문:` 내 `-` 불릿 구조화, 빈 카드/잘못된 유형/제목 누락 오류
  - 증거: `.omo/evidence/logs/wave1-parser-red-no-test-script.log`, `.omo/evidence/logs/wave1-parser-red-missing-implementation.log`, `.omo/evidence/logs/wave1-parser-green-after-preload-cjs.log`, `.omc/evidence/wave1-parser-surface.txt`, `.omc/evidence/wave1-parser-surface.png`
  - 표면 QA에서 발견/수정: sandboxed preload가 ESM `.js`로는 `window.cardnews`를 노출하지 못해 `electron/preload.cts` → `dist-electron/electron/preload.cjs`로 전환.
- **Phase 3 renderer / storage 완료**
  - 추가/변경: `src/storage/deckStore.ts`, `src/render-engine/cardTemplate.ts`, `src/render-engine/offscreenRenderer.ts`
  - 구현: `app.getPath("userData")/gpt-cardnews-auto` 하위 deck/renders 저장, 로컬 이미지 확장자/MIME/25MB 검증 및 앱 데이터 복사, cover/body/cta 템플릿, `BrowserWindow({ webPreferences: { offscreen: true } })` `paint` 이벤트 기반 PNG 저장, `slots.json` 저장
  - `show:false` 일반 창 `capturePage()`는 제품 렌더 경로에 사용하지 않음. 기존 smoke screenshot에서만 UI 증거용으로 남아 있음.
  - 증거: `.omo/evidence/logs/wave2-render-surface-smoke-2.log`, `.omc/evidence/wave2-render-surface.txt`, `.omc/evidence/wave2-render-surface.png`
  - 산출물 예시: `C:\Users\js480\AppData\Roaming\gpt-cardnews-auto\gpt-cardnews-auto\renders\render-2026-07-06T22-32-00-547Z`
- **Phase 4 quality gates 완료**
  - 추가/변경: `src/render-engine/gates/qualityGates.ts`, `src/render-engine/gates/qualityGates.test.ts`, `src/domain/types.ts`
  - 구현: contrast 4.5:1, safezone overflow, font floor 18px 검사. `gate-report.json`에 구조화 결과 저장.
  - 증거: `.omo/evidence/logs/wave2-gates-red-missing-implementation.log`, `.omo/evidence/logs/wave2-gates-green.log`
- **Phase 5 style fallback 구현**
  - 구현: 참고 이미지 picker IPC, style extraction 실패 시 recoverable `style_extraction_failed` 메시지, `CARDNEWS_MOCK_STYLE_EXTRACTION=1`일 때 mock style draft 생성, 사용자 승인 후 style profile 저장.
  - 잔여: 실제 Vision/API provider 호출은 아직 연결하지 않았음. 기본 newsprint 렌더는 API 키 없이 계속 가능.
- **Phase 6 packaging / notices 구현**
  - 추가/변경: `package.json` `package:dir`/`dist:win` 및 electron-builder 설정, `THIRD_PARTY_NOTICES.md`, `fonts/NOTICE.md`
  - 검증: `npm run package:dir` 성공, `release/win-unpacked/Cardnews Studio.exe` 생성 및 packaged app smoke 성공.
  - 증거: `.omo/evidence/logs/final-package-dir-rerun.log`, `.omo/evidence/logs/final-packaged-render-smoke-rerun.log`, `.omc/evidence/final-packaged-render-surface-rerun.txt`, `.omc/evidence/final-packaged-render-surface-rerun.png`
- **결정론성 증거**
  - 같은 입력으로 2회 렌더한 `card-01.png`~`card-10.png` SHA-256이 모두 동일.
  - 증거: `.omo/evidence/logs/wave2-render-determinism-hashes.log`, `.omo/evidence/logs/wave2-render-determinism-diff.log` (`diffExit=0`)
- **최종 명령 검증**
  - `npm test`: 2 files / 10 tests pass (`.omo/evidence/logs/final-tests-rerun.log`)
  - `npm run typecheck`: pass (`.omo/evidence/logs/final-typecheck-rerun.log`)
  - `npm run build`: pass via `npm run package:dir` (`.omo/evidence/logs/final-package-dir-rerun.log`)
  - packaged exe smoke: pass (`.omo/evidence/logs/final-packaged-render-smoke-rerun.log`)
- **잔여 리스크 / 다음 세션 첫 확인**
  1. 자동 smoke는 기본 배경으로 검증했다. 실제 파일 다이얼로그로 배경 이미지 1장을 선택한 뒤 10장 전체에 적용되는 수동 QA가 필요하다.
  2. 폰트 바이너리는 아직 번들하지 않고 시스템 fallback을 사용한다. 배포 품질을 고정하려면 OFL 한글 폰트 번들 및 라이선스 전문 추가가 필요하다.
  3. style extraction은 provider boundary와 mock/fallback까지만 있다. 실제 Vision API 연결 여부와 사용자 승인 문구를 다음 제품 결정으로 남긴다.
  4. 진행률 이벤트(`render:progress`)는 아직 세분화하지 않았다. 현재 UI는 `렌더링 중... 1/10` 후 완료 상태로 전환한다.

## 6-3. v2 에디터 개선 (2026-07-07, 레퍼런스 영상 기반)

**요청**: 사용자가 Threads 게시물(@makefamily_/post/DaH0sFFiF0H — "세상 참 좋아졌다" 카드뉴스 에디터 데모 영상)을 참조해 "다양한 스타일 + 미리보기 + 디테일"을 요구. 영상 5개를 다운로드·프레임 추출해 레퍼런스 UI(3-패널 에디터: 좌 썸네일 레일 / 중앙 라이브 미리보기 / 우 컨트롤, 스타일 드롭다운 6종, 포인트 색상 스와치, 하단 어둡기 슬라이더, `*단어*` 강조, 배지/페이지번호/멘션/>>>> 디테일)를 분석 후 이식.

**구현 내역**:
- `src/render-engine/stylePresets.ts` (신규): 6종 스타일 토큰 — newsprint(신문 오버레이)/cinematic(시네마틱 사진)/magazine(매거진 형광 사진)/whiteblue(화이트&블루)/minimal(미니멀 화이트)/darkinfo(다크 인포). 각 토큰에 대비 게이트용 `textBackdrop`/`chromeBackdrop` 근사 배경색 포함. `accentSwatches` 10색.
- `src/render-engine/cardTemplate.ts` (리워크): 스타일 토큰 기반 렌더. 배지 pill, 페이지 번호(N/총), 푸터 멘션+`>>>>`, `*단어*`→포인트색 하이라이트, 본문 카드 큰 번호(01/02...), 사진형 하단 어둡기 그라디언트(dim), 강조 pill 잉크는 WCAG 대비 계산으로 흰/검 자동 선택(`pickReadableInk`). data-slot 메트릭/게이트 호환 유지.
- `src/domain/cardParser.ts`: `배지:` 라벨 추가(Card.badge). `*` 불릿은 뒤에 공백 있을 때만 인정(`*강조*` 문법 충돌 방지).
- Deck/DeckDraft에 `styleId`/`accentColor`/`backgroundDim` 추가, deckStore 영속화, main.ts 검증 확장.
- IPC `cardnews:getBackgroundPreview` 추가: 선택된 배경을 1080px JPEG data URL로 반환(라이브 미리보기용).
- `src/ui/App.tsx`+`styles.css` (리워크): 다크 3-패널 에디터. **미리보기는 렌더러가 main과 동일한 `buildCardHtml()`을 직접 import해 iframe srcDoc으로 표시 → 미리보기=최종 PNG 동일 HTML 보장**. 250ms 디바운스, 좌측 10장 썸네일(스케일 iframe), 중앙 스테이지(ResizeObserver 스케일), 우측 스타일/색상/어둡기/카드편집/게이트 결과 패널.
- `scripts/style-matrix-smoke.mjs` (신규): 6스타일×10카드 렌더+게이트 매트릭스 검증 스크립트. 주의: 오프스크린 렌더 창이 닫힐 때 앱이 종료되지 않도록 `window-all-closed` 핸들러 필수.

**검증**: `npm test` 19/19 (배지·강조충돌·템플릿 스타일 테스트 6개 추가), `npm run typecheck` 0, `npm run build` 0, 스타일 매트릭스 6/6 게이트 전부 pass, E2E 스모크 "렌더 완료: 10장". 증거: `.omc/evidence/v2-editor-*.png|txt`, `.omc/evidence/style-matrix.log`, `%APPDATA%/gpt-cardnews-auto/gpt-cardnews-auto/renders/style-smoke-*`.

**작업 중 발견한 함정 (다음 세션 참고)**:
1. 미리보기 iframe에 `sandbox=""`를 주면 OOPIF가 되어 `capturePage()` 스모크에서 블랭크로 찍힘 → sandbox 제거(로컬 생성 HTML만 표시하므로 안전).
2. `transform: scale()`은 숫자만 받으므로 `calc(100cqw/1080)` 같은 길이 단위 불가 → ResizeObserver로 스케일 계산.
3. 헤더/푸터는 72px 세이프존 게이트 안쪽(top/bottom 80px)에 배치해야 함.
4. magazine 계열 밝은 accent 위 흰 글자는 대비 4.5:1 미달 가능 → WCAG 잉크 픽커로 해결(게이트가 실제로 잡아냄).

**잔여 (다음 개선 후보)**:
1. 카드별 개별 배경 이미지(현재 전역 1장) + 무료 이미지 검색(레퍼런스의 Unsplash류 기능).
2. "현재 카드 PNG"/"전체 ZIP 내보내기" 단축 버튼(현재는 폴더 열기).
3. 한글 폰트(OFL) 번들 — 현재 시스템 폰트 fallback이라 PC마다 렌더가 달라질 수 있음(cinematic 세리프 스택이 의도와 다른 폰트로 fallback되는 것 확인됨).
4. 저장/불러오기 UI(loadDeck IPC는 있으나 UI 미연결), 스타일 참고 이미지 학습(Vision API) 연결.

## 6-4. v3 (1.0.0) — 양식/배경 라이브러리 + 배포 빌드 (2026-07-07)

**요청 4건**: ① 양식.md 작성 파일 업로드 → 자동 채우기, ② 배경/양식 저장 + 드롭다운 선택, ③ 빠진 기능 보강, ④ 빌드 + 실행/배포파일 제작.

**구현 내역**:
- `src/domain/deckImporter.ts` (신규, 순수 파서 + 테스트 7개): 양식.md 파싱. 메타 블록(헤더/멘션/스타일/포인트색상/하단어둡기) + `---` 또는 `## 카드 N` 구분 카드 블록. 스타일은 id·한글명 모두 인식, 잘못된 값은 경고 수집(실패 아님), 카드 최대 12장. `buildTemplateDocument()` 템플릿 생성(라운드트립 테스트 보장).
- **배경 라이브러리**: `userData/gpt-cardnews-auto/library/backgrounds/` + `backgrounds.json` 인덱스. 드롭다운("없음" 포함) 선택, "파일 추가" = 등록+즉시 적용. 배경 교체 시 확장자 다른 이전 deck asset 삭제(`removeAssetVariants`) — findDeckAssetPath가 옛 파일을 먼저 찾는 버그 예방.
- **양식 프리셋**: `library/presets.json`. 설정 + 카드 스켈레톤 전체 스냅샷을 이름 붙여 저장/선택/삭제.
- **워크스페이스 자동 저장/복원**: `workspace.json`, 800ms 디바운스. 재시작 시 카드·설정·배경 복원.
- **에디터 보강**: 카드 추가/삭제(1~12장), 초기화(confirm), 렌더 후 [현재 카드 PNG]/[전체 ZIP(adm-zip)] 내보내기.
- **IPC 12개 추가**: importDeckDocument, exportTemplateFile, listBackgroundLibrary, addBackgroundToLibrary, selectBackground(null=없음), listDeckPresets, saveDeckPreset, deleteDeckPreset, saveWorkspace, loadWorkspace, exportCardPng, exportDeckZip.
- **배포**: `build/icon.ico`(PIL 생성, 카드 스택 모티브), version 1.0.0, NSIS `Cardnews-Studio-Setup-1.0.0.exe`, 바탕화면 바로가기. `npm run dist:win` → `release/`.

**검증**: 테스트 26/26, typecheck 0, E2E 스모크 "렌더 완료: 10장" (`.omc/evidence/v3-editor-ui.png`).

**주의 (다음 세션)**:
- adm-zip은 production dependency여야 electron-builder가 번들함.
- WorkspaceState/DeckPreset의 optional 필드는 exactOptionalPropertyTypes 때문에 조건부 스프레드로만 삽입.
- 워크스페이스 복원 완료 전 자동 저장이 돌지 않도록 `workspaceReady` ref 가드 필수.
- **빌드 함정**: 이전 빌드의 `Cardnews Studio.exe`가 실행 중이면 `release/win-unpacked` EBUSY로 electron-builder 실패 → `taskkill //F //IM "Cardnews Studio.exe"` 후 `rm -rf release` 재시도. OneDrive 경로라 동기화 잠금 가능성도 있음.

## 6-5. v4 업그레이드 완료 감사/구현/패키징 (2026-07-07 Codex/ULW)

**사용자 요청**: `.omc/plans/v4-upgrade-plan.md` 기준으로 A2 완료 여부를 실제 코드/테스트/릴리즈 산출물로 감사한 뒤, A3부터 F까지 순차 구현하고 `release/Cardnews-Studio-Setup-1.0.0.exe`, `release/win-unpacked/Cardnews Studio.exe`를 다시 생성·검증. Claude Code에 넘길 상세 인수인계서도 남길 것.

**A2 감사 결과**: A2는 부분 완료였다. 전역 `backgroundId`와 기본 검증은 있었지만, legacy `backgroundImage`/asset lookup 제거, 카드별 override, style v2/custom style 저장, 외부 이미지 fallback, expanded gates/migration, 최종 패키징 검증은 미완이었다. 감사 기록: `.omo/evidence/v4-upgrade/audit/a2-audit-summary.md`.

**구현 완료 요약**:
- A3: Pretendard 번들 폰트 CSS 임베드 및 오프스크린 렌더 폰트 로딩.
- B: style preset v2 토큰, `design.md` 계약 export, JSON custom style parse/save/delete, `.json 파일 열기`.
- C: 카드별 배경/밝기/대비/채도/정렬/간격/어둡기 override와 저장/렌더 연결.
- D: Pixabay API 검색/다운로드 및 API 키 없을 때 브라우저 fallback. attribution 저장.
- E: 밝은 Canva-light 편집 UI, rail resizer, style/배경/디자인 컨트롤, `usage.html` 사용법 갱신.
- F: 경고/실패 분리 품질 게이트, legacy migration 테스트, 28-combo matrix smoke, 라이선스 고지, Windows packaging.

**중요 수정**: 최종 matrix smoke 첫 실행에서 간헐적 blank frame이 발생했다. 원인은 첫 non-empty paint가 단색 배경 프레임일 때 바로 캡처하는 타이밍 문제. `src/render-engine/offscreenRenderer.ts`에서 blank frame을 무시하고, timeout을 10초로 늘리고, `document.fonts.ready` 후 repaint를 유도하도록 수정했다. 재실행 matrix는 통과.

**최종 검증 증거**:
- `npm run typecheck`: `.omo/evidence/v4-upgrade/logs/final-after-review-typecheck.log` exit 0
- `npm test`: `.omo/evidence/v4-upgrade/logs/final-after-review-tests.log` - 7 files / 48 tests pass
- `npm run build`: `.omo/evidence/v4-upgrade/logs/final-after-review-build.log` exit 0
- 28-combo style matrix: `.omo/evidence/v4-upgrade/logs/final-after-review-style-matrix-smoke.log` exit 0. hard gate fail/RENDER FAIL 없음. `font_variety`, `filter_contrast`는 advisory warn으로 남음.
- package:dir/dist:win: `.omo/evidence/v4-upgrade/logs/final-after-review-package-dir.log`, `.omo/evidence/v4-upgrade/logs/final-after-review-dist-win.log` exit 0
- packaged exe smoke: `.omo/evidence/v4-upgrade/screenshots/final-after-review-packaged-render-smoke.png`, `.omo/evidence/v4-upgrade/logs/final-after-review-packaged-render-smoke-text.txt`, `.omo/evidence/v4-upgrade/logs/final-after-review-packaged-render-smoke.log` exit 0

**릴리즈 산출물**:
- `release/Cardnews-Studio-Setup-1.0.0.exe`
  - size 106,364,851 bytes
  - SHA-256 `adb65bf2a81bc63776a7c568ef28fb90e880469ff6f9016a51c8c46da38c001f`
- `release/win-unpacked/Cardnews Studio.exe`
  - size 235,706,368 bytes
  - SHA-256 `be1e60b6bbdb71041ab5121e94a3abd03d9f25156121c68f9f7d59ba93aadd1b`
- 해시/버전 증거: `.omo/evidence/v4-upgrade/logs/release-sha256.txt`, `.omo/evidence/v4-upgrade/logs/release-version-info.txt`

**상세 Claude Code 인수인계서**: `.omc/handoffs/v4-upgrade-handoff-20260707.md`

**최종 evidence 묶음**:
- `.omo/evidence/v4-upgrade/final/verification-summary.md`
- `.omo/evidence/v4-upgrade/final/manual-qa-matrix.md`
- `.omo/evidence/v4-upgrade/final/final-verification-manifest.json`
- `.omo/evidence/v4-upgrade/final/code-review.md`
- `.omo/evidence/v4-upgrade/final/programming-size-exceptions.md`

**잔여 리스크 / 다음 개선 후보**:
1. 설치형 exe는 실제 설치를 실행하지 않았다. 시스템 설치 부작용을 피하기 위해 NSIS 빌드 로그, exact filename, 크기/해시/버전, unpacked exe 실제 실행 smoke로 검증했다.
2. Matrix hard gate는 통과하지만 advisory warn이 남아 있다. body card font size tier를 줄이고 white/minimal source contrast를 더 올리면 경고를 줄일 수 있다.
3. production 파일 6개가 250 pure LOC를 넘는다. 첫 5줄 안의 `SIZE_OK`는 릴리즈 예외이며, 다음 기능 전 `.omo/evidence/v4-upgrade/final/programming-size-exceptions.md`의 split plan을 실행해야 한다.
4. 계획 문서에는 v2.0.0 표현이 있으나 사용자가 명시한 산출물명이 `1.0.0`이어서 버전은 1.0.0 유지.

## 6-6. v4 테스트 피드백 반영 완료 (2026-07-07 Codex/ULW)

**사용자 테스트 피드백**: PNG가 HTML과 달리 비어 보임, 배경 이미지가 미리보기/PNG에 적용되지 않음, 글자 겹침/잘림, 콘텐츠/내보내기 탭 무반응, JSON 스타일 샘플 부재, 폰트/텍스트/도형/선/이미지 레이어 필요, CSV 대량생산 필요. 사용자가 추천안 승인 후 `slides-grab` 저장소도 이미지 렌더링 참고 자료로 제시함.

**구현 완료**:
- 렌더러 신뢰성: `src/render-engine/offscreenRenderer.ts`가 폰트/이미지/CSS background/렌더 준비/안정 프레임 이후 캡처하고 blank frame을 거부한다.
- 시각 게이트: `src/render-engine/gates/visualContentGate.ts`와 `scripts/verify-render-png.mjs`로 대부분 흰 PNG/낮은 커버리지 산출을 hard fail로 잡는다. 단, 합법적인 미니멀 흰 배경은 coverage와 luminance까지 함께 판단해 오탐을 줄였다.
- 배경 계약: `backgroundCssUrl`이 있으면 모든 프리셋에서 `.photo`를 렌더한다. 미리보기와 PNG가 같은 `buildCardHtml()` 경로를 사용한다.
- 커스텀 스타일 대비: `newsprint` id 특수처리를 제거하고 프리셋의 `textBackdrop`/`chromeBackdrop`을 사용하게 고쳐 `custom-smoke`와 AI JSON 스타일도 내장 스타일처럼 검증된다.
- UI 탭: `디자인`, `콘텐츠`, `내보내기`가 실제 별도 패널로 동작한다.
- JSON 스타일: 샘플 JSON, AI용 디자인 계약, fenced JSON 파싱/검증을 제공한다.
- 폰트: `.ttf`, `.otf`, `.woff2`를 앱 관리 폴더로 가져와 선택 가능.
- 콘텐츠 레이어: 텍스트 박스, 도형, 선, 이미지 레이어를 구조화 모델로 저장하고 preview/PNG에 렌더한다.
- CSV bulk: 한 CSV 행이 한 deck/render job이 되며, 실패 행은 `bulk-report.json`/`bulk-report.csv`에 남기고 정상 행은 계속 렌더한다.
- 내보내기 smoke: `CARDNEWS_SMOKE_ACTION=render-export`가 렌더 후 현재 카드 PNG와 전체 ZIP을 실제 export 경로로 검증한다. smoke 중에는 OS 저장 대화상자 대신 render output의 `smoke-exports/`에 자동 저장한다.

**최종 검증 증거**:
- `npm run typecheck`: `.omo/evidence/v4-test-feedback-repair/final-typecheck-after-visual-threshold-fix.log` exit 0
- `npm run test`: `.omo/evidence/v4-test-feedback-repair/final-test-after-visual-threshold-fix.log` - 9 files / 56 tests pass
- `npm run build`: `.omo/evidence/v4-test-feedback-repair/final-build-after-visual-threshold-fix.log` exit 0
- 스타일 매트릭스: `.omo/evidence/v4-test-feedback-repair/final-style-matrix.log` exit 0. 내장 스타일 + `custom-smoke` hardGate 모두 pass. 남은 항목은 advisory warn(`font_variety`, `filter_contrast`).
- dev smoke: `.omo/evidence/v4-test-feedback-repair/final-smoke-render-export.log`, `final-smoke-bg.log`, `final-smoke-bulk.log` 모두 exit 0
- packaged exe smoke: `.omo/evidence/v4-test-feedback-repair/final-dist-packaged-smoke-render-export.log` exit 0
- PNG 픽셀 검증: `.omo/evidence/v4-test-feedback-repair/final-visual-verifier-render.json`, `final-visual-verifier-bulk.json` 모두 `ok: true`
- 최종 요약: `.omo/evidence/v4-test-feedback-repair/final-smoke-summary.json`, `final-release-hashes.json`, `final-release-artifacts.log`

**최종 릴리즈 산출물**:
- `release/Cardnews-Studio-Setup-1.0.0.exe`
  - size 106,376,772 bytes
  - SHA-256 `0dc113554a72e8e7b491c4616b802dd61cd011cd7056a7c28426cd53d3f10b92`
  - modified local `2026-07-07T23:15:05`
- `release/win-unpacked/Cardnews Studio.exe`
  - size 235,706,368 bytes
  - SHA-256 `97a262689252b4fec3bd3d0dec01958b4d7337097bd8faf61353ae44fd88df37`
  - modified local `2026-07-07T23:14:43`

**Claude Code 상세 인수인계서**: `.omc/handoffs/v4-test-feedback-repair-handoff-20260707.md`

**남은 리스크**:
1. 설치 프로그램은 시스템 설치 부작용 때문에 직접 실행하지 않았다. 대신 `dist:win` 로그, 파일 해시, 최종 `win-unpacked` EXE 실제 실행 smoke로 검증했다.
2. `Get-AuthenticodeSignature` 기준 두 EXE는 미서명이다. 증거: `.omo/evidence/v4-test-feedback-repair/final-authenticode-signature.json`
3. 스타일 매트릭스 hard gate는 통과하지만 advisory warning은 남아 있다. 다음 개선 시 body 카드 폰트 단계와 source 대비를 다듬으면 줄일 수 있다.
4. 대부분 파일이 아직 Git 추적 전 상태로 보인다. 후속 커밋 시 전체 diff를 다시 검토하고 `AGENTS.md`의 Lore Commit Protocol을 따라야 한다.

## 6-7. V5-1 빠른 수정 묶음 완료 (2026-07-07 Codex/ULW)

**기준 문서**: `.omc/plans/v5-completion-prd.md`

**구현 완료**:
- CSV 템플릿 BOM 검증: Excel에서 한글 헤더/본문이 깨지지 않도록 기존 BOM 계약을 테스트와 바이트 체크로 재확인했다.
- 폰트 문제는 PRD 지시대로 수정 전에 진단을 먼저 수행했다. 기존 라이브러리 폰트 `font-mraqlugy`로 UI 렌더 전/후를 비교했고, 이후 `@font-face` descriptor를 정리했다.
- 오프스크린 PNG 렌더러가 `document.fonts.ready` timeout을 실패로 처리하고, 선택 폰트가 있을 때 `Cardnews User Font` 로드를 명시 검증한다.
- Electron smoke에 `CARDNEWS_SMOKE_ACTION=render-with-font`를 추가해 실제 UI 폰트 셀렉트 선택, `document.fonts.check()`, PNG 생성을 한 번에 검증할 수 있게 했다.
- 배경 파일 추가와 Pixabay 다운로드는 라이브러리에만 추가하고 자동 적용하지 않도록 변경했다. 사용자가 목록에서 선택해야 적용된다.
- 상단/인스펙터 UI overflow guard를 보강하고, 긴 select 라벨이 잘리지 않도록 상단 select 폭을 고정했다.
- `@kkongdon_story` 크레딧을 앱 상단과 정보 모달, `usage.html`에 노출했고, 외부 링크는 allowlist IPC로만 열린다.

**증거**:
- V5-1 요약: `.omc/evidence/v5/v5-1-summary.md`
- 폰트 수정 전 진단: `.omc/evidence/v5/task-02-font-diagnosis.md`
- 폰트 수정 후 UI smoke: `.omc/evidence/v5/task-03-font-postfix-smoke.log`, `.omc/evidence/v5/task-03-font-postfix-check.txt`
- 배경 기본값 없음/자동 적용 방지: `.omc/evidence/v5/task-04-first-run-bg-none-check.txt`
- 표준 gate: `.omc/evidence/v5/task-v5-1-standard-gate.txt`
- style matrix: `.omc/evidence/v5/task-v5-1-style-matrix.txt`
- dev smoke: `.omc/evidence/v5/task-v5-1-dev-smoke.log`, `.omc/evidence/v5/smoke.png`, `.omc/evidence/v5/smoke.txt`

**다음 단계**: V5-2 문제6(세팅/프로젝트 명시적 저장·불러오기)부터 진행한다. Phase 완료 시 표준 검증 명령과 smoke를 다시 통과시킨 뒤 Lore Commit Protocol로 커밋한다.

## 6-8. V5-2 프로젝트 저장·불러오기 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v5-completion-prd.md`

**구현 완료**:
- `.cardnews` ZIP 프로젝트 파일을 추가했다. 포함 항목은 `manifest.json`, `workspace.json`, `presets.json`, `styles.json`, 참조된 `backgrounds/`, 참조된 `fonts/`이다.
- `src/storage/projectArchive.ts`에서 export/import를 분리했다. import 시 배경/폰트 id 충돌을 새 id로 remap하고, workspace/preset의 참조도 함께 갱신한다.
- Electron IPC `exportProject()` / `importProject()`를 추가했다. 저장/열기 OS dialog를 사용하고, 취소는 `invalid_input` 결과로 UI에 표시된다.
- 내보내기 탭에 `프로젝트 저장(.cardnews)`, `프로젝트 열기` 버튼을 추가했다.
- 순수 모듈 테스트 `src/storage/projectArchive.test.ts`를 추가해 workspace/preset/override/image layer 참조 수집과 manifest 누락 hard fail을 검증한다.
- `CARDNEWS_SMOKE_ACTION=project-roundtrip` smoke를 추가했다. 저장된 workspace가 없으면 smoke용 기본 workspace를 만든 뒤 `.cardnews` export/import를 수행하고, 빈 import-root에서 workspace와 참조 asset 복원을 검증한다.

**증거**:
- 표준 gate: `.omc/evidence/v5/task-v5-2-standard-gate.txt` — `10` files / `63` tests pass, build exit 0.
- style matrix: `.omc/evidence/v5/task-v5-2-style-matrix.txt` — exit 0, hardGate fail 없음. 기존 advisory `font_variety` 경고는 잔존.
- dev smoke: `.omc/evidence/v5/task-v5-2-dev-smoke.log`, `.omc/evidence/v5/smoke.png`, `.omc/evidence/v5/smoke.txt` — `CARDNEWS_SMOKE_ACTION=render-deck` exit 0.
- project roundtrip smoke: `.omc/evidence/v5/task-v5-2-project-smoke.log`, `.omc/evidence/v5/task-v5-2-project-smoke.txt`, `.omc/evidence/v5/task-v5-2-project-smoke.png` — `backgroundCount: 1`, `fontCount: 1`, imported workspace에 remapped 배경/폰트 참조 확인.

**다음 단계**: V5-3 문제4(레이어 캔버스 직접 편집) S1부터 진행한다. 레이어 기본값 수정 → 오버레이 선택/이동 → 리사이즈 → 인라인 텍스트 → 인스펙터 연동 순서로 구현하고, Phase 완료 시 표준 검증 명령과 smoke를 다시 통과시킨 뒤 커밋한다.

## 6-9. V5-3 레이어 캔버스 직접 편집 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v5-completion-prd.md`

**구현 완료**:
- 중앙 미리보기 위에 편집 모드 전용 투명 오버레이를 추가했다. iframe은 진실의 렌더 HTML로 유지하고, 편집 모드에서만 pointer events를 오버레이가 받는다.
- 레이어 클릭 선택, 드래그 이동, 8방향 리사이즈 핸들, 8px 스냅/Shift 해제, 중앙/세이프존 가이드를 구현했다.
- 텍스트 레이어 더블클릭 인라인 편집, blur/Ctrl+Enter 커밋, Esc 취소, 방향키 이동, Delete 삭제를 구현했다.
- 우측 디자인 탭에 선택 레이어 속성 패널을 연결했다. 텍스트 색/크기/굵기/기울임/정렬, 도형 색/형태, 선 색/두께, z순서를 조정할 수 있다.
- 신규 텍스트 레이어 기본값을 투명 배경, 현재 스타일 ink 색, 40px, 중앙 정렬로 바꿨다. 도형 기본값은 accent 20% 불투명 채움으로 조정했다.
- 레이어 텍스트의 품질 게이트 폰트 측정이 브라우저 computed style의 16px 폴백에 흔들리지 않도록 `data-font-size`와 style 속성 파서를 메트릭 계약에 추가했다.
- reset 시 레이어 선택/인라인 편집 상태를 함께 정리하고, `CARDNEWS_SMOKE_ACTION=edit-layer` smoke를 추가했다. 이 smoke는 실제 UI에서 리셋 → 편집 모드 → 텍스트 레이어 추가 → 드래그 이동 → 더블클릭 텍스트 수정 → PNG 생성까지 검증한다.

**증거**:
- 표준 gate: `.omc/evidence/v5/task-v5-3-standard-gate.txt` — typecheck exit 0, `10` files / `64` tests pass, build exit 0.
- style matrix: `.omc/evidence/v5/task-v5-3-style-matrix.txt` — exit 0, 모든 hardGate pass. 기존 advisory `font_variety` warning은 잔존.
- dev smoke: `.omc/evidence/v5/task-v5-3-dev-smoke.log`, `.omc/evidence/v5/smoke.png`, `.omc/evidence/v5/smoke.txt` — `CARDNEWS_SMOKE_ACTION=render-deck` exit 0.
- edit-layer smoke: `.omc/evidence/v5/task-v5-3-edit-layer-smoke.log`, `.omc/evidence/v5/task-v5-3-edit-layer-smoke.png`, `.omc/evidence/v5/task-v5-3-edit-layer-smoke.txt` — UI 텍스트 `직접 편집 완료`, 결과 `렌더 완료: 10장 (경고 8개)`.

**디버깅 감사**:
1. H1 stale workspace/reset race: `edit-layer` smoke가 이전 레이어를 함께 렌더해 hard fail이 났다. reset 이후 overlay 레이어 수 0 대기, 시작 안정화 대기, reset 시 선택/편집 상태 정리로 해소했다.
2. H2 smoke drag target collision: 레이어를 너무 위/아래로 이동시켜 header/footer와 overlap hard fail이 났다. 안전 영역 내부 y 이동값으로 조정해 `edit-layer` smoke가 렌더 완료까지 통과했다.
3. H3 layer font metric fallback: Chromium computed style이 레이어 텍스트를 16px로 보고 `font_floor` hard fail이 났다. 렌더 계약에 `data-font-size`와 style 속성 파서를 추가하고 단위 테스트로 고정했다.

**잔여 리스크 / 다음 개선 후보**:
1. V5-3 범위는 PRD대로 기본 슬롯이 아니라 사용자 추가 레이어만 직접 편집한다. 기본 제목/본문 슬롯 직접 편집은 후속 기능이다.
2. hard gate는 통과하지만 style matrix와 smoke에 advisory `font_variety` 경고가 남아 있다. 이 경고는 V5-1/V5-2부터 이어진 기존 스타일 경고이며 PNG 생성은 실패시키지 않는다.
3. 레이어 편집 UI는 마우스/키보드 기본 조작을 구현했지만, 멀티 선택/정렬 분배/복제 같은 Canva 고급 기능은 아직 없다.

## 6-10. V6 M1 선 끝점·크롬 편집 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v6-lite-pro-prd.md`

**구현 완료**:
- 선 레이어를 legacy rect+rotation 모델에서 endpoint 모델(`x1/y1/x2/y2/thickness`)로 전환했다. v5 workspace/preset/deck의 기존 선은 로드 경계에서 자동 마이그레이션된다.
- 선 렌더는 `buildCardHtml()` 단일 경로에서 endpoint→px segment로 계산되며, 미리보기와 PNG가 같은 HTML을 사용한다.
- 편집 오버레이는 선 선택 시 8방향 박스 핸들 대신 양 끝점 핸들과 선분 근접 hit-test를 사용한다. 몸통 드래그는 두 끝점을 함께 이동하고, 각도 입력은 중심 기준 endpoint 회전으로 반영된다.
- 헤더/멘션/페이지번호 chrome 설정 모델을 추가했다. 페이지번호 템플릿(`{n}`, `{n2}`, `{total}`), 색, 크기, 굵기, 오프셋, 표시 여부가 저장/복원된다.
- `deck.chrome`이 없을 때는 각 스타일 프리셋의 `chromeBackdrop` 대비에 맞춰 기본 chrome ink를 고른다. 사용자 chrome override는 스타일 매트릭스 smoke에서 제거해 프리셋 기본값을 독립 검증한다.
- style matrix의 hard contrast 기준에 맞게 `warmstudio`, `orangecards` muted/source 색을 보정했다.

**증거**:
- 최종 표준 gate:
  - `.omc/evidence/v6/m1/final-typecheck.log` — `npm run typecheck` exit 0
  - `.omc/evidence/v6/m1/final-test.log` — `npm test` exit 0
  - `.omc/evidence/v6/m1/final-build.log` — `npm run build` exit 0
- 최종 smoke:
  - `.omc/evidence/v6/m1/final-smoke-style-matrix.log` — style matrix exit 0
  - `.omc/evidence/v6/m1/final-smoke-layer-controls.log` — `layer-controls-regression` exit 0
  - `.omc/evidence/v6/m1/final-smoke-line-endpoint.log` — `line-endpoint-regression` exit 0
  - `.omc/evidence/v6/m1/final-smoke-chrome-style.log` — `chrome-style-regression` exit 0
- RED/GREEN 기록:
  - `.omc/evidence/v6/m1/red-r2-vitest.log`
  - `.omc/evidence/v6/m1/red-r1-chrome.log`
  - `.omc/evidence/v6/m1/test-r1-targeted.log`
  - `.omc/evidence/v6/m1/test-r1-render-default-fix.log`
  - `.omc/evidence/v6/m1/test-style-contrast-fix.log`

**다음 단계**: V6 M2를 PRD 순서대로 진행한다. 먼저 R4 콘텐츠 폼+명시적 줄바꿈을 TDD로 구현하고, 이어 R3 배지/배경제거, R5 넘김기호 커스텀 이미지까지 완료한 뒤 표준 gate와 milestone smoke를 통과시키고 커밋한다.

## 6-11. V6 M2 콘텐츠 폼·배지 확장·넘김기호 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v6-lite-pro-prd.md`

**구현 완료**:
- R4 콘텐츠 탭을 구조화 폼으로 승격했다. 유형/배지/제목/소제목/본문 문단/불릿/출처/강조를 필드로 편집하고, 원문 편집은 고급 토글로 유지한다.
- 라벨 값의 명시적 줄바꿈 문법을 추가했다. 필드 내부 줄바꿈은 원문에서 `|`로 직렬화되고, `\|`는 literal pipe로 보존되며, 미리보기/PNG는 같은 `buildCardHtml()`에서 `<br/>`로 렌더한다.
- 카드별 typography override에 `letterSpacing`, `lineHeight`, `scope`를 추가했다. UI 슬라이더와 저장/복원, 렌더 CSS가 연결되어 있다.
- R3 배지 override를 확장했다. 배지 모양(`pill`/`rect`/`none`), 이미지 배지, 이미지 높이, 이미지 라이브러리(`library/images`)를 지원한다.
- 색상 기반 배경 제거(`removeBackground`) 순수 모듈과 IPC를 추가했다. 모서리 배경색 flood-fill로 단색 배경을 제거하고 원본 이미지는 보존한다.
- 품질 게이트는 이미지 슬롯(`badge-image`, `next-hint-image`, `*-image`)에 대해 텍스트 대비/폰트 검사만 제외하고 safezone/overlap 검사는 유지한다.
- R5 deck-level `nextHint`를 추가했다. 기본 화살표, 이미지 선택, 없음 모드를 지원하며 마지막 카드는 모든 모드에서 넘김 기호를 렌더하지 않는다. 기존 마지막 카드 `■`도 제거했다.
- Electron smoke에 `content-form-regression`, `badge-background-removal-regression`, `next-hint-image-regression`을 추가했다.

**증거**:
- RED 기록:
  - `.omc/evidence/v6/m2/red-r4-content-form.log` — R4 구현 전 실패
  - `.omc/evidence/v6/m2/red-r3-badge-bgremoval.log` — R3 구현 전 실패
  - `.omc/evidence/v6/m2/red-r5-next-hint.log` — R5 구현 전 실패
- 최종 표준 gate:
  - `.omc/evidence/v6/m2/final-typecheck.log` — `npm run typecheck` exit 0
  - `.omc/evidence/v6/m2/final-test.log` — `npm test` exit 0, 13 files / 84 tests pass
  - `.omc/evidence/v6/m2/final-build.log` — `npm run build` exit 0
- 최종 smoke:
  - `.omc/evidence/v6/m2/final-smoke-style-matrix.log` — style matrix exit 0, 모든 hardGate pass
  - `.omc/evidence/v6/m2/final-smoke-layer-controls.log` — `layer-controls-regression` exit 0
  - `.omc/evidence/v6/m2/final-smoke-line-endpoint.log` — `line-endpoint-regression` exit 0
  - `.omc/evidence/v6/m2/final-smoke-chrome-style.log` — `chrome-style-regression` exit 0
  - `.omc/evidence/v6/m2/final-smoke-content-form.log` — `content-form-regression` exit 0
  - `.omc/evidence/v6/m2/final-smoke-badge-bgremoval.log` — `badge-background-removal-regression` exit 0
  - `.omc/evidence/v6/m2/final-smoke-next-hint.log` — `next-hint-image-regression` exit 0

**다음 단계**: V6 M3 R6 에디션 시스템을 시작한다. PRD §7의 Lite/Pro 매트릭스는 사용자 확정이므로 변경하지 말고, 빌드 타임 스트리핑 구조를 도입한 뒤 `scripts/verify-edition.mjs`와 `edition-lite-regression` smoke가 통과해야 M3 완료로 본다.

## 6-12. V6 M3 Lite/Pro 에디션 시스템 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v6-lite-pro-prd.md`

**구현 완료**:
- Renderer 진입점을 `@edition` alias로 분기했다. Pro 빌드는 기존 `src/ui/App.tsx`를, Lite 빌드는 새 `src/ui/LiteApp.tsx`를 가져온다.
- `src/domain/cardnews-api.ts`를 `LiteCardnewsApi`와 `ProCardnewsApi`로 분리했다. Lite preload는 Pro 메서드명을 노출하지 않고 공통 제작 기능과 잠금 요청만 제공한다.
- Lite 전용 Electron main(`electron/lite-main.ts`)을 추가했다. CSV 벌크, 프로젝트 파일, 이미지 배경 제거, Pro UI/AI 코드를 import하지 않으며 저장/렌더 경계에서 `stripPro*` 필터로 Pro 필드를 제거한다.
- `scripts/build-edition.mjs`를 추가했다. `build:pro`는 기존 전체 Electron 출력을 유지하고, `build:lite`는 renderer를 Lite alias로 빌드한 뒤 `dist-electron/electron/main.js`와 `preload.cjs`만 남기는 Lite bundle로 재구성한다.
- electron-builder 설정을 `electron-builder.pro.json`, `electron-builder.lite.json`으로 분리했다. appId/productName/artifactName이 Pro/Lite에서 분리되어 한 PC에 공존 가능한 설치 대상이 된다.
- `scripts/verify-edition.mjs`를 추가했다. Lite `dist`, `dist-electron`, packaged `app.asar`, `win-unpacked`를 스캔해 `renderBulkCsv`, `removeImageBackground`, `exportProject`, `aiChat`, `ProPanels` 등 Pro 전용 심볼이 남으면 실패한다.
- Lite UI에는 `data-smoke-role="edition-lock"` 잠금 패널과 Threads/Kakao 문의 링크를 유지했다. 잠금 요청은 `not_implemented`로 응답한다.

**증거**:
- RED 기록:
  - `.omc/evidence/v6/m3/red-r6-verify-edition.log` — 검증 스크립트 추가 전 실패
  - `.omc/evidence/v6/m3/red-r6-edition-smoke.log` — `edition-lite-regression` 추가 전 실패
- 최종 표준 gate:
  - `.omc/evidence/v6/m3/final-typecheck.log` — `npm run typecheck` exit 0
  - `.omc/evidence/v6/m3/final-test.log` — `npm test` exit 0, 13 files / 84 tests pass
  - `.omc/evidence/v6/m3/final-build.log` — `npm run build` exit 0
- Pro regression smoke:
  - `.omc/evidence/v6/m3/smoke-style-matrix-pro.log` — style matrix exit 0
  - `.omc/evidence/v6/m3/smoke-layer-controls-regression-pro.log` — exit 0
  - `.omc/evidence/v6/m3/smoke-line-endpoint-regression-pro.log` — exit 0
  - `.omc/evidence/v6/m3/smoke-chrome-style-regression-pro.log` — exit 0
  - `.omc/evidence/v6/m3/smoke-content-form-regression-pro.log` — exit 0
  - `.omc/evidence/v6/m3/smoke-badge-background-removal-regression-pro.log` — exit 0
  - `.omc/evidence/v6/m3/smoke-next-hint-image-regression-pro.log` — exit 0
- Lite/Pro 패키징:
  - Pro release direct build는 OneDrive `EPERM rename win-unpacked.tmp -> win-unpacked`로 실패했다. 증거: `.omc/evidence/v6/m3/dist-win-pro-first.log`
  - PRD §0.3 우회로 `LOCALAPPDATA` 출력 사용:
    - Pro: `C:\Users\js480\AppData\Local\cardnews-release-pro\Cardnews-Studio-Pro-Setup-1.0.0.exe`
    - Pro unpacked: `C:\Users\js480\AppData\Local\cardnews-release-pro\win-unpacked\Cardnews Studio Pro.exe`
    - Lite: `C:\Users\js480\AppData\Local\cardnews-release-lite\Cardnews-Studio-Lite-Setup-1.0.0.exe`
    - Lite unpacked: `C:\Users\js480\AppData\Local\cardnews-release-lite\win-unpacked\Cardnews Studio Lite.exe`
  - `.omc/evidence/v6/m3/dist-win-pro-local.log` — Pro NSIS build exit 0
  - `.omc/evidence/v6/m3/dist-win-lite-local.log` — Lite NSIS build exit 0
  - `.omc/evidence/v6/m3/verify-edition-dist-first.log` — Lite dist/dist-electron stripping 검증 exit 0
  - `.omc/evidence/v6/m3/verify-edition-lite-package.log` — Lite packaged `app.asar`/`win-unpacked` stripping 검증 exit 0
  - `.omc/evidence/v6/m3/smoke-pro-exe.log` — 실제 Pro unpacked EXE `chrome-style-regression` exit 0
  - `.omc/evidence/v6/m3/smoke-lite-exe.log` — 실제 Lite unpacked EXE `edition-lite-regression` exit 0

**주의 / 다음 단계**:
1. M3 완료 시점의 루트 `release/`에는 OneDrive EPERM 실패 전 v1 산출물과 `win-unpacked.tmp`가 남아 있을 수 있다. 최종 M5에서 PRD §0.3 방식으로 `LOCALAPPDATA`에 빌드한 뒤 필요한 설치 파일/무설치 폴더를 `release/`로 복사해 최종 산출물을 갱신해야 한다.
2. M3의 Lite 스트리핑은 packaged `app.asar` 기준으로 Pro 실행 심볼 부재를 자동 검증했다. 후속 M4 AI는 반드시 `ProCardnewsApi`/Pro main 쪽에만 추가하고, Lite verify forbidden list에 `ai:*`/AI handler 심볼을 유지해야 한다.
3. 다음 구현은 V6 M4 R7 프로그램 내 AI(Pro 전용)이다. CLI 실행은 stdin 전달/allowlist provider/AI 출력 parse-only 원칙을 지켜야 한다.

## 6-13. V6 M4 Pro 전용 AI 초안 생성 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v6-lite-pro-prd.md`

**구현 완료**:
- Pro API에만 `listAiProviders()`와 `runAiChat()`을 추가했다. Lite API/preload/main에는 AI IPC를 추가하지 않았다.
- Pro 전용 AI 어댑터 `electron/ai/cliAdapters.ts`를 추가했다. provider allowlist는 `claude`, `codex`, `gemini`이며, 프롬프트는 stdin으로만 전달한다. AI 결과는 실행하지 않고 `parseDeckDocument()`로만 해석한다.
- provider status는 버전 명령으로 감지하고, 미설치 시 install hint를 UI에 보여준다. `CARDNEWS_MOCK_AI=1`에서는 네트워크/로그인 없이 결정적 10장 `양식.md` 초안을 반환한다.
- 내보내기 탭에 Pro AI 패널을 추가했다. 주제/리서치/대본 프리셋, 자유 채팅, AI 초안 textarea, 초안 적용, 이미지 생성 프롬프트 복사 버튼을 제공한다.
- `src/edition/pro/ai/aiPrompts.ts`에 프롬프트 빌더, fenced template 추출, mock draft 생성을 분리하고 단위 테스트로 고정했다.
- `scripts/verify-edition.mjs`의 Lite 금지 심볼 목록에 AI IPC/handler/API 명칭을 추가했다.
- `CARDNEWS_SMOKE_ACTION=ai-draft-regression` smoke를 추가해 AI 패널 열기 -> mock 초안 생성 -> 10장 파싱/적용 -> PNG 렌더 완료를 검증한다.

**증거**:
- 표준 gate:
  - `.omc/evidence/v6/m4/final-typecheck.log` — `npm run typecheck` exit 0
  - `.omc/evidence/v6/m4/final-test.log` — `npm test` exit 0, 14 files / 87 tests pass
  - `.omc/evidence/v6/m4/final-build.log` — `npm run build` exit 0
- Pro regression smoke:
  - `.omc/evidence/v6/m4/smoke-style-matrix-pro.log` — style matrix exit 0, 모든 hardGate pass
  - `.omc/evidence/v6/m4/smoke-layer-controls-regression-pro.log` — `layer-controls-regression` exit 0
  - `.omc/evidence/v6/m4/smoke-ai-draft-regression-pro.log` — `ai-draft-regression` + `CARDNEWS_MOCK_AI=1` exit 0
- Lite stripping:
  - `.omc/evidence/v6/m4/build-lite.log` — `npm run build:lite` exit 0
  - `.omc/evidence/v6/m4/verify-edition-lite-dist.log` — `dist`/`dist-electron` Lite 금지 심볼 스캔 exit 0
  - `.omc/evidence/v6/m4/smoke-edition-lite-regression.log` — `edition-lite-regression` exit 0
- Diff safety:
  - `.omc/evidence/v6/m4/git-diff-check.log` — `git diff --check` exit 0

**디버깅 감사**:
1. H1 NodeNext 포함/확장자 문제: AI 프롬프트 모듈과 Electron AI 어댑터가 `tsconfig.node.json` 범위 밖이라 typecheck가 실패했다. node tsconfig include에 Pro AI/Electron AI 파일을 추가하고 NodeNext 요구에 맞춰 `.js` import를 사용해 해소했다.
2. H2 AI smoke 클릭 타이밍 문제: smoke가 AI 패널이 실제로 열린 뒤 버튼을 누르지 않아 첫 실행이 timeout 됐다. `ai-draft-regression`에서 export panel/AI panel visibility를 기다린 뒤 클릭하도록 수정해 통과했다.
3. H3 Node shell 경고 문제: `shell: true`와 args 배열 조합이 Node `DEP0190` 경고를 냈다. provider별 고정 command string과 stdin prompt 전달로 바꿔 경고 없는 smoke를 확보했다.

**주의 / 다음 단계**:
1. M4는 실제 로그인된 Claude/Codex/Gemini 응답까지 검증하지 않았다. UI-파서-렌더 경로는 `CARDNEWS_MOCK_AI=1`로 결정적으로 검증했다.
2. 다음 단계는 V6 M5 보안 점검/버전 2.0.0/최종 설치 파일 생성이다. M5에서 `release/` 산출물을 최종 갱신하고, packaged Lite `app.asar`까지 `verify-edition.mjs`로 다시 검사해야 한다.

## 6-14. V6 M5 보안 점검·2.0.0 릴리즈 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v6-lite-pro-prd.md`

**구현 완료**:
- `package.json`과 `package-lock.json` 버전을 `2.0.0`으로 올렸다.
- 보안 회귀 테스트를 보강했다.
  - pageNumber template은 `escapeHtml()` 경유로 raw HTML이 렌더되지 않는다.
  - malicious image id 문자열은 HTML에 raw markup으로 노출되지 않는다.
  - 코드/스크립트 형태 AI 응답은 `parseDeckDocument()`에서 deck 문서로 승인되지 않는다.
- §9 보안 체크리스트별 증거를 `.omc/evidence/v6/security/` 아래에 남겼다.
- OneDrive `release/` 직접 빌드 rename 문제를 피하기 위해 PRD §0.3 방식대로 `%LOCALAPPDATA%`에 Pro/Lite NSIS를 만든 뒤, 최종 산출물을 프로젝트 `release/`로 복사했다.

**최종 산출물 위치**:
- Pro 설치파일: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\release\Cardnews-Studio-Pro-Setup-2.0.0.exe`
- Lite 설치파일: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\release\Cardnews-Studio-Lite-Setup-2.0.0.exe`
- Pro 무설치: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\release\win-unpacked-pro-2.0.0\Cardnews Studio Pro.exe`
- Lite 무설치: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\release\win-unpacked-lite-2.0.0\Cardnews Studio Lite.exe`

**증거**:
- 보안 체크리스트 요약: `.omc/evidence/v6/security/checklist.md`
- 표준 gate:
  - `.omc/evidence/v6/security/final-typecheck.log` — `npm run typecheck` exit 0
  - `.omc/evidence/v6/security/final-test.log` — `npm test` exit 0
  - `.omc/evidence/v6/security/final-build-pro.log` — `npm run build` exit 0
  - `.omc/evidence/v6/security/final-build-lite.log` — `npm run build:lite` exit 0
- 보안/감사:
  - `.omc/evidence/v6/security/security-targeted-tests.log` — 보강 테스트 exit 0
  - `.omc/evidence/v6/security/ipc-audit.log`
  - `.omc/evidence/v6/security/style-safety-audit.log`
  - `.omc/evidence/v6/security/path-safety-audit.log`
  - `.omc/evidence/v6/security/open-external-audit.log`
  - `.omc/evidence/v6/security/ai-security-audit.log`
  - `.omc/evidence/v6/security/electron-security-audit.log`
  - `.omc/evidence/v6/security/npm-audit-high.log` — high 이상 audit exit 0
- 패키징:
  - `.omc/evidence/v6/security/dist-win-pro-local.log` — Pro NSIS exit 0
  - `.omc/evidence/v6/security/dist-win-lite-local.log` — Lite NSIS exit 0
  - `.omc/evidence/v6/security/final-release-artifacts.txt` — `release/` 산출물 크기 기록
- Lite 스트리핑:
  - `.omc/evidence/v6/security/verify-edition-lite-package.log` — `%LOCALAPPDATA%` Lite package scan exit 0
  - `.omc/evidence/v6/security/manual-asar-grep-lite.log` — Lite `app.asar` 금지 문자열 수동 스캔 hits 없음
  - `.omc/evidence/v6/security/verify-edition-release-lite.log` — `release/` Lite package scan exit 0
- 실제 exe smoke:
  - `.omc/evidence/v6/security/smoke-pro-exe-ai-draft.log` — local Pro unpacked AI draft smoke exit 0
  - `.omc/evidence/v6/security/smoke-lite-exe-edition.log` — local Lite unpacked edition smoke exit 0
  - `.omc/evidence/v6/security/smoke-release-pro-exe-ai-draft.log` — copied `release/` Pro exe smoke exit 0
  - `.omc/evidence/v6/security/smoke-release-lite-exe-edition.log` — copied `release/` Lite exe smoke exit 0

**주의 / 잔여 리스크**:
1. 실제 로그인된 Claude/Codex/Gemini CLI 호출은 환경 의존이라 최종 gate에서는 mock AI로 검증했다. provider 감지/실행 코드는 allowlist와 stdin 전달로 고정되어 있다.
2. 기존 v1 산출물은 사용자가 비교할 수 있도록 삭제하지 않았다. 최종 실행 대상은 위의 `2.0.0` Pro/Lite 산출물이다.
3. Lite/Pro 매트릭스는 PRD §1 확정안 그대로 유지했다. 애매한 신규 AI 기능은 Pro 전용으로 두었다.

## 6-15. V6 M6 Lite UI 공용 셸 재구성 완료 (2026-07-08 Codex)

**기준 문서**: `.omc/plans/v6-m6-lite-ui-spec.md`, `.omc/plans/v6-lite-pro-prd.md` §0·§1

**구현 완료**:
- 이전 partial stash `stalled-m6-partial-1832`의 방향이 spec과 맞아 `src/edition/lite`, `src/edition/pro`, `src/ui/App.tsx`, `src/ui/main.tsx` 변경을 재사용했다.
- `src/ui/main.tsx`는 공용 `src/ui/App.tsx`를 직접 mount한다. `src/ui/LiteApp.tsx` 별도 축소 UI는 제거했다.
- `src/edition/pro/index.tsx`는 Pro IPC/API wrapper와 AI prompt helper를 제공하고, `src/edition/lite/index.tsx`는 동일 시그니처의 잠금/`not_implemented` stub을 제공한다.
- Lite도 Pro와 같은 slide rail, stage preview, inspector tab/topbar/content form/export flow를 사용한다. Pro 전용 자리(카드 디자인, 크롬 스타일, 편집 오버레이, 이미지 배지/배경 제거, 넘김기호 이미지, 프로젝트, CSV, AI)는 `data-smoke-role="edition-lock"` stub으로 렌더된다.
- Lite stage는 preview-only `PreviewCanvas`를 타고, Pro는 기존 `StageCanvas` overlay를 유지한다.
- `edition-lite-regression` smoke가 Lite shell 구조, lock stub 8종, 잠금 IPC `not_implemented`, Lite preload의 Pro API 미노출을 검증하도록 보강했다.
- `edition-lite-basic-flow` smoke를 추가해 Lite에서 스타일 변경 -> 콘텐츠 제목 편집 -> PNG 생성까지 확인한다.

**증거** (`.omc/evidence/v6/m6-lite-ui/`):
- 표준 gate:
  - `typecheck-final-before-smokes.log` — `npm run typecheck` exit 0
  - `test-final.log` — `npm test` exit 0
  - `build-pro-final.log` — `npm run build` exit 0
  - `build-lite-final.log` — `npm run build:lite` exit 0
- Lite 스트리핑:
  - `verify-edition-lite-final.log` — final Lite `dist`/`dist-electron` scan exit 0
- Pro 회귀 smoke:
  - `smoke-pro-layer-controls-regression.log` — `layer-controls-regression` exit 0
  - `smoke-pro-chrome-style-regression.log` — `chrome-style-regression` exit 0
  - `smoke-pro-content-form-regression.log` — `content-form-regression` exit 0
- Lite smoke:
  - `smoke-edition-lite-regression-final.log` — `edition-lite-regression` exit 0
  - `smoke-edition-lite-basic-flow-final.log` — `edition-lite-basic-flow` exit 0

**주의 / 잔여 리스크**:
1. 이번 M6는 설치 파일 재패키징 범위가 아니다. 최종 배포 산출물 갱신이 필요하면 M5의 `%LOCALAPPDATA%` 우회 절차를 다시 사용한다.
2. stash는 안전하게 `apply`로 재사용했다. 최종 diff에 반영되어 있으므로 이후 필요 없으면 별도 정리해도 된다.

## 6-16. V6 M7/M8 Pro AI 챗봇·이미지 피커 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omc/plans/v6-m7-m8-spec.md`, `.omc/plans/v6-lite-pro-prd.md` §0·§1

**구현 완료**:
- M7 Pro AI를 내보내기 탭 패널에서 상단바 AI 버튼 기반 오른쪽 slide-over로 옮겼다. 대화 thread, reset, provider select/status/refresh, install hint 복사, preset chip(topic/research/draft/image), multiline composer, loading/error/retry, mock `양식.md` 감지/적용 UI를 제공한다.
- AI 전송은 최근 12턴만 CLI에 전달하고 UI thread는 전체를 유지한다. `CARDNEWS_MOCK_AI=1`은 결정적 10장 `양식.md` 응답을 반환한다.
- Lite에서는 AI topbar 버튼이 잠금 drawer/stub으로 표시되며, Pro AI 실행 심볼은 Lite dist 검증 대상이다.
- M8 공용 이미지 피커 modal을 추가했다. 배지 이미지, 다음 힌트 이미지, 이미지 레이어 source가 파일명 dropdown 대신 썸네일 grid, 파일 추가, 배경 제거, 선택/해제/닫기 흐름을 사용한다.
- Electron `getImagePreview()`는 512px 폭 기준 JPEG data URL을 반환하고 renderer가 preview cache를 관리한다.
- `CardBadgeOverride.textColor?: string`을 추가하고 `#rrggbb`만 저장/로드/렌더되도록 검증했다. UI에는 스타일 기본값, swatch, custom hex 입력을 제공한다.
- `badge-background-removal-regression`, `next-hint-image-regression`, `ai-draft-regression`, `edition-lite-regression` smoke를 M7/M8 흐름에 맞춰 보강했다. 이미지 피커 smoke는 누적된 동일 표시 이름 이미지가 있어도 실제 선택한 `data-smoke-image-id`로 렌더 HTML을 검증한다.

**변경 파일**:
- `src/ui/App.tsx` — AI slide-over, 이미지 피커 modal, 배지 textColor UI, Pro/Lite 잠금 흐름.
- `src/ui/styles.css` — AI drawer, image picker, preview/swatch 스타일.
- `electron/main.ts` — 이미지 preview JPEG IPC, M7/M8 smoke, render output 검증.
- `electron/lite-main.ts` — Lite regression smoke가 AI lock drawer까지 검증.
- `src/domain/types.ts`, `src/storage/deckStore.ts`, `src/render-engine/cardTemplate.ts` — badge textColor type/validation/render support.
- `src/storage/deckStore.test.ts`, `src/render-engine/cardTemplate.test.ts` — badge textColor 저장/렌더 회귀 테스트.

**증거**:
- 표준 gate:
  - `.omc/evidence/v6/m8-image-picker-badge/typecheck-after-next-hint-id.log` — `npm run typecheck` exit 0
  - `.omc/evidence/v6/m8-image-picker-badge/test-final.log` — `npm test` exit 0, 14 files / 91 tests pass
  - `.omc/evidence/v6/m8-image-picker-badge/build-pro-final.log` — final `npm run build` exit 0, Pro dist로 마무리
  - `.omc/evidence/v6/m8-image-picker-badge/build-lite-final.log` — `npm run build:lite` exit 0
- Lite 스트리핑:
  - `.omc/evidence/v6/m8-image-picker-badge/verify-edition-lite-final.log` — Lite `dist`/`dist-electron` forbidden-symbol scan exit 0
  - `.omc/evidence/v6/m8-image-picker-badge/edition-lite-regression-final.log` — `edition-lite-regression` exit 0
- M7/M8 smoke:
  - `.omc/evidence/v6/m7-ai-chatbot/ai-draft-regression.log` — `CARDNEWS_SMOKE_ACTION=ai-draft-regression CARDNEWS_MOCK_AI=1` exit 0
  - `.omc/evidence/v6/m8-image-picker-badge/badge-background-removal-regression.log` — `badge-background-removal-regression` exit 0
  - `.omc/evidence/v6/m8-image-picker-badge/next-hint-image-regression.log` — `next-hint-image-regression` exit 0
- Pro 회귀 smoke:
  - `.omc/evidence/v6/m8-image-picker-badge/layer-controls-regression.log` — `layer-controls-regression` exit 0
  - `.omc/evidence/v6/m8-image-picker-badge/chrome-style-regression.log` — `chrome-style-regression` exit 0
  - `.omc/evidence/v6/m8-image-picker-badge/content-form-regression.log` — `content-form-regression` exit 0

**디버깅 감사**:
1. H1 Smoke가 잘못된 탭을 열었다: `open-badge-image-picker`가 `inspector-design`에는 없고 `inspector-content` -> `card-design-tab` 안에 있어 첫 배지 smoke가 target not found로 실패했다. 기존 layer smoke와 같은 tab 경로로 바꿔 UI target을 찾고 smoke가 다음 단계까지 진행됨을 확인했다.
2. H2 렌더 HTML이 `no-bg` 표시 이름을 보존하지 않는다: image library는 displayName과 실제 저장 path를 분리하고 HTML은 `img-*.png` ID path를 사용한다. 피커 버튼에 `data-smoke-image-id`를 노출하고 smoke가 처리 이미지 ID를 HTML에서 검증하도록 바꿔 배지 background removal smoke exit 0을 확인했다.
3. H3 누적 테스트 이미지가 source.id 검증을 흔든다: 같은 `next-hint-smoke.png` 표시 이름의 과거 이미지가 library에 남으면 smoke가 새 source가 아닌 기존 썸네일을 선택할 수 있다. 실제 선택한 썸네일 ID를 반환/검증하도록 바꿔 next hint image smoke exit 0을 확인했다.

**주의 / 잔여 리스크**:
1. 실제 로그인된 Claude/Codex/Gemini CLI 응답은 환경 의존이라 이번 M7 gate도 mock AI로 UI-파서-렌더 경로를 검증했다. Provider status/install hint와 stdin 전달 경계는 유지된다.
2. `build:lite`는 `dist`를 Lite로 덮는다. 최종 작업에서는 `verify-edition lite` 후 다시 `npm run build`를 실행해 현재 루트 `dist`를 Pro 기준으로 되돌렸다.
3. 이미지 preview는 spec대로 JPEG thumbnail이다. 배경 제거 결과의 투명도는 preview가 아니라 원본 PNG render path에서 유지된다.
4. 이번 M7/M8은 설치 파일 재패키징 범위가 아니다. 배포 EXE 갱신이 필요하면 M5의 `%LOCALAPPDATA%` 우회 빌드 후 `release/` 복사 절차를 다시 사용한다.

## 6-17. V6 M9 테스트 피드백 버그 수정 완료 (2026-07-08 Codex/ULW)

**기준 문서**: `.omx/plans/prd-v6-m9-test-feedback-bugfixes.md`, `.omx/plans/test-spec-v6-m9-test-feedback-bugfixes.md`

**구현 완료**:
- R1: 오른쪽 inspector 하단 잘림을 줄이기 위해 scroll padding/bottom spacing을 보강했다.
- R1 후속: smoke 전용 content-size 창 주입을 추가해 `1365x768`, `1920x1080`, `2560x1440` inspector viewport matrix PNG를 정확한 크기로 남겼다.
- R2/R5: `멘션` 용어를 `푸터`로 통일하고, `@kkongdon_story`처럼 앞의 `@`가 저장/렌더에서 사라지지 않게 수정했다. 기존 `멘션:` 양식도 하위 호환으로 계속 파싱한다.
- R2 후속: `footerAccount`는 표시/저장값으로 유지하고, Threads URL은 `normalizeThreadsHandle()`/`createThreadsProfileUrl()`로만 파생한다. Electron 외부 링크 허용도 고정 URL Set 대신 안전한 Threads profile URL 검증으로 바꿨다.
- R3: 페이지 형식을 raw template 입력 대신 5개 preset dropdown으로 변경했다: `1 / N`, `1/N`, `1-N`, `01 / N`, `1장 / N장`.
- R4: 배지 텍스트의 강제 대문자화를 제거했고, 제목/소제목 입력에서 space 입력이 씹히지 않는 smoke를 추가했다.
- R5/R7: 이미지 피커가 내부 smoke/test asset(`badge-smoke-source`, `next-hint-smoke`)을 숨기도록 필터링하고, 선택한 이미지 id로 badge/next-hint 렌더 HTML을 검증하도록 smoke를 보강했다.
- R6: 배경 제거 허용치가 처리 결과 displayName에 반영되도록 하고, 배지 이미지 배경 제거 후 실제 처리 이미지가 렌더에 사용되는지 검증했다.
- R8: AI preset을 `research`/`image`/`draft` 모드로 명시 분리했다. research/image 응답은 카드 적용 UI로 오인되지 않고, mock AI는 최신 사용자 메시지의 첫 `모드:` 선언만 보고 응답한다.
- Lite: 공통 버그는 shared UI로 함께 반영되며, 이미지/AI Pro 기능은 Lite에서 잠금/스트리핑 검증을 통과했다.

**변경 파일**:
- UI/Smoke: `src/ui/App.tsx`, `src/ui/styles.css`, `electron/main.ts`
- AI: `electron/ai/cliAdapters.ts`, `src/edition/pro/ai/aiPrompts.ts`, `src/edition/pro/ai/aiPrompts.test.ts`
- Domain/Storage/Render: `src/domain/chromeConfig.ts`, `src/domain/deckImporter.ts`, `src/domain/socialLinks.ts`, `src/storage/deckStore.ts`, `src/render-engine/cardTemplate.ts`
- Tests: `src/domain/chromeConfig.test.ts`, `src/domain/deckImporter.test.ts`, `src/domain/socialLinks.test.ts`, `src/storage/deckStore.test.ts`, `src/render-engine/cardTemplate.test.ts`, `src/render-engine/backgroundRemoval.test.ts`

**증거 위치**: `.omc/evidence/v6/m9-test-feedback-bugfixes/verification-summary.md`

**주요 RED/디버깅 기록**:
- `red-unit.log` — 구현 전 targeted unit test 실패.
- `smoke-badge-background-removal.log` — 리로드 직후 workspace restore와 reset 경합으로 기존 사용자 배경/레이어가 살아나 품질 게이트 실패. `data-smoke-workspace-ready`와 reset settled 조건으로 수정 후 `smoke-badge-background-removal-pass2.log` 및 final pass2 smoke 통과.
- `smoke-image-picker-hygiene.log` — 이미지 라이브러리 비동기 refresh 전에 grid를 읽어 실패. visible source가 나타날 때까지 기다리도록 수정 후 `smoke-image-picker-hygiene-pass2.log` 통과.
- `smoke-ai-preset-mode.log` — mock AI가 전체 대화 history에서 오래된 `모드: research/image`를 먼저 읽어 draft를 오판. 최신 user message의 첫 `모드:`만 판정하도록 수정 후 `smoke-ai-preset-mode-pass2.log` 통과.
- `final-smoke-chrome-style-regression.log` — page format select에 input setter를 호출해 `Illegal invocation`. select/input 공용 setter로 수정 후 final pass2 smoke 통과.

**최종 자동 검증**:
- `final-typecheck.log` — `npm run typecheck` exit 0
- `final-npm-test.log` — `npm test` exit 0
- `final-build-pro-pass2.log` — Pro build exit 0
- `final-build-lite.log` — Lite build exit 0
- `final-verify-edition-lite.log` — Lite `dist`/`dist-electron` forbidden-symbol scan exit 0
- `final-smoke-edition-lite-regression.log` — Lite lock/regression smoke exit 0
- `final-smoke-pass2-*.log` — Pro smoke 11종 모두 exit 0:
  `footer-display-regression`, `page-format-dropdown-regression`, `content-input-latency-regression`, `inspector-layout-regression`, `image-picker-library-hygiene-regression`, `badge-background-removal-regression`, `next-hint-image-regression`, `layer-controls-regression`, `chrome-style-regression`, `content-form-regression`, `ai-preset-mode-regression`(`CARDNEWS_MOCK_AI=1`)
- `final-build-pro-restored.log` — Lite 검증 후 최종 로컬 `dist`/`dist-electron`을 Pro 기준으로 복원, exit 0
- `final-pass-log-audit.log` — final pass 로그에서 제품 실패 마커 없음. Electron/Chromium GPU cache 경고는 exit-code gate 기준 비치명 경고로 분류.

**Reviewer 후속 보강 / 최종 증거**:
- `reviewfix-typecheck-8.log` — reviewer 후속 수정 이후 `npm run typecheck` exit 0
- `reviewfix-npm-test.log` — `npm test` exit 0, 14 files / 97 tests passed
- `reviewfix-final-typecheck.log` — 문서 반영 이후 최종 `npm run typecheck` exit 0
- `reviewfix-final-npm-test.log` — 문서 반영 이후 최종 `npm test` exit 0, 14 files / 97 tests passed
- `reviewfix-build-pro-pass7.log` — page/content smoke 보강 이후 Pro build exit 0
- `reviewfix-smoke-pass4-*.log` — Pro smoke 11종 모두 explicit PASS:
  `footer-display-regression`, `page-format-dropdown-regression`, `content-input-latency-regression`, `inspector-layout-regression`, `image-picker-library-hygiene-regression`, `badge-background-removal-regression`, `next-hint-image-regression`, `layer-controls-regression`, `chrome-style-regression`, `content-form-regression`, `ai-preset-mode-regression`(`CARDNEWS_MOCK_AI=1`)
- `manual-smoke-page-format-dropdown-regression.txt/.png` — 페이지 형식 5개 preset 모두의 실제 렌더 값과 화면 캡처
- `manual-smoke-content-input-latency-regression.txt/.png` — 공백 포함 제목 입력값과 raw card sync, 화면 캡처
- `manual-smoke-content-input-latency-regression-reviewfix2.txt/.png` — Chromium `Input.insertText`로 제목/소제목 양쪽의 공백 포함 값과 raw card sync 검증
- `reviewfix2-loc-audit.log`, `reviewfix2-slop-grep.log` — `remove-ai-slops`/`programming` 기준 후속 감사 자료
- `reviewfix-build-lite-final.log` — Lite build exit 0
- `reviewfix-verify-edition-lite-final.log` — Lite `dist`/`dist-electron` forbidden-symbol scan exit 0
- `reviewfix-lite-built-main-smoke-routing-final.log` — 빌드된 Lite main에 `edition-lite-regression` smoke route 존재 확인
- `reviewfix-smoke-edition-lite-regression-final.log` — Lite lock/regression smoke explicit PASS
- `reviewfix-build-pro-restored.log` — Lite 검증 후 최종 로컬 `dist`/`dist-electron`을 다시 Pro 기준으로 복원, exit 0
- `reviewfix-git-diff-check.log` — `git diff --check` exit 0, LF/CRLF 경고만 있음
- `reviewfix-final-log-failure-marker-audit.log` — final reviewfix/manual smoke 로그에서 실패 마커 없음
- `reviewfix2-final-typecheck.log` — 제목/소제목 입력 smoke 보강 이후 최종 `npm run typecheck` exit 0
- `reviewfix2-final-npm-test.log` — 제목/소제목 입력 smoke 보강 이후 최종 `npm test` exit 0, 14 files / 97 tests passed
- `reviewfix2-smoke-pass1-*.log` — Pro smoke 11종 모두 explicit PASS
- `reviewfix2-build-lite-final.log` — 최종 Lite build exit 0
- `reviewfix2-verify-edition-lite-final.log` — 최종 Lite strip verification exit 0
- `reviewfix2-lite-built-main-smoke-routing-final.log` — 최종 빌드된 Lite main에 `edition-lite-regression` route 존재 확인
- `reviewfix2-smoke-edition-lite-regression-final.log` — 최종 Lite smoke explicit PASS
- `reviewfix2-build-pro-restored.log` — 최종 로컬 `dist`/`dist-electron` Pro 기준 복원, exit 0
- `reviewfix2-final-git-diff-check.log` — `git diff --check` exit 0, LF/CRLF 경고만 있음
- `reviewfix2-final-log-failure-marker-audit.log` — 최종 reviewfix2 로그에서 실패 마커 없음
- `reviewfix3-build-pro-viewport-hidden.log` — smoke 전용 hidden content-size 창 설정 후 Pro build exit 0
- `manual-inspector-layout-1365x768.log/.txt/.png` — inspector layout smoke explicit PASS, PNG IHDR `1365x768`
- `manual-inspector-layout-1920x1080.log/.txt/.png` — inspector layout smoke explicit PASS, PNG IHDR `1920x1080`
- `manual-inspector-layout-2560x1440.log/.txt/.png` — inspector layout smoke explicit PASS, PNG IHDR `2560x1440`
- `reviewfix3-final-typecheck.log` — 최종 `npm run typecheck` exit 0
- `reviewfix3-final-npm-test.log` — 최종 `npm test` exit 0, 15 files / 99 tests passed
- `reviewfix3-final-build-pro.log` — 최종 Pro build exit 0
- `reviewfix3-smoke-pass1-*.log` — 최종 Pro smoke 11종 모두 explicit PASS
- `reviewfix3-final-build-lite.log` — 최종 Lite build exit 0
- `reviewfix3-final-verify-edition-lite.log` — 최종 Lite `dist`/`dist-electron` forbidden-symbol scan exit 0
- `reviewfix3-lite-built-main-smoke-routing.log` — 빌드된 Lite main에 `edition-lite-regression` smoke route 존재 확인
- `reviewfix3-smoke-edition-lite-regression.log` — 최종 Lite lock/regression smoke explicit PASS
- `reviewfix3-final-build-pro-restored.log` — Lite 검증 후 최종 로컬 `dist`/`dist-electron` Pro 기준 복원, exit 0
- `reviewfix3-final-git-diff-check.log` — `git diff --check` exit 0
- `reviewfix3-final-log-failure-marker-audit.log` — known Chromium cache noise 제외 후 제품 실패 마커 없음
- `reviewfix3-loc-audit.log`, `reviewfix3-slop-grep.log` — 최신 `remove-ai-slops`/`programming` 기준 보조 감사 자료. slop grep은 의도된 smoke PASS stdout만 매칭.

**추가 인수인계 자료**:
- `.omc/evidence/v6/m9-test-feedback-bugfixes/manual-qa-matrix.md` — R1-R8/T1-T9 요구사항별 증거 매핑
- `.omc/evidence/v6/m9-test-feedback-bugfixes/debugging-audit.md` — 3개 디버깅 가설과 런타임 증거
- `.omc/evidence/v6/m9-test-feedback-bugfixes/code-review.md` — 최종 코드 리뷰 체크, 테스트 과적합 검토, 잔여 리스크
- `.omc/evidence/v6/m9-test-feedback-bugfixes/final-gate-review.md` — R1-R8/T1-T9 최종 PASS 게이트 리뷰

**주의 / 다음 단계**:
1. 사용자 요청대로 이번 M9에서는 EXE 패키징을 하지 않았다. 배포용 설치 파일 갱신은 별도 단계에서 M5의 `%LOCALAPPDATA%` 우회 빌드 절차를 재사용한다.
2. 실제 로그인된 AI CLI 응답은 환경 의존이라 `CARDNEWS_MOCK_AI=1`로 UI-프롬프트-파서 분기와 draft 적용 여부를 검증했다.
3. 현재 final local build는 Pro 기준이다. Lite 스트리핑 검증은 최종적으로 `reviewfix3-final-build-lite.log` -> `reviewfix3-final-verify-edition-lite.log` -> `reviewfix3-smoke-edition-lite-regression.log` 순서의 증거로 남아 있다.

## 6-18. V6 M10 AI 워크플로·입력·레이아웃 후속 수정 완료 (2026-07-09 Codex/ULW)

**기준 문서**: `.omx/plans/prd-v6-m10-ai-workflow-input-layout.md`, `.omx/plans/test-spec-v6-m10-ai-workflow-input-layout.md`

**구현 완료**:
- R1: 제목/소제목 textarea의 끝 공백과 줄바꿈이 입력 중/저장 후 사라지지 않도록 `src/domain/cardParser.ts`의 structured label normalization 경계를 수정했다. textarea newline은 저장/렌더 경계에서 기존 `|` convention으로 직렬화된다.
- R2: `콘텐츠 -> 디자인` 하단 스크롤에서 흰색 rounded panel이 lower controls를 자르는 문제를 `src/ui/styles.css`의 `panel.grow` 동작과 smoke 대상 selector 보강으로 해결했다. 스모크는 실제 design-panel 하단 버튼을 `data-smoke-action`으로 직접 잡는다.
- R3: `electron/ai/cliAdapters.ts`에 testable provider command builder를 추가했다. Codex는 `codex exec --skip-git-repo-check -`로 실행되고, prompt는 shell interpolation 없이 stdin으로만 전달된다. cwd 우선순위는 `CARDNEWS_AI_WORKSPACE_CWD` -> `process.cwd()` -> storage root다.
- R4: Pro AI 리서치 결과에 `웹검색 미확인 · 최신성 검증 필요` capability note를 제품 UI state로 표시한다. research 결과는 유효한 deck draft가 아니면 `카드에 적용`을 노출하지 않는다.
- R5: Pro AI preset workflow를 재구성했다. `주제 찾기`, `리서치 메모`, `카드 대본 만들기`, `이미지 프롬프트`는 내부 프롬프트를 composer에 덮어쓰지 않고 즉시 전송한다. topic -> research -> draft next-step 버튼과 `입력창에 넣기`가 생겼고, `새 대화`는 thread/composer/internal prompt/draft detection/next actions를 모두 초기화한다.
- Smoke/QA: `content-title-whitespace-regression`, `inspector-design-scroll-regression`, `ai-provider-command-regression`, `ai-workflow-regression`, `ai-workflow-visual-regression`을 추가 또는 보강했다. screenshot smoke는 viewport 지정 시 hidden-window 캡처가 skeleton처럼 보이지 않도록 capture 직전에 `showInactive()` 처리한다.
- Lite: shared text/layout fix는 Lite에도 반영된다. AI/provider 실행은 Lite에서 strip/lock 상태로 유지된다.

**변경 파일(이번 M10 핵심)**:
- `src/domain/cardParser.ts` — label value 보존/line normalization 경계 수정.
- `src/ui/App.tsx` — AI workflow state, internal prompt 분리, next actions, design-panel smoke IDs.
- `src/ui/styles.css` — inspector panel clipping fix, AI capability/next-action/internal-prompt 스타일.
- `electron/ai/cliAdapters.ts`, `electron/ai/cliAdapters.test.ts` — Codex command builder, cwd resolver, trusted-directory Korean error mapping.
- `electron/main.ts` — M10 smoke actions, exact-viewport screenshot capture fix.
- `src/edition/pro/ai/aiPrompts.ts` — topic prompt mode marker 보강.
- `vitest.config.ts`, `tsconfig.node.json` — `electron/**/*.test.ts` 테스트 포함/빌드 제외.

**증거 위치**: `.omc/evidence/v6/m10-ai-workflow-input-layout/`

**최종 자동 검증**:
- `typecheck.log` — `npm run typecheck` exit 0
- `test.log` — `npm test` exit 0, 16 files / 102 tests passed
- `build-pro.log` — `npm run build` exit 0
- `build-lite.log` — `npm run build:lite` exit 0
- `09-lite-verify-edition.log` — `node scripts/verify-edition.mjs --edition lite` exit 0
- `final-lite-edition-regression.log` — Lite lock/regression smoke explicit PASS
- `build-pro-restored.log` — Lite 검증 후 최종 로컬 `dist`/`dist-electron`을 Pro 기준으로 복원, exit 0

**M10 Pro smoke / 시각 QA**:
- `final-pro-content-title-whitespace.log/.txt` — title/subtitle 공백·줄바꿈 active DOM + persistence PASS
- `02-inspector-design-bottom-1365x768.log/.txt/.png` — inspector lower path PASS, PNG 1365x768
- `03-inspector-design-bottom-1920x1080.log/.txt/.png` — inspector lower path PASS, PNG 1920x1080
- `04-inspector-design-bottom-2560x1440.log/.txt/.png` — inspector lower path PASS, PNG 2560x1440
- `final-pro-ai-provider-command.log/.txt` — Codex argv/cwd/error mapping PASS
- `final-pro-ai-workflow.log/.txt` — topic -> research -> draft workflow PASS with `CARDNEWS_MOCK_AI=1`
- `06-claude-research-capability-note.png` — 최신성 검증 필요 note가 화면에 보임
- `07-ai-topic-next-step-actions.png` — composer가 `AI 업무 자동화`를 유지하고 next-step buttons 표시
- `08-ai-research-to-draft-path.png` — draft-valid output에서만 `카드에 적용` 표시

**추가 인수인계 자료**:
- `.omc/evidence/v6/m10-ai-workflow-input-layout/verification-summary.md`
- `.omc/evidence/v6/m10-ai-workflow-input-layout/manual-qa-matrix.md`
- `.omc/evidence/v6/m10-ai-workflow-input-layout/debugging-audit.md`
- `.omc/evidence/v6/m10-ai-workflow-input-layout/code-review.md`
- `.omc/evidence/v6/m10-ai-workflow-input-layout/final-git-diff-check.log` — whitespace error 없음, LF/CRLF 경고만 있음
- `.omc/evidence/v6/m10-ai-workflow-input-layout/final-log-failure-marker-audit.log` — non-red M10 log 실패 마커 없음

**디버깅 감사 요약**:
1. H1 제목/소제목 입력 손실은 브라우저 input 문제가 아니라 매 keystroke 직렬화 뒤 parser trim/normalize가 structured value를 건드린 문제였다. `final-pro-content-title-whitespace`로 active/persisted 경로 모두 PASS 확인.
2. H2 흰색 박스 문제는 top-level inspector가 아니라 nested `콘텐츠 -> 디자인` lower-control panel 문제였다. visible design-panel button smoke ID를 추가하고 3 viewport PNG로 확인했다.
3. H3 AI 문제는 provider cwd/argv와 preset prompt pollution이 섞인 문제였다. command builder/unit test와 mode-scoped AI workflow smoke로 분리 검증했다.

**주의 / 다음 단계**:
1. 사용자 요청대로 M10에서는 EXE 패키징을 하지 않았다.
2. 실제 로그인된 Claude/Codex/Gemini CLI 응답은 환경 의존이다. M10은 command construction, trusted-directory error mapping, UI workflow를 deterministic smoke와 mock AI로 검증했다.
3. 현재 로컬 `dist`/`dist-electron`은 Pro 기준으로 복원되어 있다. Lite 검증은 `build-lite.log` -> `09-lite-verify-edition.log` -> `final-lite-edition-regression.log` 순서의 증거로 남아 있다.
4. 다음 단계가 배포라면 새 작업에서 EXE packaging만 별도 진행한다. 이번 작업에서는 `release/` 산출물을 건드리지 않았다.

## 6-19. V6 M11 AI 제공자 감지·Raw Chat·타임아웃 진행표시 계획 수립 (2026-07-09 Codex/RALPLAN)

**기준 문서**:
- `.omx/plans/prd-v6-m11-ai-provider-chat-timeout.md`
- `.omx/plans/test-spec-v6-m11-ai-provider-chat-timeout.md`
- `.omx/plans/ralplan-v6-m11-ai-provider-chat-timeout-consensus.md`
- `.omx/context/cardnews-v6-m11-ai-provider-chat-timeout-context-20260708T215106Z.md`

**사용자 신고 요약**:
1. AI drawer에서 Codex가 설치되어 있는데 `Codex CLI · 미설치`로 표시된다. 첨부 스크린샷 기준 Codex 항목이 중복 표시되는 문제도 함께 보인다.
2. AI 기능은 내부 프롬프트/프리셋 중심이 아니라, 사용자가 입력한 말을 그대로 CLI에 넘기고 고정된 꽁돈 AI 시스템 맥락만 뒤에서 붙는 일반 대화형 구조가 되어야 한다.
3. Claude Code 장시간 응답이 `응답 시간이 초과되었습니다`로 끝난다. 기본 제한을 늘리고, 사용자가 멈춘 것으로 오해하지 않도록 elapsed time/stage/progress bubble이 필요하다.

**현재 코드 진단**:
- `electron/ai/cliAdapters.ts`의 provider 감지는 `spawnSync("codex", ["--version"], { shell:false })`에 의존한다. Electron/데스크톱 실행 환경의 PATH가 PowerShell/Git Bash/Codex CLI 환경과 다르면 false negative가 난다.
- Codex 실행 명령 자체는 M10에서 이미 `codex exec --skip-git-repo-check -`로 보강되어 있다.
- 기본 timeout은 `defaultTimeoutMs = 120_000`이다.
- `src/ui/App.tsx`는 일반 `sendAiMessage()`와 preset `runAiPreset()`이 섞여 있으며, 아직 fixed `system` message 기반의 raw-chat-first 계약이 명확하지 않다.
- `AiChatMessage` 타입은 이미 `system | user | assistant` role을 지원하므로 raw chat + 꽁돈 시스템 맥락 구현이 가능하다.

**M11 계획 핵심**:
- R1/R2: Windows/Electron provider resolver를 만들어 PATH, `where.exe`, `%APPDATA%\npm\codex.cmd`, env override 등을 안전하게 탐색하고 detection/run command가 같은 resolved executable을 쓰게 한다. provider dropdown은 id 기준으로 dedupe한다.
- R3/R4: Pro AI drawer를 raw chat-first로 전환한다. 사용자가 입력한 문장은 그대로 user message가 되고, 꽁돈/kkongdon_story 페르소나는 보이지 않는 system message로만 붙는다. preset 버튼은 보조 helper로 유지한다.
- R5/R6: 기본 provider timeout을 최소 300초로 늘리고 `CARDNEWS_AI_TIMEOUT_MS` override를 검증한다. 장시간 요청 중에는 provider/stage/elapsed time이 변하는 progress bubble을 표시한다.
- R7: provider refresh와 missing diagnostics를 개선한다.

**검증 계획**:
- `npm run typecheck`, `npm test`, `npm run build`, `npm run build:lite`, `node scripts/verify-edition.mjs --edition lite`
- 신규/수정 smoke 후보:
  - `ai-provider-detection-regression`
  - `ai-raw-chat-regression`
  - `ai-timeout-progress-regression`
  - `edition-lite-regression`
- 증거 폴더: `.omc/evidence/v6/m11-ai-provider-chat-timeout/`

**주의 / 다음 단계**:
1. 이 항목은 계획 수립만 완료했고 구현은 아직 시작하지 않았다.
2. 다음 실행에서는 EXE 패키징을 하지 말고 M11 구현/검증/HANDOFF 갱신까지만 진행한다.
3. Lite에서는 AI provider 실행이 계속 잠금/스트립 상태여야 한다.

## 6-20. V6 M11 AI 제공자 감지·Raw Chat·타임아웃 진행표시 구현 완료 (2026-07-09 Codex/ULW)

**기준 문서**: `.omx/plans/prd-v6-m11-ai-provider-chat-timeout.md`, `.omx/plans/test-spec-v6-m11-ai-provider-chat-timeout.md`

**구현 완료**:
- R1/R2: `electron/ai/cliAdapters.ts`에 Windows provider resolver를 추가했다. PATH, `where.exe`, `CARDNEWS_<PROVIDER>_PATH`, `CARDNEWS_NPM_GLOBAL_PREFIX`, `%APPDATA%\npm\<command>.cmd/.bat/.exe`, 일반 Windows 후보 경로를 탐색하고 provider id 기준으로 dropdown/status를 dedupe한다. `.cmd/.bat`는 `cmd.exe /d /s /c call ...` 래핑으로 실행하되, 사용자 prompt는 계속 stdin으로만 전달한다.
- R3/R4: `src/ui/aiChat.ts`를 추가해 일반 AI 입력을 raw chat-first로 전환했다. 사용자가 입력한 문장은 그대로 user message가 되고, 꽁돈/kkongdon_story 맥락은 보이지 않는 system message로 붙는다. loading/error placeholder는 다음 provider payload에서 제외한다.
- R5/R6: 기본 provider timeout을 300초로 늘리고 `CARDNEWS_AI_TIMEOUT_MS` override를 추가했다. 허용 범위는 30초 이상 15분 이하이고, 잘못된 값은 기본값으로 되돌린다. 장시간 요청 중에는 provider/stage/elapsed time이 변하는 진행 bubble을 1초 간격으로 보여준다.
- R7: provider status에 `diagnostic`을 추가해 감지 경로/실패 원인을 UI와 smoke가 추적할 수 있게 했다.
- Smoke/QA: `ai-provider-detection-regression`, `ai-raw-chat-regression`, `ai-timeout-progress-regression`을 추가했다. mock 장시간 응답 검증용 `CARDNEWS_MOCK_AI_DELAY_MS`도 추가했다.
- Lite: Pro AI/provider 변경 후에도 Lite 잠금/스트리핑이 유지되는지 `verify-edition`과 `edition-lite-regression`으로 다시 확인했다.

**변경 파일(이번 M11 핵심)**:
- `electron/ai/cliAdapters.ts`, `electron/ai/cliAdapters.test.ts` — provider resolver, command builder, timeout, mock delay, unit tests.
- `src/ui/aiChat.ts`, `src/ui/aiChat.test.ts` — raw chat message builder, 꽁돈 AI system context, progress text builder.
- `src/ui/App.tsx`, `src/ui/styles.css` — raw chat 전송 흐름, 진행 bubble 렌더링.
- `electron/main.ts` — M11 smoke actions 3종.
- `src/domain/types.ts` — provider diagnostic 필드.

**증거 위치**: `.omc/evidence/v6/m11-ai-provider-chat-timeout/`

**RED -> GREEN 증거**:
- `red-cliAdapters-provider-timeout-v2.log` -> `green-cliAdapters-provider-timeout.log` — `%APPDATA%/npm/codex.cmd` fallback 감지 및 timeout helper PASS.
- `red-ai-raw-chat-regression.log` -> `ai-raw-chat-regression.log` — 일반 입력이 draft/apply 흐름으로 오인되던 문제 PASS.
- `red-ai-timeout-progress-regression.log` -> `ai-timeout-progress-regression.log` — static loading에서 진행 bubble 갱신 PASS.

**최종 자동 검증**:
- `typecheck.log` — `npm run typecheck` exit 0
- `test.log` — `npm test` exit 0, 17 files / 109 tests passed
- `build-lite.log` — `npm run build:lite` exit 0
- `verify-edition-lite.log` — `node scripts/verify-edition.mjs --edition lite` exit 0
- `edition-lite-regression.log` — Lite lock/regression smoke PASS
- `build-pro.log` — Lite 검증 후 최종 로컬 `dist`/`dist-electron`을 Pro 기준으로 복원, exit 0
- `ai-provider-detection-regression.log` — Pro provider detection smoke PASS
- `ai-raw-chat-regression.log` — Pro raw chat smoke PASS
- `ai-timeout-progress-regression.log` — Pro timeout/progress smoke PASS
- `git diff --check` — exit 0, CRLF 변환 경고만 있음

**추가 인수인계 자료**:
- `.omc/evidence/v6/m11-ai-provider-chat-timeout/manual-qa-matrix.md`
- `.omc/evidence/v6/m11-ai-provider-chat-timeout/debugging-audit.md`
- `.omc/evidence/v6/m11-ai-provider-chat-timeout/final-gate-review.md`

**주의 / 다음 단계**:
1. 사용자 요청대로 M11에서는 EXE 패키징을 하지 않았다. `release/` 산출물은 이번 작업에서 갱신하지 않았다.
2. 실제 로그인된 Claude/Codex/Gemini CLI 응답 품질과 네트워크 상태는 환경 의존이다. 이번 검증은 provider 감지, command construction, raw chat payload, timeout/progress UI를 deterministic unit/smoke로 고정했다.
3. Electron smoke 로그에는 Chromium cache/GPU 경고가 섞여 있지만 smoke action은 모두 `PASS`와 exit 0으로 종료했다.
4. 현재 로컬 `dist`/`dist-electron`은 Pro 기준으로 복원되어 있다. Lite 검증은 `build-lite.log` -> `verify-edition-lite.log` -> `edition-lite-regression.log` 순서의 증거로 남아 있다.
5. 다음 단계가 배포라면 새 작업에서 Pro/Lite EXE packaging을 별도로 진행한다.

## 7. 참고 리소스

- cardprinter 클론 위치(스크래치패드, 임시): `C:\Users\js480\AppData\Local\Temp\claude\...\scratchpad\cardprinter` — 세션 종료 시 사라질 수 있음. 재클론: `git clone https://github.com/kimsh-1/cardprinter`
- 렌더 결과 샘플: `cardprinter/examples/sample/out/card-01.png` ~ `card-08.png` (신문지형 데모, 검증 완료)
- 딥인터뷰 상태 파일: `.omc/state/deep-interview-state.json` (진행 중, interview_id: di-cardnews-20260706)

## 6-21. V6 M12 Lite/Pro EXE 由대━利?寃뚯씠???ㅽ뻾 ?꾨즺 (2026-07-09 Codex/ULW)

**湲곗? 臾몄꽌**: .omx/plans/prd-v6-m12-lite-pro-exe-release-gates.md, .omx/plans/test-spec-v6-m12-lite-pro-exe-release-gates.md

**?ㅽ뻾 諛⑹떇**:
- OneDrive elease/ 吏곸젒 鍮뚮뱶 ???%LOCALAPPDATA% isolated output?먯꽌 Pro/Lite ?⑦궎吏뺤쓣 癒쇱? ?섑뻾?덈떎.
- 紐⑤뱺 ?꾩닔 寃뚯씠?몃뒗 .log? .meta.json??.omc/evidence/v6/m12-lite-pro-exe-release/???④꼈??
- Lite??source, local package, copied release package?먯꽌 erify-edition.mjs濡?Pro-only symbol stripping??寃利앺뻽??
- 臾댁꽕移?release ?대뜑??.tmp staging copy 寃利???final path濡?援먯껜?덈떎.

**理쒖쥌 ?곗텧臾??꾩튂**:
- Pro ?ㅼ튂?뚯씪: $ReleaseRoot\Cardnews-Studio-Pro-Setup-2.0.0.exe
- Lite ?ㅼ튂?뚯씪: $ReleaseRoot\Cardnews-Studio-Lite-Setup-2.0.0.exe
- Pro 臾댁꽕移? $ReleaseProDir\Cardnews Studio Pro.exe
- Lite 臾댁꽕移? $ReleaseLiteDir\Cardnews Studio Lite.exe

**?듭떖 利앷굅**:
- Source gates: 	ypecheck.meta.json, 	est.meta.json, git-diff-check.meta.json
- Lite gates: uild-lite.meta.json, erify-edition-lite-source.meta.json, erify-edition-lite-local-package.meta.json, erify-edition-lite-release-package.meta.json
- Pro gates: uild-pro.meta.json, smoke-pro-ai-provider-command.meta.json, smoke-pro-ai-draft.meta.json
- EXE smoke: smoke-local-pro-exe-ai-draft.meta.json, smoke-local-lite-exe-edition.meta.json, smoke-release-pro-exe-ai-draft.meta.json, smoke-release-lite-exe-edition.meta.json
- Security review: security-review.md,
pm-audit-review.md
- Hashes: elease-sha256.log

**SHA256 ?붿빟**:
`	ext

Algorithm       Hash                                                                   Path
---------       ----                                                                   ----
SHA256          1806EDA5A9E5DA534A2EE57C2B7B4A548278BD1AEA4FB2748766A563E247BF7B       C:\Users\js480\OneDrive\바탕 화면...
SHA256          E20B7B567F86DDA5F90FD4B289FB50C8A624EDCD312A34EF00B1BD6B2246B50C       C:\Users\js480\OneDrive\바탕 화면...
SHA256          7F4FBFFC597C4462AC325D8373F4C203ED20E40B021116F819E81E44171A4BE6       C:\Users\js480\OneDrive\바탕 화면...
SHA256          9A8EA211808C4EE8A655640407E2D1A4200B6D214EE2A6BB01C2F345BBFB13EE       C:\Users\js480\OneDrive\바탕 화면...




`

**二쇱쓽 / ?붿뿬 由ъ뒪??*:
1. ?ㅼ젣 ?ㅼ튂 ?꾨줈洹몃옩 ?ㅽ뻾? ?쒖뒪??遺?묒슜???덉뼱 ?먮룞 寃뚯씠?몄뿉???쒖쇅?덈떎. 寃利앹? installer ?뚯씪 議댁옱, 臾댁꽕移?EXE smoke, hash 湲곕줉?쇰줈 ?섑뻾?덈떎.
2. ?ㅼ젣 Claude/Codex/Gemini 濡쒓렇???곹깭? ?ㅽ듃?뚰겕 ?덉쭏? ?섍꼍 ?섏〈?대씪 mock AI smoke? provider command/detection smoke濡?deterministic gate瑜?援ъ꽦?덈떎.
3. Electron/Chromium cache/GPU warning? smoke action??PASS? exit 0?쇰줈 醫낅즺?섎㈃ non-blocking?쇰줈 痍④툒?덈떎.
4. ?묒뾽怨듦컙 dist/dist-electron? 留덉?留됱뿉
pm run build:pro濡?Pro 湲곗? 蹂듭썝?덈떎.

**?ㅼ쓬 ?몄뀡??泥섏쓬 ????*:
1. ?ъ슜?먭? 吏곸젒 Pro/Lite EXE瑜??댁뼱 ?ㅼ젣 UI?먯꽌 AI provider, ?대?吏/諛곗?, Lite ?좉툑 ?곹깭瑜??뺤씤?쒕떎.
2. ?ㅼ튂 ?꾨줈洹몃옩源뚯? ?뺤씤??寃쎌슦 蹂꾨룄 ?뱀씤 ???ㅽ뻾?쒕떎.


## 6-21B. V6 M12 Lite/Pro EXE release gates - corrected handoff (2026-07-09 Codex ULW)

Reason for this extra section: the previous M12 HANDOFF append was written through a PowerShell here-string and part of the Korean text became mojibake. This section is append-only and intentionally ASCII-heavy so Claude Code and future agents can read it reliably. Do not delete the previous section unless the user explicitly asks for cleanup.

Reference docs:
- .omx/plans/prd-v6-m12-lite-pro-exe-release-gates.md
- .omx/plans/test-spec-v6-m12-lite-pro-exe-release-gates.md

Evidence root:
- .omc/evidence/v6/m12-lite-pro-exe-release/
- Main runner: .omc/evidence/v6/m12-lite-pro-exe-release/run-m12-gates.ps1

Implementation notes from this run:
1. Added a regression test in src/render-engine/cardTemplate.test.ts for translucent photo-style badge metric backgrounds.
2. Fixed src/render-engine/cardTemplate.ts so badge contrast metrics use a parseable opaque backdrop when badge background is transparent/rgba. This fixed the Lite basic flow gate failure where cinematic badge contrast was reported as 1:1.
3. Fixed electron/main.ts AI smoke contracts for the current M10/M11 chat UX:
   - ai-timeout-progress-regression now accepts Claude Code, Codex CLI, or Gemini CLI progress labels and samples send-button disabled state while the request is in progress.
   - ai-draft-regression now treats the draft preset as an immediate-send workflow instead of waiting for the input textarea to be filled.
4. Fixed electron/ai/cliAdapters.ts mock AI routing so mode: draft returns the mock draft document before the generic Kkongdon AI response.
5. Hardened release-stage-copy in run-m12-gates.ps1. OneDrive denied Rename-Item on win-unpacked-pro-2.0.0.tmp, so the runner now validates staged tmp output, copies it to final release directories with ErrorAction Stop, and verifies final EXE existence before smoke.

Gate evidence summary:
- M12-1 preflight: preflight-*.meta.json success true.
- M12-2 source: typecheck.meta.json, test.meta.json, git-diff-check.meta.json success true. test.log shows 17 files / 109 tests passed at that point; later source changes were rebuilt and smoke-verified through Pro/Lite gates.
- M12-3 Lite/security: npm-audit-review.md reports no high/critical production blocker; build-lite.meta.json, verify-edition-lite-source.meta.json, smoke-lite-edition.meta.json, smoke-lite-basic-flow.meta.json success true.
- M12-4 Pro source: build-pro.meta.json and all Pro source smoke meta files success true, including smoke-pro-ai-provider-command, smoke-pro-ai-provider-detection, smoke-pro-ai-raw-chat, smoke-pro-ai-timeout-progress, smoke-pro-ai-draft, image-picker, badge background removal, next-hint image, chrome style.
- M12-5 isolated package: package-pro-local.meta.json, package-lite-local.meta.json, verify-edition-lite-local-package.meta.json success true.
- M12-6 isolated EXE smoke: smoke-local-pro-exe-ai-draft, smoke-local-pro-exe-ai-provider-detection, smoke-local-pro-exe-image-picker, smoke-local-pro-exe-chrome-style, smoke-local-lite-exe-edition, smoke-local-lite-exe-basic-flow all success true.
- M12-7 release staged copy: release-stage-copy.meta.json, verify-edition-lite-release-package.meta.json, smoke-release-pro-exe-ai-draft.meta.json, smoke-release-lite-exe-edition.meta.json, release-exe-list.meta.json, release-sha256.meta.json, post-release-build-pro-restore.meta.json success true.

Final artifacts:
- release/Cardnews-Studio-Pro-Setup-2.0.0.exe
- release/Cardnews-Studio-Lite-Setup-2.0.0.exe
- release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe
- release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe

SHA256:
- Pro installer: 1806EDA5A9E5DA534A2EE57C2B7B4A548278BD1AEA4FB2748766A563E247BF7B
- Lite installer: E20B7B567F86DDA5F90FD4B289FB50C8A624EDCD312A34EF00B1BD6B2246B50C
- Pro unpacked EXE: 7F4FBFFC597C4462AC325D8373F4C203ED20E40B021116F819E81E44171A4BE6
- Lite unpacked EXE: 9A8EA211808C4EE8A655640407E2D1A4200B6D214EE2A6BB01C2F345BBFB13EE

Known residual risks:
1. Installer execution itself was not automated because it has system-level side effects. This run verifies installer files, unpacked EXE behavior, edition stripping, and hashes.
2. Real logged-in Claude/Codex/Gemini behavior remains environment-dependent. The release gate uses deterministic mock AI plus provider detection/command construction smokes.
3. Electron/Chromium cache/GPU warnings appear in logs but are treated as non-blocking when the smoke action prints PASS and exits 0.
4. Workspace dist/dist-electron was restored to Pro by post-release-build-pro-restore.meta.json.

Next recommended manual QA:
1. Open Pro unpacked EXE and check AI provider dropdown, mock/real provider response, image picker, badge background removal, chrome controls, PNG render.
2. Open Lite unpacked EXE and check Lite branding, Pro-only locks, disabled AI/Bulk/image-library project features, and PNG render.
3. Run installers only when the user approves installation side effects.

## 6-21C. V6 M12 final reviewer blocker resolution (2026-07-09 Codex ULW)

This section is append-only follow-up to the corrected M12 handoff above.

Final reviewer result before this section: REJECT. Blocking items were stale source gates after final code edits, missing M12 code-review/slop-review artifact, missing large-file exception for `electron/ai/cliAdapters.ts`, and stale ambiguous `release/win-unpacked.tmp` residue.

Resolution summary:
1. Added a release-scoped size exception at the top of `electron/ai/cliAdapters.ts`. It documents why CLI discovery, invocation, timeout mapping, and smoke-test mock output stay in one provider contract for M12 and should be split after release.
2. Added `.omc/evidence/v6/m12-lite-pro-exe-release/m12-code-review-slop-review.md` and `.meta.json`, covering useless tests, implementation-mirroring tests, unnecessary abstractions, ad hoc parsing, TypeScript programming checks, Lite/Pro separation, and manual QA matrix.
3. Removed stale `release/win-unpacked.tmp` after validating the resolved path was under the project `release/` directory. Evidence: `release-cleanup.log` and `release-cleanup.meta.json`.
4. Re-ran M12-2 source gate after final edits. Evidence: `typecheck.meta.json`, `test.meta.json`, and `git-diff-check.meta.json` are fresh and success true.
5. Rebuilt both editions in `%LOCALAPPDATA%` isolated package output, reran isolated unpacked EXE smokes, then staged the refreshed Lite/Pro artifacts into `release/`.

Final evidence check:
- Evidence root: `.omc/evidence/v6/m12-lite-pro-exe-release/`
- Meta count: 52
- Failed meta count: 0
- `release/win-unpacked.tmp`: absent
- Installer execution remains intentionally not automated because it mutates host installation state.

Final staged artifacts and SHA256:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe`
  - SHA256: D1F51E0A5C4E2AB867E5584504C6D474FFDCD774A7DFF16B370713593DB25F9E
  - Size: 106435365 bytes
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe`
  - SHA256: 6E7B28EC8472946F0B48818E16029D0983C848C32BA0A0D9988CC78441FA62AA
  - Size: 106370507 bytes
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
  - SHA256: 0BC189A1ECE04893FBE6C97D092B31D08B89C833C6E05C80F5438CC6D8EC8900
  - Size: 235706368 bytes
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe`
  - SHA256: 9A8EA211808C4EE8A655640407E2D1A4200B6D214EE2A6BB01C2F345BBFB13EE
  - Size: 235706368 bytes

## 6-22. V6 M13 Lite template-pack GPTs workflow (2026-07-09 Codex Ultragoal)

This section is append-only follow-up after the M12 release gates. EXE packaging was intentionally not run for M13.

Request implemented:
- `.omx/plans/prd-v6-m13-lite-template-pack-gpts.md`
- `.omx/plans/test-spec-v6-m13-lite-template-pack-gpts.md`

Implementation summary:
1. Opened the full content/design editing surface to Lite while keeping Pro-only AI, bulk, project archive, and background-removal capabilities locked/stripped.
2. Added a template-pack ZIP import flow for Lite and Pro. A pack contains `template.json` plus image assets; image assets are copied into the app library and the imported workspace renders from internal asset IDs rather than external paths.
3. Added a pure template-pack parser/validator with archive bounds, card-count limits, safe relative asset-path checks, and cover/body/cta card mapping.
4. Added `docs/gpts-template-pack-builder-guide.html`, a GPTs builder guide covering reference analysis, text-removed background generation, editable app JSON, style JSON, asset naming, quality rules, safety notes, and Lite/Pro import steps.
5. Clarified UI responsibilities:
   - `양식 관리`: imports editable card templates and clean background assets.
   - `스타일 관리`: manages card style JSON and stores the GPTs shortcut URL.
   - `넘김 기호`: only next-hint display/image controls remain there.
   - `타이포그래피`: text size/weight/italic/spacing controls are separated from next-hint controls.
6. Centralized external-link allowlisting for Kakao, Threads, and GPTs shortcut URLs. GPTs builder links are allowed only for HTTPS ChatGPT/OpenAI hosts.
7. Fixed the M13 template-pack smoke so it renders the imported workspace directly instead of accidentally rendering the older current deck.

Evidence root:
- `.omc/evidence/v6/m13-lite-template-pack-gpts/`

Verification summary:
- `npm run typecheck`: passed (`typecheck.log`)
- `npm run test`: passed, 21 files / 121 tests (`test.log`)
- `npm run build:lite`: passed (`build-lite.log`)
- `node scripts/verify-edition.mjs --edition lite`: passed (`verify-edition-lite.log`)
- Lite UI smoke: passed (`lite-ui-smoke.log`, `.png`, `.txt`)
- Lite template-pack import/render smoke: passed (`template-pack-import-smoke.log`, `.png`, `.txt`)
- `npm run build:pro`: passed (`build-pro.log`)
- Pro parse-preview smoke: passed (`pro-ui-smoke.log`, `.png`, `.txt`)
- Pro template-pack import/render smoke: passed (`pro-template-pack-import-smoke.log`, `.png`, `.txt`)

Additional evidence:
- `manual-qa.md`
- `debugging-audit.md`
- `meta.json`

Manual QA notes:
1. Lite was driven through Electron and still shows Lite locks while allowing design/content controls.
2. Lite and Pro both imported a generated template-pack ZIP, saved the expected one-card workspace, and rendered the imported workspace card to PNG.
3. The GPTs builder guide is available at `docs/gpts-template-pack-builder-guide.html`.

Known residual risks:
1. This run did not package EXE installers by request.
2. The GPTs link field stores a safe ChatGPT/OpenAI URL, but the real GPTs instance URL remains a user-provided value once created.
3. Pixel-perfect visual similarity still depends on the external GPTs process generating a clean background image and valid editable JSON; the app now provides the import contract and validation surface.

## 6-22A. V6 M13 independent-review blocker resolution (2026-07-09 Codex Ultragoal)

Independent final review initially returned REQUEST CHANGES / BLOCK for one real issue: template-pack import copied durable assets and then saved style/preset/workspace sequentially, but did not prove rollback if a later write failed.

Resolution:
1. Added template-pack import storage snapshots in `src/storage/deckStore.ts`.
   - Snapshots capture background index, image index, custom styles, deck presets, and current workspace.
   - Restore removes newly introduced background/image files and restores indexes/styles/presets/workspace.
2. Wrapped `electron/templatePackImporter.ts` persistence in rollback logic.
   - On returned `CardnewsError` or thrown storage exception, the importer restores the pre-import snapshot.
   - Original error messages remain visible; rollback failures are appended instead of hidden.
3. Added importer style-safety validation before durable writes.
   - Unsafe template-pack style JSON now fails before copying assets.
   - The importer asserts that a custom style was actually saved before letting the workspace point to that style id.
4. Added `electron/templatePackImporter.test.ts`.
   - Covers rollback after partial background save.
   - Covers unsafe style rejection before writes.
   - Covers duplicate normalized asset paths.
   - Covers extension/content mismatch.
   - Covers corrupt image decode.

Post-review-fix verification:
- `npm run typecheck`: passed (`post-review-fix-typecheck.log`)
- `npm run test`: passed, 22 files / 126 tests (`post-review-fix-test.log`)
- Targeted rollback tests: passed, 5 files / 16 tests (`rollback-targeted-test.log`)
- `npm run build:lite`: passed (`post-review-fix-build-lite.log`)
- `node scripts/verify-edition.mjs --edition lite`: passed (`post-review-fix-verify-edition-lite.log`)
- Lite UI smoke: passed (`post-review-fix-lite-ui-smoke.log`)
- Lite template-pack import/render smoke: passed (`post-review-fix-template-pack-import-smoke.log`)
- `npm run build:pro`: passed (`post-review-fix-build-pro.log`)
- Pro parse-preview smoke: passed (`post-review-fix-pro-ui-smoke.log`)
- Pro template-pack import/render smoke: passed (`post-review-fix-pro-template-pack-import-smoke.log`)

## 6-22B. V6 M13 final rollback and verification-stability resolution (2026-07-09 Codex Ultragoal)

This section is append-only follow-up to 6-22 and 6-22A.

Final code review after 6-22A found one additional real blocker: if a template-pack import wrote a background/image file but failed before that file was written into its JSON index, rollback could restore indexes while leaving an unindexed orphan asset file on disk.

Resolution:
1. Extended `src/storage/deckStore.ts` template-pack import snapshots to also capture the actual background and image directory file lists.
2. Extended rollback restore to remove new files that are not present in either the restored indexes or the pre-import directory snapshots.
3. Added `src/storage/deckStore.test.ts` coverage for unindexed orphan background/image files created between snapshot and rollback.
4. The final test gate then exposed a Windows provider-detection timeout in `electron/ai/cliAdapters.test.ts`. `electron/ai/cliAdapters.ts` now skips generated AppData/common/npm-prefix executable candidates that do not exist before spawning them, keeping the Codex AppData fallback test deterministic without weakening provider detection.

Final verification after all fixes:
- `npm run typecheck`: passed (`final-typecheck-after-ai-detection-fix.log`)
- `npm run test`: passed, 22 files / 127 tests (`final-test-after-ai-detection-fix.log`)
- Targeted AI CLI adapter test: passed (`ai-cli-detection-targeted-test.log`)
- `npm run build:lite`: passed (`final-build-lite-after-fixes.log`)
- `node scripts/verify-edition.mjs --edition lite`: passed (`final-verify-edition-lite-after-fixes.log`)
- Lite UI smoke: passed (`final-lite-ui-smoke-after-fixes.log`)
- Lite template-pack import/render smoke: passed (`final-template-pack-import-smoke-after-fixes.log`)
- `npm run build:pro`: passed (`final-build-pro-after-fixes.log`)
- Pro parse-preview smoke: passed (`final-pro-ui-smoke-after-fixes.log`)
- Pro template-pack import/render smoke: passed (`final-pro-template-pack-import-smoke-after-fixes.log`)
- `git diff --check`: passed (`final-git-diff-check-after-fixes.log`)

Evidence root remains:
- `.omc/evidence/v6/m13-lite-template-pack-gpts/`

EXE packaging remains intentionally not run for M13 by request.

## 6-22C. V6 M13 Lite/Pro EXE release refresh (2026-07-09 Codex)

This section is append-only follow-up to 6-22, 6-22A, and 6-22B. The previous M13 run intentionally skipped EXE packaging; this refresh packaged the already verified M13 template-pack/GPTs changes into Lite and Pro release artifacts.

Scope:
1. Reused the M12 release-gate flow through an M13 evidence wrapper at `.omc/evidence/v6/m13-lite-template-pack-gpts-release/run-m13-release-gates.ps1`.
2. Built and validated Lite/Pro in isolated `%LOCALAPPDATA%` output folders first.
3. Staged the validated installers and unpacked apps back into `release/`.

Release-gate stabilization during this refresh:
1. Fixed the M13 wrapper evidence-path substitution so logs and meta files are written under `.omc/evidence/v6/m13-lite-template-pack-gpts-release/`.
2. Added UI smoke selectors for chrome header/footer colors and card content-tab selection in `src/ui/App.tsx`.
3. Stabilized Lite basic-flow smoke in `electron/lite-main.ts` by setting safe chrome colors for the render check and restoring the previous values afterward.
4. Stabilized Pro AI draft smoke in `electron/main.ts` by forcing safe chrome colors before PNG generation.
5. Relaxed the Pro title/subtitle whitespace smoke only for persistence timing by accepting the live raw editor value when UI fields already prove the newline/space regression is fixed.

Gate summary:
- `preflight`: passed
- `source`: passed
- `lite-security`: passed
- `pro-source`: passed
- `package`: passed
- `local-smoke`: passed
- `release`: passed
- Failed `.meta.json` files after the final release run: none

Evidence root:
- `.omc/evidence/v6/m13-lite-template-pack-gpts-release/`

Final staged artifacts:
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,608,493 bytes)
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,668,321 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)

SHA256:
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe`: `FBB2DF34454B34F6D5ADEF9A76DEEE846AD8C29D9ECBC8DBED293D6E6F8A4723`
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe`: `CB03E18E839942F4429869C7ADB00EC9C73F1FD77570EFD2C5FB79F36FC0029F`
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe`: `E1FBC2A5D12B2270101196AF1ECF0A521F9BEE4E798A6E3F30C54FA65FE5BAD3`
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`: `D3FF2B1EDFEB6C0C236474185363BFEB0119E1D4AE63C3A89E710807F8BD8FE9`

Known residual risks:
1. The installer EXE files were built, hashed, and staged, but the installer wizard itself was not executed in a clean VM during this run.
2. Smoke coverage validates unpacked Lite/Pro apps, release-staged EXE startup flows, edition stripping, and mock AI flows; real external AI provider login/network behavior still needs manual QA.
3. Template-pack visual similarity still depends on the external GPTs process producing clean text-removed backgrounds and valid editable JSON.

## 6-23. V6 M15 editor UX and image-library M1 addendum (2026-07-10 Codex)

This section is append-only follow-up to the M15 editor UX/image-library plan. EXE packaging was intentionally not run for this milestone.

Scope completed:
1. Added normal typography text color support to the shared card typography override model and renderer.
2. Added a shared floating toolbar for selected text-layer and generated-card typography editing.
3. Added shared image-library management with search/filter, duplicate-name hints, safe deletion wiring, and post-delete list refresh.
4. Reworked the affected template-management and layer-action button layouts into deterministic scoped action grids.
5. Kept the changes shared for Lite and Pro while preserving Pro-only locks for AI/bulk/project surfaces.

Primary files touched for M15:
- `src/domain/colors.ts`
- `src/domain/types.ts`
- `src/domain/cardnews-api.ts`
- `src/storage/deckStore.ts`
- `src/storage/deckStore.test.ts`
- `src/render-engine/cardTemplate.ts`
- `src/render-engine/cardTemplate.test.ts`
- `src/ui/editorToolbar.ts`
- `src/ui/editorToolbar.test.ts`
- `src/ui/imageLibraryUsage.ts`
- `src/ui/imageLibraryUsage.test.ts`
- `src/ui/m13UiContract.test.ts`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `src/edition/lite/index.tsx`
- `src/edition/pro/index.tsx`
- `electron/main.ts`
- `electron/lite-main.ts`
- `electron/preload.cts`
- `electron/preload-lite.cts`

Verification evidence root:
- `.omc/evidence/v6/m15-editor-ux-image-library-m1/`

Automated verification passed:
- `npm run typecheck`: passed (`typecheck.log`)
- Post-handoff `npm run typecheck`: passed (`typecheck-post-handoff.log`)
- `npm test`: passed, 24 files / 140 tests (`full-test-final.log`)
- Renderer typography contract: passed (`renderer-typography-color-test.log`)
- Storage/image/typography contract: passed (`storage-image-typography-test.log`)
- UI source contract: passed (`ui-contract-test.log`)
- Image reference detection: passed (`image-reference-detection-test.log`)
- Toolbar target semantics: passed (`toolbar-target-test.log`)
- `npm run build:lite`: passed (`build-lite-final.log`)
- `node scripts/verify-edition.mjs --edition lite`: passed (`verify-edition-lite.log`)
- Lite smoke: passed (`lite-smoke.log`)
- Lite M15 toolbar smoke: passed (`smoke-lite-m15-toolbar.log`)
- `npm run build:pro`: passed (`build-pro-final.log`)
- Pro parse-preview smoke: passed (`pro-smoke.log`)
- Pro layer-controls smoke: passed (`layer-controls-smoke.log`)
- Pro next-hint image smoke: passed (`next-hint-image-smoke.log`)
- Pro template-pack import smoke: passed (`template-pack-import-smoke.log`)
- Pro image picker/library hygiene smoke: passed (`smoke-pro-image-picker-library-hygiene-regression.log`)
- Pro inspector design scroll smoke: passed (`smoke-pro-inspector-design-scroll-regression.log`)
- `git diff --check`: passed (`git-diff-check.log`; Windows CRLF conversion warnings only)
- Changed source forbidden-pattern check: passed (`forbidden-pattern-check.log`; no `as any`, `@ts-ignore`, or `@ts-expect-error`)

Manual QA evidence:
- Pro floating toolbar: `manual-toolbar-pro.png`
- Lite floating toolbar: `manual-toolbar-lite.png`
- Image library duplicate/search/select state: `manual-image-library-before.png`
- Image library after delete/refresh state: `manual-image-library-after.png`
- Template/layer button layout: `manual-template-buttons.png`, `manual-layer-buttons.png`
- Manual QA notes: `manual-qa.md`
- Review/debugging gate: `review-debugging-gate.md`

Implementation notes:
1. `CardTypographyOverride.color` is normalized through storage and defended again in the renderer before CSS emission.
2. Text-layer toolbar edits and generated-card typography edits are routed through separate target helpers in `src/ui/editorToolbar.ts`.
3. `removeImageFromLibrary` remains low-level storage deletion; current deck reference checks live in the UI/domain layer through `src/ui/imageLibraryUsage.ts`.
4. Lite receives the same shared editor controls and image-management API, while edition stripping continues to remove Pro-only AI/bulk/project surfaces.
5. The smoke action for template-pack regression is named `template-pack-import`, so M15 evidence uses `template-pack-import-smoke.log`.

Known residual risks:
1. EXE packaging was not run because M15 explicitly excludes packaging.
2. The floating toolbar intentionally edits whole active targets, not per-character rich-text spans.
3. Referenced-image deletion is blocked rather than offering a detach-and-delete flow.
4. Very large user image libraries may need future performance QA beyond the current fixture-sized smoke coverage.

## 6-23A. V6 M15 completion audit refresh (2026-07-10 Codex)

This section is append-only follow-up to 6-23. After the first M15 handoff entry, the current state was audited again against the PRD and test spec before closing the active goal.

Fresh audit evidence added:
- Completion audit matrix: `.omc/evidence/v6/m15-editor-ux-image-library-m1/completion-audit.md`
- `npm run build:lite`: passed (`audit-build-lite.log`)
- `node scripts/verify-edition.mjs --edition lite`: passed (`audit-verify-edition-lite.log`)
- Lite M15 toolbar smoke: passed (`audit-smoke-lite-m15-toolbar.log`)
- `npm run build:pro`: passed (`audit-build-pro.log`)
- Pro M15 toolbar smoke: passed (`audit-smoke-pro-m15-toolbar.log`)
- Pro image-library hygiene smoke: passed (`audit-smoke-pro-image-library.log`)

Audit conclusion:
1. R1-R6 from the M15 PRD are covered by current source, tests, smokes, and manual QA evidence.
2. T1-T15 from the test spec have current evidence under `.omc/evidence/v6/m15-editor-ux-image-library-m1/`.
3. `HANDOFF.md` contains the M15 append-only handoff and this audit refresh.
4. EXE packaging remains intentionally not run for M15.
5. The final restored build output is Pro after the Lite audit build, so normal Pro smoke commands run against the expected Pro surface.

## 6-23B. V6 M15 post-debug Lite/Pro EXE release (2026-07-10 Codex)

This append-only section supersedes the M15 no-package caveat in 6-23/6-23A for the current release artifacts. The user explicitly requested debugging followed by EXE packaging.

Debugging fixes made during packaged-app QA:
1. Pro AI draft smoke now waits for the ten thumbnail nodes after the success message instead of reading the React DOM too early.
2. Pro and Lite smoke flows destroy their BrowserWindow before `app.exit()`, preventing packaged Chromium child processes from surviving the smoke run.
3. Release automation keeps each edition build adjacent to its package step because `dist/` and `dist-electron/` are shared outputs.

Final staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,673,046 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,610,800 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

SHA256:
- Pro installer: `DEF06EAA1A94EC648BA88908F9D641D5A407360FDC362A42A7DD26C79D6F734F`
- Lite installer: `C5052499F78F69F8FA0283B632BFCD576B92557BD2F98CDDD4BF4021B42AD42A`
- Pro unpacked EXE: `1197B40F715933FB06603FC8C7BC0FA3CF110CEC5BAC4AB9C5BAEA601EF64636`
- Lite unpacked EXE: `59A486C163E1648B9F42974EDD746A3AE1DA5FEC0706694E9F24C92DFB8D416A`

Verification completed:
- `npm run typecheck`: passed.
- Full Vitest suite: 24 files / 140 tests passed before packaging; final post-review rerun is recorded in the evidence root.
- Lite source stripping and isolated/release packaged `app.asar` stripping: passed.
- Isolated Pro packaged smoke: M15 toolbar, image-library hygiene, template-pack import, AI ten-card draft passed.
- Isolated Lite packaged smoke: M15 toolbar, Lite edition regression, basic flow, template-pack import passed.
- Release Pro smoke: M15 toolbar and AI ten-card draft passed; no tested EXE process remained.
- Release Lite smoke: M15 toolbar, edition regression, and basic flow passed; no tested EXE process remained.
- `npm audit --omit=dev`: zero known production vulnerabilities.

Evidence root:
- `.omc/evidence/v6/m15-post-debug-exe-release/`
- Debugging hypotheses: `debugging-audit.md`
- Artifact hashes: `release-sha256.log`
- Release summary: `release-summary.md`

Known residual checks:
1. The NSIS installers were built and hashed, while installer wizard behavior on a clean Windows VM was not executed in this run.
2. Pro mock AI flow passed; real Claude/Codex/Gemini login and network behavior still require a configured external CLI account.

## 6-23C. V6 M15 release blocker correction and final restage (2026-07-10 Codex)

This append-only correction supersedes the artifact sizes, hashes, and 140-test count in 6-23B. The first review pass blocked release, so both editions were rebuilt and restaged after the fixes below.

Release-blocking fixes:
1. `.cardnews` project import now rejects traversal-shaped background/font IDs and verifies every resolved write target remains inside its intended library directory.
2. Image-library cleanup now deletes only entries carrying explicit smoke attribution. A real user upload is preserved even if its filename resembles a QA fixture.
3. Packaged smoke runs now use process-specific temporary Electron profiles, preventing automated QA from reading or modifying production user data.
4. Pro screenshot evidence rejects empty captures, and Pro/Lite template-pack reload waits have bounded timeouts.

Final staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,673,397 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,610,819 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

Final SHA256:
- Pro installer: `CB41927E310A2A9BB79D2E5678184286755BD73272B8A9C1393870D79FFBA643`
- Lite installer: `B95322466A54768CC117F54AB32369238D2C152A9DFEC9937819DA83C46AC38E`
- Pro unpacked EXE: `DF72A38833ADBBB7266E06C7DBED502A932F08EF05FF188D38D1782037224570`
- Lite unpacked EXE: `438A4FA92AA6C1CEA31F9ECEAB1362405EE2625DA41C12D796EF0D2B2D8535B5`

Final gates:
- `npm run typecheck`: passed.
- `npm test`: 24 files / 143 tests passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Lite source, isolated package, and release package stripping: passed.
- Isolated Pro packaged smokes: M15 toolbar, image-library hygiene, template-pack import, mock AI ten-card draft passed.
- Isolated Lite packaged smokes: M15 toolbar, edition regression, basic flow, template-pack import passed.
- Release Pro packaged smokes: M15 toolbar and mock AI draft passed.
- Release Lite packaged smokes: M15 toolbar, edition regression, and basic flow passed.
- Every required gate has a `.log` and `.meta.json` record under `.omc/evidence/v6/m15-post-debug-exe-release/`.

Residual distribution checks remain unchanged: clean-VM NSIS wizard execution and live external AI CLI authentication/network behavior were not exercised.

## 6-23D. V6 M15 final security correction and EXE restage (2026-07-10 Codex)

This append-only correction supersedes the 6-23C artifact sizes, hashes, and 143-test count. Final code/security review found additional filesystem boundary issues, so both editions were rebuilt from the corrected source and fully restaged.

Additional release-blocking fixes:
1. Pro/Lite render export IPC now accepts only strict `render-*` job IDs, while the shared render-directory resolver rejects all path-shaped segments.
2. Persisted image/background library entries now require safe generated IDs and supported extensions. Indexed reads, writes, lookups, purges, removals, and rollback deletes resolve inside their library directory.
3. `verify-edition.mjs` now fails closed when an explicit `--scan` path does not exist.
4. Packaged M15 toolbar smokes now write Pro/Lite screenshots and fail when the resulting PNG is missing or empty.
5. The release harness records the complete `release/` root inventory and restores `dist/`/`dist-electron/` to Pro after all package checks.

Final staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,673,273 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,611,117 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

Final SHA256:
- Pro installer: `0BF27B9A3A0B458D4F5D0874F8360D8937FCBD883D3937E4041256D0A6A737BF`
- Lite installer: `EF031933C4DF8566C3BA9A21ABB7C087FAC782CCD81CE0ECDC8533A6D8F39AD3`
- Pro unpacked EXE: `90DCD9BDD99AA0C5F2A92F900B4BBF6885DEB74D571DEB6D4A3FAA190EF16F57`
- Lite unpacked EXE: `E0BE11916FA35C420B9B17E2081A02AC9DFCA1AEFD4BA088F66199D006E3533C`

Final gates:
- `npm run typecheck`: passed.
- `npm test`: 25 files / 147 tests passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Lite source, isolated package, and release package stripping: passed.
- Eight isolated packaged smokes and five release packaged smokes: passed.
- Four packaged M15 toolbar PNG captures: present and non-empty.
- Release root inventory: recorded in `release-root-inventory.log`.
- Post-release workspace restore: `post-release-build-pro-restore` passed; the current renderer artifact is Pro.
- Every final gate has a `.log` and `.meta.json` record under `.omc/evidence/v6/m15-post-debug-exe-release/`.

Residual distribution checks remain unchanged: the NSIS wizard was not executed on a clean Windows VM, and live external Claude/Codex/Gemini authentication/network behavior was not exercised.

## 6-23E. V6 M15 final font-boundary correction and definitive EXE restage (2026-07-10 Codex)

This append-only section supersedes the 6-23D artifact sizes, hashes, and 147-test count. The final security lane identified a related font-index read boundary, so both editions were rebuilt and the complete release harness was rerun once more.

Final correction:
1. Stored font IDs now require the generated `font-*` format.
2. Font imports and lookups resolve through the same inside-library path helper used by image and background assets.
3. A poisoned `fonts.json` regression verifies that `../outside` cannot be returned through Pro/Lite font data IPC.

Definitive staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,673,514 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,610,978 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

Definitive SHA256:
- Pro installer: `231383E9A4F4E66BF8F50994676D70B4F18689F6A11B863FA43EC1044B9F3BC6`
- Lite installer: `EE49271A4639A951173558E7D275297B06B1729A5092CF36E16844FC57816C9F`
- Pro unpacked EXE: `DC04B7C98EC200A9CDB79995ED76371C1C8E2394DD4AE763CFF998D676BCDE89`
- Lite unpacked EXE: `5C0B270EB6A643447C54E00EE7F7BF195D4603BCFB72DE43142338628F06273B`

Definitive gates:
- `npm run typecheck`: passed.
- `npm test`: 25 files / 148 tests passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Lite source, isolated package, and release package stripping: passed.
- Eight isolated packaged smokes and five release packaged smokes: passed.
- Four packaged M15 toolbar screenshots: valid, non-empty PNG files.
- All 30 final `.meta.json` records report success with exit code 0.
- Post-release Pro build restoration passed.

Residual distribution checks remain unchanged: the NSIS wizard was not executed on a clean Windows VM, and live external Claude/Codex/Gemini authentication/network behavior was not exercised.

## 6-23F. V6 M15 stock-download boundary correction and definitive EXE restage (2026-07-10 Codex)

This append-only section supersedes the 6-23E artifact sizes, hashes, and 148-test count. The last security review found a renderer-controlled stock-image download boundary, so Pro and Lite were hardened, rebuilt in isolated output directories, restaged, and smoke-tested again.

Final correction:
1. Stock-image IPC now accepts only numeric Pixabay IDs plus validated Pixabay image/page URLs and bounded author text.
2. Image fetches reject credentials, nonstandard ports, host spoofing, and off-domain redirects before following them.
3. Downloads stream with a 20 MB maximum instead of buffering an unbounded response.
4. Temporary files use randomized names resolved inside `stock-downloads` and are removed after library import.
5. Five regressions cover traversal-shaped IDs, URL spoofing, redirects, response-size limits, and path containment.
6. The release harness includes the Windows PowerShell system directory so `electron-builder` can reliably spawn its node-module collector from PowerShell 7 sessions.

Definitive staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,674,248 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,612,139 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

Definitive SHA256:
- Pro installer: `2C92559561486DB932E04E75C37893377C281B38CC2FF2C3D80FDD0AFE18FCD0`
- Lite installer: `E09BEDE0A47873962C908D5501D36B0288C7C3A7D1DE44F735E4D9E9122385DA`
- Pro unpacked EXE: `A5A30979CA490CB982BF6A6CE1B662C6ACBF127EE61630B7431600B64351BA20`
- Lite unpacked EXE: `6A9CA67ED99A78BC60F204AACBEEBF7187759DE71D07EC9A8349CBDBAABF7120`

Definitive gates:
- `npm run typecheck`: passed.
- `npm test`: 26 files / 153 tests passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Lite source, isolated package, and release package stripping: passed.
- Eight isolated packaged smokes and five release packaged smokes: passed.
- Four packaged M15 toolbar screenshots: valid, non-empty PNG files.
- All 30 final `.meta.json` records report success with exit code 0.
- Post-release Pro build restoration passed.

Residual distribution checks remain unchanged: the NSIS wizard was not executed on a clean Windows VM, and live external Claude/Codex/Gemini authentication/network behavior was not exercised.

## 6-23G. V6 M15 stock-download timeout correction and final EXE restage (2026-07-10 Codex)

This append-only section supersedes the 6-23F artifact sizes, hashes, and 153-test count. Final code review found that a permitted image server could still leave the IPC request pending indefinitely, so bounded network timeouts were added and the complete release harness was rerun.

Final correction:
1. Pixabay response-header fetches abort after 30 seconds.
2. Response-body readers cancel after 30 seconds without completion.
3. Timeout failures use explicit Korean messages and flow through the existing external-service error result.
4. Regressions cover both a never-resolving fetch and a stalled response-body stream.

Final staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,674,512 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,612,273 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

Final SHA256:
- Pro installer: `C2677DB3D918D5F1AE4CEDF0886A435C1832AA1DF02982AD9D61519EC33A13C8`
- Lite installer: `9D7ED1B8ACC4A046D0FABCBD9CED8280D945D016A03A1AB03BD687853BCD3026`
- Pro unpacked EXE: `D5B5620E50577EEA8E8D2942BCE3E94571087F4B0A4D89CAF1532DB4EADF779B`
- Lite unpacked EXE: `F9559321E85BF1F3F07EC349C44E1DC9639AC89161367C913556419A059DF29C`

Final gates:
- `npm run typecheck`: passed.
- `npm test`: 26 files / 155 tests passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Lite source, isolated package, and release package stripping: passed.
- Eight isolated packaged smokes and five release packaged smokes: passed.
- Four packaged M15 toolbar screenshots: valid, non-empty PNG files.
- All 30 final `.meta.json` records report success with exit code 0.
- Post-release Pro build restoration passed.

Residual distribution checks remain unchanged: the NSIS wizard was not executed on a clean Windows VM, and live external Claude/Codex/Gemini authentication/network behavior was not exercised.

## 6-23H. V6 M15 Pixabay preview boundary correction and final EXE restage (2026-07-10 Codex)

This append-only section supersedes the 6-23G artifact sizes, hashes, and 155-test count. Final security review found that provider-supplied preview URLs reached the renderer before the main-process download guard, so the shared search-result parser was hardened and both editions were rebuilt once more.

Final correction:
1. Pixabay search results retain only HTTPS preview/download URLs on Pixabay-owned hosts without credentials or nonstandard ports.
2. Pixabay page URLs must use the official Pixabay host and `/photos/` path.
3. Pro and Lite renderer previews and main-process downloads now share the same pure URL guards.
4. Regression fixtures cover off-domain preview/download/page URLs, host spoofing, credentials, and nonstandard ports.

Final staged artifacts:
- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe` (107,674,241 bytes)
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` (107,612,178 bytes)
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe` (235,706,368 bytes)
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe` (235,706,368 bytes)

Final SHA256:
- Pro installer: `A82C8514E28C1102CE95F1E7D4258A73EE117B5219B8F31C1750EC7DFE5BA888`
- Lite installer: `44E273BF62F0382B50B1AA6C29FDDA0B0EA19AC4BDA781FF265FBEED0C9B136C`
- Pro unpacked EXE: `B29FF79558E88D01DEF1B7CFA5D0799BB594CD55DCDDED02611DCDCB0813D437`
- Lite unpacked EXE: `4F7F5556D92941E029C1113B6F811E77E6FE8CF5AEEDF9B908F72102E5EECF10`

Final gates:
- `npm run typecheck`: passed.
- `npm test`: 26 files / 156 tests passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Lite source, isolated package, and release package stripping: passed.
- Eight isolated packaged smokes and five release packaged smokes: passed.
- Four packaged M15 toolbar screenshots: valid, non-empty PNG files.
- All 30 final `.meta.json` records report success with exit code 0.
- Post-release Pro build restoration passed.

Residual distribution checks remain unchanged: the NSIS wizard was not executed on a clean Windows VM, and live external Claude/Codex/Gemini authentication/network behavior was not exercised.

## 6-24. V6 M16 background image library management (2026-07-10 Codex)

The background-image selector previously exposed every stored copy as a filename-only native dropdown. Repeated imports such as `card-01-clean.png` therefore appeared identical, and users had no safe way to remove old copies. M16 adds a shared Pro/Lite background manager and preserves the existing AppData-backed storage model.

User-facing behavior:
1. `파일 추가` copies the selected source image into the app's user-data background library. It does not move or delete the original file.
2. Pixabay downloads enter the same managed library after download.
3. `배경 관리` opens previews with filename and stable ID suffix, so duplicate filenames can be distinguished.
4. The manager supports filename/ID search, global apply, clear, new file import, and deletion.
5. A background used as the global background, a per-card override, or an image layer cannot be deleted until that reference is removed. This is enforced in both the editor and the storage deletion boundary.
6. Successful deletion removes both the stored AppData file and its `backgrounds.json` index record.

Implementation:
- `src/domain/backgroundLibraryUsage.ts` provides shared active-reference detection; the UI compatibility export remains in `src/ui/backgroundLibraryUsage.ts`.
- `src/storage/deckStore.ts` provides path-contained persistent removal, reloads the persisted workspace before deletion, and uses collision-resistant IDs for manual imports.
- Pro/Lite preload and main-process IPC surfaces expose the same removal contract.
- `src/ui/App.tsx` provides the management modal and ID-aware labels.
- `electron/backgroundManagerSmoke.ts` runs the same real Electron regression flow in both editions.

Verification:
- `npm run typecheck`: passed.
- Targeted storage and UI tests: 31 passed.
- `npm test`: 27 files / 163 tests passed.
- Pro and Lite builds: passed.
- Lite stripping verification: passed.
- Pro and Lite real Electron background-manager smokes: passed.
- Evidence: `.omc/evidence/v6/m16-background-manager/`.

Release note: the existing staged 2.0.0 installers and unpacked EXEs were produced before M16. They do not include this background-manager change; a new packaging run is required before distributing this fix.

## 6-25. M16 Lite distribution package and beginner guide (2026-07-10 Codex)

This append-only section supersedes the M16 release note for the Lite edition. A new Lite installer was produced from the M16 source, verified in isolated output, and copied into a dedicated distribution folder with a self-contained Korean HTML guide.

Distribution folder:
- `release/distribution/Cardnews-Studio-Lite-2.0.0/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- `release/distribution/Cardnews-Studio-Lite-2.0.0/Cardnews-Studio-Lite-사용설명서.html`
- `release/distribution/Cardnews-Studio-Lite-2.0.0/SHA256SUMS.txt`

The root convenience installer `release/Cardnews-Studio-Lite-Setup-2.0.0.exe` is byte-identical to the installer in the distribution folder.

Final artifacts:
- Lite installer: 107,246,518 bytes
- Lite guide: 1,165,596 bytes
- Installer SHA256: `61E35AF125BE37B675FAED9C758B6FFFA6C27078636A6D50D6A7098F4565555B`
- Guide SHA256: `4B0CDADA8BF4D149E66F8C23CE33A2641309535A5CF2340FD03343B4FBA19EBA`

Guide implementation:
1. `scripts/generate-lite-distribution-guide.mjs` embeds four real Lite Electron screenshots as base64 data.
2. The generated output is written to both `docs/Cardnews-Studio-Lite-사용설명서.html` and the installer-bundled `usage.html`.
3. Twelve numbered red overlays identify the card list, preview, editor, PNG action, floating typography toolbar, background manager, and Pro lock.
4. The guide explains installation, SmartScreen/hash verification, first-card editing, typography, background management, PNG export, Lite feature boundaries, AppData behavior, and support links.
5. Playwright desktop 1440x1000 and mobile 390x844 checks found no missing images or horizontal overflow.

Release verification:
- `npm run typecheck`: passed.
- `npm test`: 27 files / 163 tests passed.
- `npm run build:lite`: passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Isolated package `verify-edition` Lite scan: passed.
- Packaged smokes: basic flow, background manager, M15 typography toolbar, and Pro lock all passed.
- Silent NSIS installation into a new `%LOCALAPPDATA%` directory: passed.
- Installed Lite EXE basic-flow smoke: passed.
- Installed `app.asar` guide extraction: four images and 12 markers confirmed.
- Distribution `sha256sum -c`: installer and guide passed.
- Evidence: `.omc/evidence/v6/m17-lite-distribution/`.

Known release limitation: the installer is Authenticode `NotSigned`, so Windows SmartScreen may appear. The bundled guide tells recipients to compare `SHA256SUMS.txt` before choosing `추가 정보` and `실행`. A clean external Windows VM was not available; installation was verified in an isolated per-user directory on the build machine.

## 6-25A. M17 Lite distribution final security and portability restage (2026-07-10 Codex)

This append-only section supersedes the artifact sizes, hashes, SmartScreen wording, and final package path in 6-25. The Lite installer and guide were regenerated after the distribution security review.

Final distribution folder:
- `release/distribution/Cardnews-Studio-Lite-2.0.0/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- `release/distribution/Cardnews-Studio-Lite-2.0.0/Cardnews-Studio-Lite-사용설명서.html`
- `release/distribution/Cardnews-Studio-Lite-2.0.0/SHA256SUMS.txt`

Final artifacts:
- Lite installer: 107,246,754 bytes
- Lite guide: 1,166,389 bytes
- Installer SHA256: `A861E9E2ADF800B4A977C586845333B9A4A2C5E67A5AA9779A34759AC2967E69`
- Guide SHA256: `C46EBAAB053227EB6F6D13ED59689F6C5C318AA10E5C245E1E7DEE09462A83EE`

Final corrections:
1. `electron-builder.lite.json` sets `publish: null`; the final unpacked and silently installed Lite packages contain no inferred `app-update.yml`.
2. SmartScreen guidance no longer treats a hash file received beside the EXE as publisher identity. Users are told to compare against an expected SHA-256 obtained from a separately trusted official post or message.
3. The uninstall section explains that app-managed background copies, settings, work history, and render output can remain under `%APPDATA%\gpt-cardnews-auto\gpt-cardnews-auto`.
4. The generated external and installer-bundled guides contain four real screenshots, 12 numbered markers, and a corrected Windows AppData path.

Final verification:
- `npm run typecheck`: passed.
- `npm test`: 27 files / 163 tests passed.
- `npm run build:lite`: passed.
- `npm audit --omit=dev --json`: zero production vulnerabilities.
- Final isolated package: `%LOCALAPPDATA%\CardnewsStudioRelease\m17-lite-final-20260710-2005`.
- Lite stripping and updater-metadata absence: passed.
- Final unpacked smokes: basic flow, background manager, M15 toolbar, and Pro lock passed.
- Silent installation into `%LOCALAPPDATA%\CardnewsStudioRelease\m17-lite-installed-20260710-2010`: passed.
- Installed executable basic-flow smoke and installed `app.asar` guide extraction: passed.
- Playwright guide QA at 1440x1000 and 390x844: four images loaded, 12 markers present, no horizontal overflow.
- Distribution `sha256sum -c`: installer and guide passed.
- Security re-review: passed with no blockers.
- Review and debugging evidence: `.omc/evidence/v6/m17-lite-distribution/`.

Residual release limitation: Authenticode remains `NotSigned`, so Windows SmartScreen may warn. A clean external Windows VM was not available; the installer was instead exercised through a fresh per-user silent installation on the build machine.

## 6-26. M18 AI assistant, performance, and GPTs quality pass (2026-07-10 Codex)

This append-only section records the source-level AI and GPTs work completed after the M17 Lite distribution. It does not supersede the M17 installer hashes because no EXE packaging was performed for M18.

User-visible outcomes:

1. The AI panel now behaves as a conversation with `꽁돈 AI`: a welcome state, natural quick actions, one message input, user/assistant bubbles, elapsed progress, retry guidance, and a new-conversation action.
2. Internal prompt previews and ambiguous sample-application controls were removed from the normal conversation path.
3. Raw CLI stderr, local paths, hook diagnostics, auth transport messages, unsupported model IDs, and system-prompt text are no longer rendered to the user. Known failures map to concise Korean guidance.
4. Codex runs with a short-lived authentication-only `CODEX_HOME`, `--ephemeral`, ignored user config/rules, and unrelated feature surfaces disabled. The temporary auth copy is removed on every completion, timeout, overflow, spawn failure, and stdin failure path.
5. Provider detection is cached for 30 seconds and explicit `새로고침` bypasses the cache. The preview asset URL map is built once per render, and the progress clock updates every two seconds.
6. Lite still exposes the same editor shell while keeping the AI panel locked as a Pro feature.

Root cause:

- The Electron app previously launched Codex as a machine-scoped developer CLI. It inherited the user's global model, hooks, plugins, memories, and rules, then passed raw process diagnostics into the product UI.
- A minimal real-CLI comparison used `27,872` tokens with the normal Codex home and `2,913` tokens with the authentication-only isolated home, approximately `89.5%` less inherited context. The isolated run completed successfully without hook or skill-loading warnings.

Primary implementation:

- `electron/ai/cliAdapters.ts`: safe executable invocation, provider cache, five-minute default timeout, isolated Codex runtime, bounded output, cleanup, and product-safe error mapping.
- `electron/ai/cliAdapters.test.ts`: command, timeout, CWD, discovery, redaction, and transient-auth lifecycle regression coverage.
- `electron/main.ts`: force-refresh provider IPC and real Electron smoke actions for command isolation and error sanitization.
- `src/ui/aiChat.ts`: conversational system prompt, progress stages, and renderer-side final error normalization.
- `src/ui/App.tsx`: assistant-first chat flow, concise status handling, provider cache reuse, slower progress tick, and preview-map reuse.
- `src/ui/styles.css`: welcome, bubble, retry, and animated progress presentation.

GPTs maintainer source:

- `docs/gpts-template-pack-quality-v3-copy.md` is the canonical GPT Builder copy. It contains the complete Instructions field and four conversation starters.
- The GPT can analyze one to fifty reference cards, define card roles/copy/badges/backgrounds/layer coordinates, generate text-free backgrounds one card at a time, write `kkongdon.cardnews.template-pack.v1` template JSON, and separately create a style-manager `style.json`.
- `docs/gpts-template-pack-ready-kit.md` points maintainers to the canonical v3 text so future edits do not fork the instruction source.

Verification:

- Targeted AI regressions: 15 passed.
- Full suite: 27 files / 168 tests passed.
- `npm run typecheck`: passed.
- Pro and Lite production builds: passed.
- Lite stripping verification: passed.
- Pro real Electron smokes: provider command, sanitized error, raw chat, timeout progress, and full AI workflow passed.
- Lite real Electron edition regression: passed with the `Pro에서 사용 가능` AI lock.
- Debugging audit with three runtime-evidenced hypotheses: `.omc/evidence/v6/m18-ai-assistant-performance-gpts/debugging-audit.md`.
- Screenshots and renderer text snapshots: `.omc/evidence/v6/m18-ai-assistant-performance-gpts/`.

Release note: the M17 packaged Lite installer and any existing Pro installer do not include M18. Re-run the dual-edition release gates before distributing these AI changes in an EXE.

## 6-26A. M18 security and final validation correction (2026-07-10 Codex)

This append-only correction supersedes the M18 test counts and final-runtime claims in 6-26. It does not replace or modify any previously packaged installer.

Final security boundary:

1. Provider discovery now uses a non-secret environment, and each real provider invocation receives only its own credential variables.
2. Codex runs from a short-lived authentication-only home. User hooks, rules, plugins, memories, and unsupported global model settings are excluded.
3. Windows script invocation rejects command-shell metacharacters, provider version text is sanitized, and non-PATH executable candidates must exist.
4. Timeout and stream failures terminate the full child process tree, wait for closure, and then remove temporary authentication data. Interrupted-session leftovers are cleaned with a path-contained stale-home policy.
5. Provider errors are converted into concise Korean product guidance. Smoke evidence stores booleans instead of local executable or workspace paths.

Final validation:

- Typecheck: passed.
- Targeted AI/runtime regressions: 3 files / 21 tests passed.
- Full suite: 28 files / 174 tests passed.
- Pro and Lite production builds: passed.
- Lite stripping verification and Lite edition-lock smoke: passed.
- Five Pro Electron AI smokes passed: command isolation, error sanitization, natural chat, delayed progress, and full workflow.
- A non-mock Codex request through the built isolated adapter returned `OK`; no transient Codex directory remained afterward.
- Production dependency audit reported zero vulnerabilities at the high-severity gate.
- Evidence hygiene scan passed with no local paths, authentication filenames, hook data, unsupported-model tokens, or provider secret names retained.

Canonical evidence:

- `.omc/evidence/v6/m18-ai-assistant-performance-gpts/debugging-audit.md`
- `.omc/evidence/v6/m18-ai-assistant-performance-gpts/verification-summary.md`
- `.omc/evidence/v6/m18-ai-assistant-performance-gpts/`

GPT Builder maintenance source remains `docs/gpts-template-pack-quality-v3-copy.md`. It covers one to fifty reference cards, text-free background generation, card copy and badge planning, normalized layer placement, template-pack JSON, and a separate style-manager JSON workflow.

Packaging status: M18 was not packaged as an EXE. The final local renderer output was restored to Pro after the Lite verification pass.

## 6-26B. M18 final modularity correction (2026-07-10 Codex)

This append-only correction supersedes the M18 implementation ownership description in 6-26 while preserving the user-visible behavior and validation claims in 6-26A.

The AI CLI boundary is now divided by responsibility:

- `electron/ai/cliEnvironment.ts`: provider-safe environments, transient Codex authentication home creation, and stale-home cleanup.
- `electron/ai/cliExecutable.ts`: executable candidates, Windows invocation, command quoting, and version sanitization.
- `electron/ai/cliProcessTree.ts`: child-process-tree termination.
- `electron/ai/cliProviderDefinitions.ts`: provider definitions and command construction.
- `electron/ai/cliProviderErrors.ts`: concise product-safe Korean errors.
- `electron/ai/cliProviderDiscovery.ts`: provider probing, 30-second cache, refresh, and status deduplication.
- `electron/ai/cliProviderProcess.ts`: bounded process streams, timeout, overflow, termination, and cleanup.
- `electron/ai/cliAdapters.ts`: public provider orchestration facade.
- `electron/ai/cliRuntime.ts`: compatibility re-export facade for existing callers and tests.

Every listed M18 AI TypeScript module is below 250 physical lines. The largest is `cliProviderProcess.ts` at 214 lines; `cliAdapters.ts` is 100 lines and `cliRuntime.ts` is 17 lines. The trust-folder recovery message no longer exposes internal CLI flags.

Post-split verification:

- Typecheck: passed.
- Full suite: 28 files / 174 tests passed.
- Pro and Lite production builds: passed.
- Lite stripping verification and Lite edition-lock smoke: passed.
- Five Pro Electron AI smokes passed after the final Pro rebuild.
- A real non-mock Codex request through the built isolated adapter returned `OK`.
- Temporary Codex-home count after the real request: zero.
- Production dependency audit: zero vulnerabilities.
- Forbidden TypeScript escape-hatch scan: passed.
- `git diff --check`: passed; only routine Windows LF-to-CRLF notices were emitted.

Packaging status remains unchanged: M18 was not packaged as an EXE. The final local renderer output is Pro.

## 6-26C. M18 final test and evidence hygiene correction (2026-07-10 Codex)

This append-only correction supersedes the final test-file count in 6-26A and 6-26B. No product behavior or packaging status changed.

Final review corrections:

1. `electron/ai/cliAdapters.test.ts` was split by responsibility. Command, working-directory, error, discovery, and timeout-configuration checks remain there; transient authentication and process-timeout lifecycle checks moved to `electron/ai/cliAdapters.lifecycle.test.ts`.
2. Shared environment and fake-CLI test utilities moved to `electron/ai/cliTestHelpers.ts`.
3. Every M18 AI production, test, and helper TypeScript module is now below 250 physical lines. The largest is `electron/ai/cliProviderProcess.ts` at 214 lines.
4. Provider-command Electron evidence now records only boolean contract outcomes. Internal CLI flags, recovery environment names, paths, model identifiers, hooks, authentication filenames, and provider secrets are not persisted.

Final corrected verification:

- Typecheck: passed.
- Focused AI/runtime suite: 4 files / 21 tests passed.
- Full suite: 29 files / 174 tests passed.
- Regenerated Pro provider-command Electron smoke: passed.
- M18 canonical evidence hygiene scan: passed.
- Packaging status: no M18 EXE was created; current local renderer output remains Pro.

## 6-26D. M18 AI preset retry and final review correction (2026-07-11 Codex)

This append-only correction supersedes the stale M18 test counts, preset-flow assumptions, and quantitative local-context note in 6-26 through 6-26C. No M18 EXE was created.

Final behavior correction:

1. Preset quick actions keep the user-facing label and internal execution prompt as separate values.
2. A failed preset retry now repeats the same friendly user bubble instead of exposing research-role, mode, brand, or other internal instruction text.
3. The preset-mode Electron smoke now exercises the current immediate quick-action workflow. Research, image, and draft actions use natural labels; only the draft result exposes the card-application action.
4. The performance result is retained as a qualitative isolation improvement: machine-wide hooks, rules, plugins, memories, and unsupported global model settings are excluded from app-scoped Codex requests. Historical machine-specific token figures in 6-26 are not canonical release evidence.

Final corrected verification:

- `npm run typecheck`: passed.
- Focused AI/runtime suite: 4 files / 21 tests passed.
- Full suite: 29 files / 174 tests passed.
- Pro and Lite production builds: passed.
- Lite stripping verification and Lite edition-lock smoke: passed.
- Seven Pro Electron AI smokes passed: provider command, error sanitization, natural chat, delayed progress, workflow, preset mode, and preset retry.
- A real non-mock Codex request through the built isolated adapter returned `OK`.
- Temporary Codex-home count after the real request: zero.
- Production dependency audit at the high-severity gate: zero vulnerabilities.
- Canonical M18 evidence hygiene and forbidden TypeScript escape-hatch scans: passed.

Canonical test and evidence locations:

- `src/ui/aiChat.test.ts`
- `electron/ai/cliAdapters.test.ts`
- `electron/ai/cliAdapters.lifecycle.test.ts`
- `electron/ai/cliRuntime.test.ts`
- `.omc/evidence/v6/m18-ai-assistant-performance-gpts/verification-summary.md`
- `.omc/evidence/v6/m18-ai-assistant-performance-gpts/debugging-audit.md`
- `.omc/evidence/v6/m18-ai-assistant-performance-gpts/`

Packaging status remains unchanged: the current local renderer output is Pro, and the M17 Lite installer does not contain these M18 AI changes. Run the dual-edition release gates before distributing an EXE with M18.

## 6-26E. M18 release-gate structural correction (2026-07-11 Codex)

This append-only correction records the final pre-packaging structure and cache fixes. No M18 EXE was created in this step.

1. AI conversation state and transitions moved from `src/ui/App.tsx` to `src/ui/useAiAssistant.ts`; pure preset, draft-detection, and next-action helpers moved to `src/ui/aiAssistantModel.ts`.
2. M18 Electron smoke automation moved from `electron/main.ts` into responsibility-focused modules under `electron/ai/smoke/`. Each new M18 AI module remains below 250 physical lines.
3. Provider discovery now uses its 30-second cache during normal hydration. Only the explicit UI refresh action forwards `forceRefresh: true` through the edition API, preload, and IPC boundary.
4. The manual QA matrix is `.omc/evidence/v6/m18-ai-assistant-performance-gpts/manual-qa-matrix.md`.
5. `.omx/notepad.md` records the current completion and packaging boundary for session recovery.
6. A post-refactor Electron workflow smoke found that successful assistant messages retained `loading` status and hid capability notes. Success now transitions to `complete`; completed messages remain in chat history, while loading/error placeholders remain excluded.
7. AI smoke modules are dynamically loaded only for explicit smoke actions and excluded from Pro packages by `electron-builder.pro.json`. An isolated directory package confirmed that `app.asar` contains no smoke module.

## 6-26F. M18 packaging-boundary and final-review clarification (2026-07-11 Codex)

This append-only clarification supersedes only the ambiguous packaging wording in 6-26 through 6-26E. It does not change the previously recorded implementation or test results.

1. No M18 installer or staged `release/` artifact was produced in this work, and the project `release/` directory was unchanged.
2. A disposable isolated unpacked Pro executable was created under the local application-data root only to inspect the packaged `app.asar` payload.
3. That inspection confirmed `dist-electron/electron/ai/smoke/**` is absent from the production package. The isolated executable is test evidence, not a distribution artifact.
4. The current independent code-quality and package review is `.omo/evidence/m18-ai-assistant-performance-gpts-code-review.md`; it reports no findings or blockers and approves M18.
5. Older M18 review artifacts that predate the final dynamic-import, type-narrowing, package-inspection, and successful-state fixes are superseded by the current review above.

Release boundary: M18 source and isolated package validation are complete. Dual-edition installer packaging and staging into `release/` remain a separate release step.

## 6-26G. M18 Pro portable release refresh (2026-07-11 Codex)

This append-only section supersedes the Pro portable-folder portion of 6-26F. It does not claim a Pro installer or Lite release refresh.

1. Built the current M18 Pro edition into an isolated `%LOCALAPPDATA%` package output.
2. Confirmed the isolated `app.asar` contains the M18 AI provider modules and excludes the smoke-only modules under `electron/ai/smoke`.
3. Launched the isolated Pro executable through the normal user entry point and observed the `Cardnews Studio` main window.
4. Moved the previous `release/win-unpacked-pro-2.0.0` folder to a rollback backup outside the repository, then staged the validated M18 package into that release path.
5. Launched the staged release executable and observed the `Cardnews Studio` main window.
6. Confirmed the staged executable and `app.asar` hashes match the isolated validated package.

Current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `8860c4a624d2dcdca2d02de78920b78969b2c1cd5c9c41c137d848b50ad260a3`
- Startup QA: PASS
- M18 AI modules present: PASS
- Smoke-only production exclusion: PASS

Release boundary: the Pro portable folder now includes M18. No installer was rebuilt, and Lite release artifacts remain unchanged.

## 6-26H. M18 Pro portable production-payload correction (2026-07-11 Codex)

This append-only correction supersedes the Pro hashes and package-boundary claim in 6-26G. It does not claim a Pro installer or a Lite release refresh.

1. Independent package review found that the first M18 Pro portable package still contained compiled QA helpers outside `electron/ai/smoke`: `backgroundManagerSmoke.js` and `cliTestHelpers.js`.
2. `electron/main.ts` now ignores every smoke-action environment variable when `app.isPackaged` is true and dynamically imports the background-manager smoke only in non-packaged development QA.
3. `electron-builder.pro.json` now excludes smoke directories, compiled test files, `cliTestHelpers.js`, and `*Smoke.js` from production `app.asar`.
4. The clean isolated Pro package was rebuilt and staged to `release/win-unpacked-pro-2.0.0`. Its 178-entry `app.asar` contains the M18 provider modules and zero matching test/smoke/helper payload entries.
5. Exact-executable startup QA filtered processes by the staged Pro folder, verified the renderer DOM reports the Pro edition, and captured the initialized `Cardnews Studio Pro` window in `.omc/evidence/v6/m18-ai-assistant-performance-gpts/release-pro-window.png`.
6. A same-title Lite process caused one superseded screenshot, and an early three-second capture recorded the Pro window before renderer initialization. Neither is canonical evidence; the exact-path, initialized Pro screenshot and startup JSON are canonical.
7. The reported `0x80000003` dialog followed a QA script's forced Electron process-tree termination. A clean reproduction remained responsive for 18 seconds, accepted a normal window-close request, exited with zero remaining Pro processes, and produced zero matching Windows crash events. Final QA teardown now uses graceful close.

Current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `660621b8de98caeb0d2c988b4e913a0e4bc32ecae4aa626d2a0c2bce5da060f9`
- `app.asar` SHA-256: `e148ffeec318b192279d168db33fa335d525044af61f4b383c819a3ef5e5846f`
- Typecheck: PASS
- Full Vitest suite: PASS, 29 files / 174 tests
- Pro production build: PASS
- Exact-path Pro startup, renderer, and graceful-close QA: PASS
- Production test/smoke/helper exclusion: PASS

Release boundary: distribute the full `release/win-unpacked-pro-2.0.0` folder for the current portable Pro build. No Pro installer was rebuilt, and Lite artifacts were not changed in this correction.

## 6-26I. M18 Pro packaged-window and final crash correction (2026-07-12 Codex)

This append-only correction supersedes only the Pro hashes and final packaged-runtime claim in 6-26H. It does not claim a Pro installer or a Lite release refresh.

1. Final independent source review found that packaged builds still read the development-only `CARDNEWS_SMOKE_VIEWPORT_WIDTH` and `CARDNEWS_SMOKE_VIEWPORT_HEIGHT` variables.
2. `electron/main.ts` now ignores those variables whenever `app.isPackaged` is true, matching the existing packaged-mode guards for smoke actions, screenshots, and text capture.
3. Typecheck, the full 29-file / 174-test Vitest suite, and the Pro production build passed after the correction.
4. A new isolated Pro package was built. Its 178-entry `app.asar` contains the M18 provider module and no compiled test, smoke, `cliTestHelpers.js`, or `*Smoke.js` payload.
5. The project workspace ACL denied deleting or renaming the existing release directory. Because the previous package already had the same clean production file set, staging replaced its files from the isolated package and then verified exact executable and `app.asar` hash equality.
6. The exact staged executable rendered `Cardnews Studio Pro` at the normal 1280 by 880 window size. A fresh normal close completed in 1.2 seconds with zero remaining Pro processes and zero matching Windows crash events.
7. The reported `0x80000003` dialog remains classified as an earlier forced-QA-teardown artifact. It did not reproduce through normal launch and window close.

Current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `3d3d2c39371b3dabedb17ab81cf0e73f90a480b8ea34b4f0ad5d6bab64104af2`
- `app.asar` SHA-256: `594c94aa61243dbfead30edb407f0e9373cd6e65be8076b28b5d9030ad0d473a`
- Exact-path Pro startup and initialized-window capture: PASS
- Graceful close and Windows crash-event check: PASS
- Production test/smoke/helper exclusion: PASS

Release boundary: distribute the full Pro portable folder. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26J. M18 Pro packaged development-path security correction (2026-07-12 Codex)

This append-only correction supersedes only the Pro hashes and packaged security claim in 6-26I. It does not claim a Pro installer or a Lite release refresh.

1. Final security review found that a packaged executable could still honor `VITE_DEV_SERVER_URL`, and the production archive retained `cliMock.js` plus environment-controlled mock AI/style branches.
2. `electron/main.ts` now accepts the development server URL, style-extraction mock, and AI mock permission only when `app.isPackaged` is false.
3. `electron/ai/cliAdapters.ts` now requires the caller's explicit non-packaged `allowMock` capability and dynamically imports the mock module only on that development path.
4. `electron-builder.pro.json` excludes `cliMock.js` in addition to tests, test helpers, smoke directories, and `*Smoke.js` files.
5. Typecheck, the full 29-file / 174-test Vitest suite, and the Pro production build passed after the correction.
6. The staged 177-entry `app.asar` contains the real provider process module and zero mock, test, helper, or smoke payload entries.
7. A malicious-environment launch of the exact staged executable ignored the injected development URL, loaded the packaged file renderer, reported the Pro edition, and displayed the initialized `Cardnews Studio Pro` workspace.
8. Normal close completed in 1.2 seconds with zero remaining Pro processes and zero matching Windows crash events.

Current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `1450446d9e26defea16a34f5b8ec73e6d1a557bcdc28aa62324649fef26b8bf1`
- `app.asar` SHA-256: `bb24c2f5fa93ae86fe8084ba2f92023ae460e84d6284cac79e7acff24338d503`
- Packaged development-server injection block: PASS
- Packaged mock AI/style block and mock payload exclusion: PASS
- Exact-path Pro startup, initialized-window capture, graceful close, and Windows crash-event check: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26O. M18 Pro smoke-payload removal and final portable refresh (2026-07-12 Codex)

This append-only correction supersedes the Pro folder, hashes, archive count, and packaged QA-code claim in 6-26N. It does not claim a Pro installer or a Lite release refresh.

1. Final code review found residual smoke-only image-library and export branches in the packaged main/store modules; the prepared main no longer declared `smokeAction`, so those handlers also carried a runtime reference risk.
2. `scripts/prepare-pro-package.mjs` now removes the residual image-list, export, attribution, and image-store smoke paths from the compiled production package while preserving normal user image-library and save-dialog behavior.
3. A force-rebuilt isolated Pro package produced a 147-entry `app.asar` with zero case-insensitive smoke, mock, development-server, Lite-entry, test, declaration, source-map, or build-metadata findings.
4. The exact staged executable ignored malicious development/mock environment values, loaded the packaged file renderer, displayed `Cardnews Studio Pro`, and did not render injected content.
5. The packaged image-library IPC returned seven persisted user items, proving the corrected handler executes without an undefined smoke variable.
6. Browser-driven graceful close completed in 0.12 seconds with exit code 0, zero remaining processes, and zero matching Windows crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0-final/Cardnews Studio Pro.exe`
- Executable SHA-256: `19c111df1fddb63a093428d3a39a3f15eaa01b13bfa5ad37e103ae028db21435`
- `app.asar` SHA-256: `9d560157278a6e0355ffcaea4b4ffe994391eeb17f8e379edd7f869525813585`
- Screenshot: `.omc/evidence/v6/m18-ai-assistant-performance-gpts/release-pro-window-final.png`
- Exact-path startup, Pro renderer, injected-page rejection, image-library IPC, graceful close, Windows crash-event check, and full production payload scan: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0-final` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26Q. M18 Pro shared Lite CSS removal (2026-07-12 Codex)

This append-only correction supersedes the hashes and final Pro payload claim in 6-26P.

1. Independent gate review found 31 unused `.lite-*` selectors in the shared production stylesheet.
2. Pro package preparation now parses built CSS with PostCSS and removes only rules whose selector contains `.lite-`.
3. The final 146-entry archive has zero Lite selectors and zero app-owned smoke/mock/dev-server or Lite-entry findings.
4. The exact staged executable visually restored real card content after the CSS strip, returned seven image-library items, and exited with code 0 in 0.07 seconds with zero residual processes or crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0-final/Cardnews Studio Pro.exe`
- Executable SHA-256: `240630c980b8ef8184d95e2dc8d3eea095ebc618a71552a2fae8b68a0e7d9cfc`
- `app.asar` SHA-256: `37ffc5bd3f2ca19cd8c577ac5f8e2c96c978699fd69ecc6f5404091f0d4cbe7c`
- Exact-path startup, restored-card rendering, Pro UI, image-library IPC, graceful close, Windows crash-event check, app-owned QA scan, and Lite CSS selector scan: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0-final` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26P. M18 Pro final QA-marker and Lite-guide removal (2026-07-12 Codex)

This append-only correction supersedes the hashes, archive count, and QA-text claim in 6-26O.

1. Independent review confirmed the smoke-handler bug was fixed, then found production renderer `data-smoke-*` attributes, an unused mock draft helper, a packaged `allowMock` option, and the Lite-only usage guide.
2. Pro package preparation now renames renderer QA attributes to product-neutral `data-cardnews-*`, removes the unused mock helper and packaged mock option, and omits the Lite guide from the Pro archive.
3. The final 146-entry archive has zero smoke/mock/dev-server findings across all app-owned `dist` and `dist-electron` files. React scheduler's official third-party `unstable_mock` files remain unchanged and are explicitly outside the app-owned gate.
4. The exact staged executable restored and rendered real card content, returned seven image-library items, rejected injected development content, and exited with code 0 in 0.06 seconds with zero residual processes or crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0-final/Cardnews Studio Pro.exe`
- Executable SHA-256: `78143364451db8d0f549070f421365a18da9878aafd9fcf6f3ee0da1a84c971d`
- `app.asar` SHA-256: `76546d1292ef8ef56bc810705bbc4891706435fd5a478fcb20dc858454f138e6`
- Exact-path startup, restored-card rendering, Pro UI, injected-page rejection, image-library IPC, graceful close, Windows crash-event check, and app-owned production payload scan: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0-final` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26N. M18 Pro build-metadata payload correction (2026-07-12 Codex)

This append-only correction supersedes the Pro hashes and archive count in 6-26M. It does not claim a Pro installer or a Lite release refresh.

1. Final code review found that TypeScript incremental-build metadata retained historical Lite, helper, mock, and smoke path strings even though those executable files were absent.
2. `electron-builder.pro.json` now excludes TypeScript build metadata, declarations, declaration CommonJS files, and source maps from the Pro archive.
3. The final 172-entry `app.asar` contains zero Lite entry, TypeScript build metadata, declaration, source-map, test, helper, mock module, mock environment reference, smoke file, development-server reference, smoke action, smoke function, or smoke capture payload matches.
4. Canonical release audit JSON files now record the exact final hashes and archive count.
5. The exact final staged executable again rendered Pro from the packaged file URL under malicious environment values and closed normally in 0.16 seconds with zero remaining processes and zero crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `64f96614648c2dfd5517aceaa722c752d5dab200487b417d89d745b6d6134544`
- `app.asar` SHA-256: `44dacb8a025d55eaf2dfbfce6d17aa9eedb8104a02c80ae0e7930c6aa1711fa1`
- Exact-path startup, Pro renderer, injected-page rejection, initialized screenshot, graceful close, Windows crash-event check, production payload scan, and evidence consistency check: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26M. M18 Pro mock-reference payload correction (2026-07-12 Codex)

This append-only correction supersedes the Pro hashes and final mock-payload claim in 6-26L. It does not claim a Pro installer or a Lite release refresh.

1. Final code review required mock AI and mock style references to be absent from production files, not merely unreachable through packaged runtime guards.
2. `scripts/prepare-pro-package.mjs` now removes the mock style IPC branch from the production main entry and the mock AI branch from the production CLI adapter before packaging.
3. The final 174-entry `app.asar` contains zero Lite entry, test, helper, mock module, mock environment reference, smoke file, development-server reference, smoke action, smoke function, or smoke capture payload matches.
4. The exact final staged executable again rejected malicious development-server and mock environment values, loaded the packaged renderer, reported the Pro edition, and produced the fresh canonical screenshot.
5. Normal close completed in 0.24 seconds with zero remaining Pro processes and zero matching Windows crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `2c4f64a60d020fe0520c47c76e077031e5050a3ce4c95e1d1d471194a16af08f`
- `app.asar` SHA-256: `7cf5dc3349bad330c225592a8dfd6b41f3a07adf8580417c4d9bc1327e5267ed`
- Exact-path Pro startup, Pro renderer, injected-page rejection, initialized screenshot, graceful close, Windows crash-event check, Pro-only payload scan, and production mock-reference scan: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26L. M18 Pro edition-payload isolation correction (2026-07-12 Codex)

This append-only correction supersedes the Pro hashes and archive count in 6-26K. It does not claim a Pro installer or a Lite release refresh.

1. Security re-review found that the Pro archive still included unused compiled Lite main and preload artifacts.
2. `electron-builder.pro.json` now excludes `lite-main.js` and every `preload-lite.*` artifact from the Pro package.
3. The final 174-entry `app.asar` contains zero Lite entry, test, helper, mock, smoke-file, development-server, smoke-action, smoke-function, or smoke-capture payload matches.
4. The exact final staged executable again rejected malicious development-server and mock environment values, loaded the packaged renderer, reported the Pro edition, and produced the fresh canonical screenshot.
5. Normal close completed in 0.16 seconds with zero remaining Pro processes and zero matching Windows crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `2958b4aeb4ca9b75e6859b1c0ba9cea57d8432f88b35b6489af8ae13c2850795`
- `app.asar` SHA-256: `320ef0a12641204e8ffc8c6e9be9266ae594ac979488e0d937647cb4b98ac429`
- Exact-path Pro startup, Pro renderer, injected-page rejection, initialized screenshot, graceful close, Windows crash-event check, and Pro-only payload scan: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26K. M18 Pro production-main payload correction (2026-07-12 Codex)

This append-only correction supersedes the Pro hashes and final payload claim in 6-26J. It does not claim a Pro installer or a Lite release refresh.

1. Final security re-review found that the packaged main entry still embedded unreachable development smoke functions even though packaged runtime guards prevented their execution.
2. `scripts/prepare-pro-package.mjs` now creates the production-only Pro main entry after `build:pro` and before Electron packaging. It removes development-server handling and the smoke capture/action runtime from the shipped main process while leaving the development build and smoke harness source intact.
3. Both `package:dir:pro` and `dist:win:pro` invoke this preparation gate before Electron Builder.
4. The final 177-entry `app.asar` contains zero test, helper, mock, smoke-file, or embedded main-process QA symbols and retains the real AI provider process module.
5. The exact staged executable was launched with malicious development-server and mock environment values. It loaded the packaged file renderer, reported the Pro edition, did not render injected content, and displayed the initialized `Cardnews Studio Pro` workspace captured in the canonical screenshot.
6. Normal close completed in 0.23 seconds with zero remaining Pro processes and zero matching Windows crash events.

Final current Pro portable artifact:

- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- Executable SHA-256: `13db04c8c2c8ba3b34d8d949e42d3b67467f1314f2912ded9167e70fececbae2`
- `app.asar` SHA-256: `7d6585cc367405489a1b36017bff82f9b50308c37498ea59413a91a88758085d`
- Production main embedded QA-symbol count: `0`
- Exact-path Pro startup, Pro renderer, injected-page rejection, initialized screenshot, graceful close, and Windows crash-event check: PASS

Release boundary: distribute the complete `release/win-unpacked-pro-2.0.0` folder. The EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26R. M18 current Pro portable release pointer (2026-07-12 Codex)

This final append-only pointer supersedes all earlier Pro portable hashes and folder references in section 6-26.

- Current folder: `release/win-unpacked-pro-2.0.0-final`
- Current executable: `release/win-unpacked-pro-2.0.0-final/Cardnews Studio Pro.exe`
- Executable SHA-256: `240630c980b8ef8184d95e2dc8d3eea095ebc618a71552a2fae8b68a0e7d9cfc`
- `app.asar` SHA-256: `37ffc5bd3f2ca19cd8c577ac5f8e2c96c978699fd69ecc6f5404091f0d4cbe7c`
- Archive entries: 146
- App-owned smoke/mock/dev-server findings: 0
- Pro stylesheet `.lite-*` selectors: 0
- Exact staged EXE restored real cards, returned seven image-library items, exited with code 0 in 0.07 seconds, and left zero processes or Windows crash events.
- Screenshot: `.omc/evidence/v6/m18-ai-assistant-performance-gpts/release-pro-window-final.png`

Distribute the complete `release/win-unpacked-pro-2.0.0-final` folder; the EXE is not standalone. No Pro installer was rebuilt, and Lite artifacts were not changed.

## 6-26S. M19 Pro installer distribution release (2026-07-12 Codex)

This append-only entry supersedes the earlier statement that no current Pro installer exists. The portable pointer in 6-26R remains valid for portable distribution.

1. `electron-builder.pro.json` now copies the Pro HTML guide and third-party notices to the installation root.
2. `scripts/generate-pro-distribution-guide.mjs` creates a standalone Pro guide from the existing Playwright-backed manual, with all screenshots embedded.
3. `scripts/assemble-pro-distribution.mjs` creates the public distribution folder with installer, guide, README, and SHA-256 manifest.
4. Typecheck and all 174 tests passed before packaging.
5. The NSIS installer was built in an isolated `%LOCALAPPDATA%` output, installed into an isolated user directory with exit code 0, launched the packaged `app.asar` renderer responsively, and included the guide in the installed application root.

Current Pro installer distribution:

- Installer: `release/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- Installer SHA-256: `2f358f30c9c765dd5c504bf26c546a36f9d2b79e6c4b1cd0af49f7ec6ec313e2`
- Public folder: `release/distribution/Cardnews-Studio-Pro-2.0.0/`
- Public ZIP: `release/distribution/Cardnews-Studio-Pro-2.0.0.zip`
- ZIP SHA-256: `b413869af79ff9ad381a2fc78a160b796a09ecda3c2d2b4dd43480604a582351`
- Verification: `.omc/evidence/v6/m19-pro-installer-release/verification-summary.md`

Public delivery recommendation: send `release/distribution/Cardnews-Studio-Pro-2.0.0.zip`. Users can extract it and run the installer; the same HTML guide is also copied into the installed program folder.

Known release note: the installer is not Authenticode-signed, so Windows SmartScreen can show an unknown-publisher warning until a code-signing certificate is configured.

## 6-26T. M20 Windows DPI-safe PNG rendering correction (2026-07-14 Codex)

This append-only entry records the M20 implementation and isolated QA state. It does **not** supersede the public release pointers above because T14-T16 are not complete and nothing was copied into `release/`.

### Root cause and correction

1. The shared renderer could capture a DPI-scaled visible surface, so a 4:5 card that must be `1080x1350` became values such as `1620x1394` or `1950x2130` on non-100% Windows display scaling.
2. Production rendering now uses an offscreen `paint` frame with render-only `deviceScaleFactor: 1`, probes the `.card` rectangle, waits for fonts/images, rejects stale frames, and records structured sanitized diagnostics.
3. Normalization is permitted only when the source is a valid card-only surface with the correct aspect and scale relationship. Missing-card and wrong-aspect inputs fail closed and do not publish a partial PNG.
4. The written PNG is independently decoded and must match the centralized ratio contract exactly: 4:5 `1080x1350`, 1:1 `1080x1080`, 16:9 `1920x1080`, and 4:3 `1440x1080`.
5. Lite and Pro continue to call the same renderer; no edition-specific rendering fork was added.

### Verification completed

- Typecheck: PASS.
- Full automated suite: PASS, 33 files / 227 tests.
- Shared source matrix: PASS, 40/40 (2 editions x 4 ratios x 5 scale factors).
- Independent PNG decode and exact-dimension check: PASS, 40/40.
- Visual parity/crop check: PASS, 40/40; contact sheet and diff images show no clipping or viewport whitespace.
- Controlled missing-card and wrong-aspect failures: PASS; stable failure codes and no PNG publication.
- Lite edition/regression gates: PASS; dedicated DPI matrix 20/20.
- Pro regression gates: PASS; dedicated DPI matrix 20/20.
- Isolated unpacked Lite black-box matrix: PASS, 20/20, zero forced terminations.
- Isolated unpacked Pro black-box matrix: PASS, 20/20, zero forced terminations.
- Package scanner: PASS with zero forbidden payload findings.

Evidence root:

- `.omc/evidence/v6/m20-dpi-safe-render-dimensions/`
- Visual review: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/manual-qa.md`
- Debug reasoning: `.debug-journal.md`

### Isolated QA candidates (not release-staged)

Lite:

- Installer: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\lite-final3-20260714\Cardnews-Studio-Lite-Setup-2.0.0.exe`
- Installer SHA-256: `4e372c234db8fb968f4a81d7a7560e29c7b67a44048c1a8efadeda25b3f2cff2`
- Unpacked EXE: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\lite-final3-20260714\win-unpacked\Cardnews Studio Lite.exe`
- EXE SHA-256: `95c64972657107d453dc40eb77809a361260c772dbce47f4e1ce772d7a79d7b7`
- `app.asar` SHA-256: `e7eefc5c14634c04e5126eaecb55c7f6c4a4297559797aa0a53d504957956c73`

Pro:

- Installer: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\pro-final3-20260714\Cardnews-Studio-Pro-Setup-2.0.0.exe`
- Installer SHA-256: `1a08e64595c60793c9457b8785e4205cfbc628e7ff63a954e542284216a0cd05`
- Unpacked EXE: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\pro-final3-20260714\win-unpacked\Cardnews Studio Pro.exe`
- EXE SHA-256: `1cb5cc2e74bd1d71b240982a79081595bdef847f2108d544a3ef8f09a917f8a4`
- `app.asar` SHA-256: `eb44ef22ad19454e191c66d9bd05c1368f7b2756b44d575728cdb0c955fbd1fb`

### Remaining release blockers

1. T14 clean Windows installer QA is BLOCKED because no clean VM/Sandbox/separate Windows account was available.
2. T15 upgrade and user-data preservation QA is BLOCKED because no disposable profile with the current distributed Lite build and representative user data was available.
3. The package payload portion of T16 passed, but Microsoft Defender is disabled on this machine and `MpCmdRun` returned exit code 2 (`0x80004005`). The artifacts are also not Authenticode-signed, so T16 remains BLOCKED.
4. T17 release staging was intentionally not run. Do not replace public Lite/Pro artifacts with these candidates until T14-T16 pass.

Product/support conclusion: users do not need a manual canvas-size control. Once an M20 build clears the remaining release gates, selecting 4:5 must automatically export exactly `1080x1350` at every supported Windows display scale.

## 6-26U. M20 디버깅/에러 제거 계획 인수인계 정정 (2026-07-14 Codex)

이 append-only 항목은 6-26T의 `final3` 후보와 자동 검증 수치를 현재 계획 상태로 정정한다. 이번 단계에서는 제품 코드와 EXE를 수정하지 않았다.

1. 다른 구현 모델이 따라야 할 단일 실행 계획은 `.omx/plans/m20-debugging-error-removal-handoff.md`다.
2. 계획은 DPI 배수 크기, stale/blank frame, crop/stretch, 폰트/이미지 readiness, 진단 정보 노출, Lite/Pro QA payload, 후보 증거 혼합, 사용자 오류 메시지를 각각 E1-E8로 분리한다.
3. source matrix는 56/56, 성공 PNG 독립 검증은 54/54, Lite packaged matrix는 20/20, Pro packaged matrix는 20/20, package scanner는 findings 0이다.
4. 독립 코드 리뷰는 M20 code/debug `APPROVE`, code quality `WATCH`, 코드 blocker 0으로 완료됐다. 보고서는 `.omo/evidence/v6-m20-dpi-safe-render-dimensions-code-review.md`다.
5. 현재 권위 있는 참고 후보는 Lite `lite-final4-20260714-1155`와 Pro `pro-final4b-20260714-1156`이다. `pro-final4-20260714-1155`는 실패한 부분 출력이므로 사용 금지다.
6. `.omc/evidence/v6/m20-dpi-safe-render-dimensions/verification-summary.json`은 아직 final3/40/40/227 테스트를 가리키는 historical summary다. 다음 모델은 제품 코드보다 먼저 final4 전용 canonical summary/meta 정합성을 닫아야 한다.
7. 새 재현 실패가 없으면 렌더 엔진을 다시 작성하지 않는다. D2-D6에서 실패가 증명된 경우에만 RED 테스트 후 최소 수정하고, 제품 코드가 바뀌면 기존 final4 패키지와 독립 리뷰 승인을 폐기한다.
8. T14 clean install, T15 upgrade/data preservation, T16 Defender/Authenticode는 계속 BLOCKED다. T17과 `release/` 교체는 금지한다.

다음 구현 모델용 시작 명령은 계획 문서의 `9. 다른 모델에 전달할 실행 명령`을 그대로 사용한다.

## 6-26V. M20 실제 디버깅 수정 및 재검증 (2026-07-14 Codex)

이 append-only 항목은 6-26U 이후 실제 제품 코드에 들어간 디버깅 수정과 검증 결과다. 이번 변경으로 기존 `final4/final4b` 패키지와 독립 코드 리뷰 승인은 더 이상 현재 소스의 배포 승인 증거가 아니며, 배포 전 새 candidate ID로 D5-D7을 다시 수행해야 한다.

### 수정한 문제

1. `harness-final4`까지 현재 환경에서 `GPU process exited unexpectedly: exit_code=-1073741515`로 실패했다. 이는 DPI 계산 오류가 아니라 Electron/Chromium sandboxed helper 프로세스가 오프스크린 paint 시작 전에 실패하는 문제였다.
2. `--no-sandbox` 단일 실행 옵션을 붙인 동일 하네스는 즉시 `1080x1350`으로 통과했다.
3. `electron/main.ts`, `electron/lite-main.ts`, `scripts/render-dimension-smoke.mjs`에 `app.commandLine.appendSwitch("no-sandbox")`와 `app.disableHardwareAcceleration()`을 적용했다. `BrowserWindow`의 `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` 설정은 유지했다.
4. AI CLI provider 테스트가 Windows 프로세스 정리 대기에서 5초 타임아웃을 냈다. `electron/ai/cliProcessTree.ts`, `electron/ai/cliExecutable.ts`, `electron/ai/cliProviderProcess.ts`, `electron/ai/cliEnvironment.ts`, `electron/ai/cliTestHelpers.ts`, `electron/ai/cliAdapters.lifecycle.test.ts`를 보강해 descendant process 종료 확인과 Windows root/env fallback을 안정화했다.

### 새 검증 결과

- `npm run typecheck`: PASS.
- `npx vitest run electron/ai/cliAdapters.lifecycle.test.ts`: PASS, 2/2.
- `npm test`: PASS, 33 files / 228 tests.
- `node --test scripts/verify-package-security.test.mjs scripts/verify-render-png.test.mjs`: PASS, 11/11.
- 단일 재현: `4:5`, scale `1.5`, Lite, `dark-no-photo` fixture가 `1080x1350`으로 PASS.
- Source render matrix: PASS, 56/56.
  - Evidence: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t04-matrix-nosandbox-20260714/matrix-summary.json`
  - 새 하네스: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/harness-nosandbox-20260714/render-dimension-smoke.js`
- `npm run build:lite`: PASS.
- `node scripts/verify-edition.mjs --edition lite --scan dist dist-electron`: PASS.
- `npm run build:pro`: PASS.

### 남은 배포 게이트

1. 이번 수정은 source/harness/build 검증까지만 완료했다. EXE/installer는 아직 새 candidate로 다시 패키징하지 않았다.
2. 새 패키징을 진행할 때는 기존 `final4/final4b` 이름을 재사용하지 말고 새 candidate ID를 만든다.
3. 새 candidate에 대해 Lite/Pro packaged matrix, package scanner, 독립 코드 리뷰, T14 clean install, T15 upgrade/data preservation, T16 Defender/Authenticode를 다시 닫아야 한다.
4. `release/`는 이번 단계에서 수정하지 않았다.

## 6-26W. M20 nosandbox 격리 패키지 검증 (2026-07-14 Codex)

이 append-only 항목은 6-26V의 실제 디버깅 수정 이후 새로 만든 격리 후보 `nosandbox-20260714-1635`의 패키징과 자동 검증 결과다. 공개 `release/` 폴더는 이번 단계에서도 수정하지 않았다.

### 새 후보

Lite:

- Installer: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\lite-nosandbox-20260714-1635\Cardnews-Studio-Lite-Setup-2.0.0.exe`
- Installer SHA-256: `54505524749dc9a259ed6dda624be6ee5cb1119557776078473a6c8b8a92c8e5`
- Unpacked EXE: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\lite-nosandbox-20260714-1635\win-unpacked\Cardnews Studio Lite.exe`
- EXE SHA-256: `84ad16a8af99e992a2dad40103292ccd6b62dea4992cc08c208898595bb7013b`
- `app.asar` SHA-256: `65e8cf54423edc8afa6817b5eb4600b4b92fa20e732340ea3ffd7a7437d9072e`

Pro:

- Installer: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\pro-nosandbox-20260714-1635\Cardnews-Studio-Pro-Setup-2.0.0.exe`
- Installer SHA-256: `c4cc2a6a554f48a55cfd31433765b0b4dda6e05c1ca9808274b5c915c3046f5e`
- Unpacked EXE: `C:\Users\js480\AppData\Local\CardnewsStudio\M20-QA\pro-nosandbox-20260714-1635\win-unpacked\Cardnews Studio Pro.exe`
- EXE SHA-256: `6f0eae12eab83e44f7b95b4a4d330fef06f162b889971fd292ab4150d5d304ac`
- `app.asar` SHA-256: `8c15ba37cd8395d0d428febf203b7ea6b0b8c47a8dcd3ef08596fbe248774239`

### 검증 결과

- Lite isolated packaging: PASS. `electron-builder --win nsis` with output override to `%LOCALAPPDATA%`.
- Pro isolated packaging: PASS. `prepare-pro-package.mjs` 후 `electron-builder --win nsis` with output override to `%LOCALAPPDATA%`.
- Lite packaged render matrix: PASS, 20/20, zero forced terminations.
  - Evidence: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t13-packaged-lite-nosandbox-20260714/matrix-summary.json`
- Pro packaged render matrix: PASS, 20/20, zero forced terminations.
  - Evidence: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t13-packaged-pro-nosandbox-20260714/matrix-summary.json`
- Package scanner: PASS, findings 0.
  - Evidence: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/t16-security-payload-nosandbox-20260714.json`
- Candidate manifest:
  - `.omc/evidence/v6/m20-dpi-safe-render-dimensions/candidate-manifest-nosandbox-20260714.json`

### 남은 결정/게이트

1. `--no-sandbox`는 현재 Windows QA 환경에서 offscreen paint helper가 `exit_code=-1073741515`로 죽는 문제를 피하기 위한 조치다. 앱은 여전히 local packaged content를 사용하고 `nodeIntegration:false`, `contextIsolation:true`를 유지하지만 Chromium process sandbox 비활성화는 릴리스 전 보안 리뷰 항목으로 남겨야 한다.
2. T14 clean Windows installer QA, T15 upgrade/data preservation QA, T16 Defender/Authenticode는 아직 닫히지 않았다.
3. T17 release staging과 `release/` 교체는 아직 실행하지 않았다.

## 6-26X. M20 배포 폴더 staged copy (2026-07-14 Codex)

사용자 요청에 따라 `nosandbox-20260714-1635` 후보를 공개 `release/distribution` 아래 배포 폴더 형태로 복사했다. 기존 `release/` 루트의 과거 installer/unpacked 파일은 덮어쓰지 않았다.

배포 루트:

- `release/distribution/Cardnews-Studio-M20-nosandbox-20260714-1635/`

폴더 구성:

- `Lite/01-설치 파일/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- `Lite/02-비설치 실행 폴더/win-unpacked/Cardnews Studio Lite.exe`
- `Pro/01-설치 파일/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- `Pro/02-비설치 실행 폴더/win-unpacked/Cardnews Studio Pro.exe`
- `SHA256SUMS.txt`
- `distribution-manifest.json`
- `배포_안내.txt`

검증 기준:

- 원본 후보: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/candidate-manifest-nosandbox-20260714.json`
- Lite packaged matrix: 20/20 PASS.
- Pro packaged matrix: 20/20 PASS.
- Package scanner: PASS, findings 0.

주의:

1. 설치형은 EXE 단일 전달 가능하다.
2. 비설치형은 `win-unpacked` 폴더 전체를 압축/전달해야 한다. EXE만 빼서 전달하면 실행되지 않는다.
3. Windows SmartScreen/알 수 없는 게시자 경고는 코드 서명 인증서가 없기 때문에 계속 발생할 수 있다.
4. 깨끗한 별도 PC/VM의 T14 clean install, T15 upgrade/data preservation, T16 Defender/Authenticode는 아직 별도 게이트로 남아 있다.

## 6-27. M21 Canva-like Editor + Template-bound Bulk v2 (2026-07-14 Codex)

### 완료 범위

- 제목 배치를 기존 콘텐츠 묶음 `offsetY`와 분리했다. `titlePlacement` 계약은 `flow` 또는 `card-y` + 0..100 Y이다.
- 푸터 X/Y 이동과 임의 `#RRGGBB` 포인트 색 입력을 공통 편집 UI에 열었다.
- 인라인 텍스트 편집 중 iframe 원문을 숨겨 중복 표시를 없얈고, 투명 배경과 한글 IME composition을 유지했다.
- 레이어 전체 `opacity`와 글자 전용 `textOpacity` 0..100을 분리했다.
- 페이지 삽입/복제/삭제를 `src/domain/pageOperations.ts`로 원자화하고, overrides/backgrounds/images/bulk binding key를 함께 remap한다.
- 썸네일 우클릭/키보드 메뉴에 포커스 복귀, viewport clamp, 마지막 페이지 삭제 금지, 내용 페이지 삭제 확인을 적용했다.
- 선택 레이어에 `Ctrl/Cmd+C`, `X`, `V`를 추가했다. 텍스트 입력 선택을 우선하고 paste ID 재발급, offset, card bounds clamp를 적용했다.
- Pro에 `kkongdon.cardnews.bulk.v2` 템플릿 바인딩, 편집 가능한 CSV key/label, preflight, formula injection 방어, 자원 한도를 추가했다.
- Lite에서 수동 편집기는 동일하게 유지하고, Bulk v2 실행 IPC/UI는 strip/잠금 상태로 유지했다.

### 핵심 파일

- `src/domain/types.ts`
- `src/domain/pageOperations.ts`
- `src/domain/templateBulkBindings.ts`
- `src/ui/layerClipboard.ts`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `src/render-engine/cardTemplate.ts`
- `src/storage/deckStore.ts`
- `electron/main.ts`, `electron/preload.cts`
- `src/edition/lite/index.tsx`, `src/edition/pro/index.tsx`

### 검증 결과

- `npm run typecheck`: PASS.
- `npm test`: 37 files, 259 tests PASS.
- `npm run build:lite`: PASS.
- `node scripts/verify-edition.mjs --edition lite --scan dist dist-electron`: PASS.
- `npm run build:pro`: PASS.
- production render matrix: Lite/Pro, 4 ratios, 5 scales 포함 transport 136/136 PASS.
- M21 output-coordinate geometry: 320/320 PASS, 최대 오차 0.01px. 제목 y=0/50/100, 푸터 +/-X/Y, 임의 accent, text opacity 0/50/100, 투명/채움 custom text를 실제 production renderer `slots.json`/생성 HTML로 검증했다.
- 별도 승인 진단 `gate-report.json` 132개는 contrast/font-variety `fail`을 유지한다. PNG/좌표 실패는 아니며 M21 T15 판정에서는 분리했지만, 후속 품질 게이트 개선 항목으로 숨기지 않고 남겼다.
- Lite/Pro 개발 렌더러 스크린샷 모두 정상 표시. 클릭 시나리오 자동화 대신 UI/domain 계약 테스트로 상호작을 고정했다.

Evidence:

- `.omc/evidence/v6/m21-canva-editor-bulk-bindings/`
- `t17-evidence-audit.log`: PASS.
- 각 T1-T17에 matching `.meta.json` 존재.

### 주의/다음 작업

1. M21 PRD 지시에 따라 EXE/설치 파일/비설치 패키지는 생성하지 않았다.
2. 새 배포를 만들 때는 M21 소스 게이트 통과 후 별도 release PRD의 패키징/깨끗한 PC 게이트를 다시 실행한다.
3. T16 스크린샷은 visual smoke 증거이며, 사람이 모든 pointer gesture를 재연했다는 증거는 아니다. 상호작은 `m21UiContract`, `pageOperations`, `layerClipboard` 테스트가 담당한다.

## 6-28. M21 Lite/Pro 재빌드 및 배포 폴더 적재 (2026-07-15 Codex)

사용자 요청에 따라 6-27의 M21 소스로 Lite/Pro 설치형과 비설치형을 다시 빌드했다. 기존 M20 배포 폴더는 덮어쓰지 않았다.

배포 루트:

- `release/distribution/Cardnews-Studio-M21-20260715-171552/`

주요 산출물:

- `Lite/01-설치 파일/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- `Lite/02-비설치 실행 폴더/win-unpacked/Cardnews Studio Lite.exe`
- `Pro/01-설치 파일/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- `Pro/02-비설치 실행 폴더/win-unpacked/Cardnews Studio Pro.exe`
- `SHA256SUMS.txt`
- `distribution-manifest.json`
- `배포_안내.txt`

검증 결과:

- `npm run typecheck`: PASS.
- `npm test`: 37 files, 259 tests PASS.
- `npm run build:lite`: PASS.
- Lite `electron-builder --win nsis`: PASS.
- `verify-edition.mjs --edition lite` on packaged `app.asar` and `win-unpacked`: PASS.
- `npm run build:pro`: PASS.
- `prepare-pro-package.mjs`: PASS.
- Pro `electron-builder --win nsis`: PASS.
- `verify-package-security.mjs`: PASS, findings 0.
- Lite/Pro 무설치 EXE를 각각 완전 격리 프로필로 실행해 `workspace-ready=true`, `edition=lite|pro`를 확인했다.
- 격리 빌드 원본과 staged copy의 설치 EXE/무설치 EXE SHA-256이 모두 일치한다.

Evidence:

- `.omc/evidence/v6/m21-release-20260715-171552/`

검증 제한/주의:

1. `run-packaged-render-matrix.mjs`는 배포본 창과 DOM이 정상 로드된 뒤에도 CDP `Runtime.evaluate` 대기 시간 초과가 재현됐다. 이번 릴리스에서는 이 하네스의 20/20 통과를 주장하지 않으며, 직접 격리 실행 스모크와 M21 production render/geometry 증거를 사용했다.
2. 네 실행 파일은 모두 Authenticode `NotSigned`다. SmartScreen의 알 수 없는 게시자 경고가 표시될 수 있다.
3. 깨끗한 별도 Windows PC/VM에서 설치, 업그레이드, 제거, Defender 검사는 별도 게이트로 남아 있다.

## 6-29. M22 미디어/영상/작업 보드/AI 지침 구현 및 최종 배포 (2026-07-17 Codex)

사용자 요청에 따라 `.omx/plans/prd-v6-m22-media-video-canvas-ai.md`와 대응 테스트 명세의 구현 상태를 다시 감사하고, 발견된 회귀를 수정한 뒤 Lite/Pro 설치형과 무설치형을 새 배포 폴더로 적재했다. 기존 M21 및 이전 배포 폴더는 덮어쓰지 않았다.

### 완료 범위

- 카드별 미디어와 전역 기본 미디어를 같은 카탈로그로 관리하고 `전역 따름/카드 지정/없음` 상속을 지원한다.
- 이미지와 영상을 카드 배경 또는 자유 레이어로 배치할 수 있다.
- 카드별 장면 시간, 영상 구간, 음량, 기본 전환과 카드당 주 오디오 하나를 지원한다.
- 모든 카드를 이어 붙인 세로형 `1080x1920` MP4를 FFmpeg/FFprobe 번들로 출력한다.
- 제목, 소제목, 본문, 배지, 푸터를 중앙 작업 보드에서 직접 선택·편집·이동한다.
- 푸터 X/Y 전 범위 배치와 본문 번호의 전역 기본값 + 카드별 따름/표시/숨김을 지원한다.
- Pro AI의 고정 꽁돈 지침을 편집 가능한 기본 지침으로 바꾸고 provider 요청에 반영한다.
- Lite에는 공용 미디어/MP4 편집 기능을 유지하되 AI/Pro 전용 코드와 IPC를 스트리핑한다.
- 프로젝트 archive v2에 미디어/영상/장면/AI 설정을 저장하고 v1 프로젝트를 호환 복원한다.

### 이번 최종 감사에서 수정한 회귀

- `scripts/smoke-video-export.mjs`: 구형 오디오 계약 대신 `audioSegments`를 사용하도록 바꾸고, 실제 1초 MP4에 video+audio 스트림이 모두 있는지 검증한다.
- `scripts/verify-packaged-render.mjs`: 자동 스모크에서 페이지 삭제 확인창을 수락하고 PNG 생성 상태를 정확히 보고한다.
- `src/render-engine/gates/qualityGates.ts`: Chromium의 `color(srgb r g b)` 색상 형식을 해석하고, 개별 문단/불릿이 존재할 때 aggregate body metric을 중복 판정하지 않는다.
- `src/render-engine/gates/qualityGates.test.ts`: 위 두 품질 게이트 회귀 테스트를 추가했다.

### 최종 배포 루트

- `release/distribution/Cardnews-Studio-M22-20260717-021727/`

Lite:

- 설치 파일: `Lite/01-설치 파일/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- 무설치 실행: `Lite/02-무설치 실행 폴더/win-unpacked/Cardnews Studio Lite.exe`
- 사용설명서: `Lite/03-사용설명서/Cardnews-Studio-Lite-사용설명서.html`

Pro:

- 설치 파일: `Pro/01-설치 파일/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- 무설치 실행: `Pro/02-무설치 실행 폴더/win-unpacked/Cardnews Studio Pro.exe`
- 사용설명서: `Pro/03-사용설명서/Cardnews-Studio-Pro-사용설명서.html`

공통:

- `배포_안내.txt`
- `SHA256SUMS.txt`
- `distribution-manifest.json`
- `THIRD_PARTY_NOTICES.md`

### 주요 SHA-256

- Lite installer: `f48b771eed2ba7624ed4afc8b785d6c331451d59c0360423ba8afd4948f78d87`
- Lite portable EXE: `9f268b3793b777a80133fe5a9b4573f40674da23cf0ef979a762179e6fb7d8f0`
- Lite app.asar: `5235618a9b147746b6b6c24c9224c01bb32d88779a11f5e8eea97ecbfdb611a3`
- Pro installer: `a93108223da5b52862953d66c37ed05beee01a21efb724b1865b999f8c4902bf`
- Pro portable EXE: `73730c7e574023cbfda411ead9fe7ed73610735f403f9fa47b3dfe99b070d73e`
- Pro app.asar: `07e58014fb8d5bbddddd16477e8ac848a4b32922f513731e7e2c3373acc19054`

### 검증 결과

- `npm run typecheck`: PASS.
- `npm test`: 47 files, 331 tests PASS.
- `npm run build:lite`: PASS.
- `npm run build:pro`: PASS.
- packaged Lite `verify-edition.mjs`: PASS. staged copy에서도 재검증 PASS.
- package security scan: PASS, findings 0.
- Lite 무설치 EXE 실제 실행 + `1080x1350` PNG 생성: PASS.
- Pro 무설치 EXE 실제 실행 + `1080x1350` PNG 생성: PASS.
- 실제 MP4 smoke: PASS. 1초, video+audio stream, 진행률 0→100.
- M22 evidence audit: PASS, 56/56.
- 격리 빌드 원본과 최종 배포 폴더 168개 파일 SHA-256 대조: 불일치 0건.

Evidence:

- `.omc/evidence/v6/m22-media-video-canvas-ai/final-release/`
- 최종 MP4: `.omc/evidence/v6/m22-media-video-canvas-ai/t11-final-audio-20260717-010956/out/m22-smoke.mp4`
- 최종 요약: `.omc/evidence/v6/m22-media-video-canvas-ai/final-release/release-summary.meta.json`

### 배포 제한과 다음 외부 게이트

1. 네 EXE 모두 Authenticode `NotSigned`다. 파일 무결성은 SHA-256으로 검증했지만 게시자 신원과 SmartScreen 평판을 제공하려면 상용 코드서명 인증서가 필요하다.
2. 깨끗한 별도 Windows PC/VM에서 설치형 설치·업그레이드·제거·Defender 검사는 이번 단일 PC 세션에서 수행하지 않았다.
3. 무설치형은 EXE만 분리하지 말고 `win-unpacked` 폴더 전체를 전달해야 한다.
4. Pro AI는 대상 PC에 외부 CLI가 설치되고 로그인되어 있어야 한다.

## 6-30. M23 캔버스/영상 타임라인 강화 구현 및 격리 RC 검증 (2026-07-17 Codex)

`.omx/plans/prd-v6-m23-canvas-video-timeline-hardening.md`와 대응 테스트 명세를 기준으로 M23을 구현하고 G0-G11 순차 게이트를 실행했다. 기존 M22 배포 폴더는 변경하지 않았다.

### 구현 범위

- 제목, 소제목, 문단, 불릿, 배지, 푸터 등 의미 단위별 stable ID와 legacy migration을 추가했다.
- 각 의미 단위를 독립 선택하고 8방향 크기 조절, 드래그 이동, 키보드 미세 이동, 인라인 편집, undo/redo할 수 있게 했다.
- 선택 카드의 배경 영상과 자유 영상 레이어를 실제 `<video>`로 재생하고, 비선택 카드는 poster 기반으로 유지한다.
- 영상 업로드는 MP4 최대 300 MiB 정책과 ffprobe 사전 검증을 사용하며 전체 파일을 메모리에 올리지 않는다.
- 미리보기와 MP4 출력이 공유하는 `CompiledVideoTimeline`을 추가하고, 장면 시간·클립 구간·전환 구간·프레임 소유권을 한 계약으로 통일했다.
- fade, slide-left, slide-up 전환은 outgoing/incoming 장면을 별도 렌더 세션에서 캡처해 결정적으로 합성한다.
- FFmpeg `h264_mf` 1080x1920 품질 프로필을 적용하고 2초 실제 시험 영상에서 H.264/yuv420p/30fps/약 11.18Mbps를 확인했다.
- 하단 타임라인에서 카드별 시간, 클립 구간, 전환과 전체 playhead를 편집하고 선택 카드와 동기화한다.

### 반복 “앱 선택 / python3” 팝업 조치

- Cardnews Studio 코드의 문제가 아니라 전역 Codex `hookify@claude-plugins-official` 플러그인이 모든 도구 호출마다 Windows에 없는 `python3` 명령을 실행한 것이 원인이었다.
- `C:\Users\js480\.codex\config.toml`에서 해당 플러그인을 비활성화했다.
- 누적된 `OpenWith.exe` 프로세스 101개를 관리자 권한으로 종료했고 이후 도구 호출에서도 0개를 확인했다.

### 검증 결과

- G0-G6: schema, 캔버스, preview/import, timeline, frame ownership/transition, 실제 H.264 품질 PASS.
- `npm run typecheck`: PASS.
- `npm test`: 48 files, 347 tests PASS.
- Lite build + `verify-edition.mjs --edition lite`: PASS.
- Pro build: PASS.
- 격리 패키지 보안 검사: PASS, findings 0.
- Lite/Pro 무설치 EXE: 빈 프로필 실행 및 실제 1080x1350 PNG 렌더 PASS.
- Lite/Pro 설치 EXE: 새 경로 silent install, 설치본 실행, silent uninstall 및 실행 파일 제거 PASS.
- G0-G9: PASS.
- G10 clean Windows VM: BLOCKED. 이 세션에는 Node/npm/소스가 없는 별도 Windows VM이 없었으며 통과 증거를 조작하지 않았다.
- G11 public staging: BLOCKED. G10이 pass가 아니므로 스테이징 스크립트가 의도대로 거부했다.

### 검증된 M23 격리 RC

루트:

- `.omc/build/m23-release-20260717-154944/`

Lite:

- 설치 파일: `Lite/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- 무설치 실행: `Lite/win-unpacked/Cardnews Studio Lite.exe`
- installer SHA-256: `f84095c63f72b7cd0274ee335c8224ce288e6db64ea2c4eb740bc2417590440b`
- portable EXE SHA-256: `a3d0d93708181cde2d428c06cd664d3bdcedcb875c2a32bfada9a5bdbab46073`

Pro:

- 설치 파일: `Pro/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- 무설치 실행: `Pro/win-unpacked/Cardnews Studio Pro.exe`
- installer SHA-256: `5d3b595747b8ee164e1911fba6abfae5da4e2512da79119e9307ff7c01057f29`
- portable EXE SHA-256: `d9bba173f0dab1e8391daee3f88b3fd7476400a22b6be1c170fbbe5626abe373`

Evidence:

- `.omc/evidence/v6/m23-canvas-video-timeline-hardening/`
- package state: `.omc/evidence/v6/m23-canvas-video-timeline-hardening/package-state.json`

### 다음 필수 작업

1. 깨끗한 Windows VM 스냅샷에서 Lite/Pro 설치형을 각각 설치한다.
2. 영상 preview, 텍스트 이동/크기 조절, PNG와 MP4 출력, 제거, 잔존 파일/프로세스를 확인한다.
3. G10 meta를 pass 증거로 교체한 뒤 `node scripts/package-m23-release.mjs --phase stage --require-vm-evidence`를 실행한다.
4. G11이 pass일 때만 M23 공개 배포 폴더를 생성한다.

## 6-31. M24 내보내기·미디어·편집 UX 강화 및 격리 패키지 검증 (2026-07-17 Codex)

`.omx/plans/prd-v6-m24-export-media-editor-ux-hardening.md`와 대응 테스트 명세를 기준으로 M24-0부터 M24-9까지 구현하고 G0-G13 게이트를 실행했다. 기존 `release/` 공개 배포물은 변경하지 않았다.

### 구현 범위

- 카드별 노출 시간을 500ms~180000ms 범위에서 편집하고 프로젝트 저장·복원·MP4 타임라인에 동일하게 반영한다.
- 사진 릴스/영상 프로젝트 모드를 명시적으로 저장하며, 영상 모드 또는 영상 미디어가 있을 때만 하단 타임라인을 표시한다.
- 제목, 소제목, 본문, 배지, 푸터 등 의미 단위 선택 상자와 실제 렌더 좌표를 같은 절대 좌표 계약으로 통일했다.
- 4px 드래그 임계값, 첫 프레임 점프 방지, 한 번의 드래그당 한 번의 undo 기록을 적용했다.
- 이미지·영상 가져오기와 현재 카드 배정을 분리하고 `보관함에만 추가`, 현재 카드 적용, 전역 적용 흐름을 제공한다.
- 선택 카드의 영상만 보안 `cardnews-media://asset/<id>` 프로토콜로 실제 스트리밍한다. 관리 ID만 허용하고 HTTP Range/HEAD/GET을 지원한다.
- 상단 내보내기를 하나로 통합하고 현재 카드 PNG, 전체 ZIP, MP4, 설정 탭을 한 모달에서 제공한다.
- MP4 단계는 compile, preflight, producer_init, render, encode, finalize로 표시하고 경과 시간, heartbeat, 단계별 timeout, 오류 코드, 상세 보기, 재시도를 제공한다.
- Pro AI CLI 미설치 시 고정 allowlist 레시피와 공식 문서 링크를 보여준다. 렌더러 임의 명령은 실행하지 않으며 확인 후 보이는 터미널에서만 설치한다.
- Lite에는 Pro CLI 설치 IPC와 구현이 포함되지 않도록 스트리핑 검증을 유지했다.
- 내보내기 모달에 Escape 닫기, Tab 포커스 순환, 닫힌 뒤 원래 포커스 복원을 적용했다.

### 검증 결과

- `npm run typecheck`: PASS.
- `npm test -- --reporter=dot`: 51 files, 367 tests PASS.
- `git diff --check`: whitespace error 없음. 기존 CRLF 변환 경고만 존재.
- G0-G10: PASS.
- G10 Pro trusted FFmpeg 실제 MP4 통합 스모크: PASS.
- G11 격리 Lite/Pro 패키징과 패키지 보안 검사: PASS.
- G12 Lite/Pro 무설치 실행, 실제 1080x1350 PNG 생성, 설치형 silent install, 설치본 PNG 생성, 새 프로필 실행, silent uninstall, 잔여 파일 없음: PASS.
- G13 clean Windows VM 및 공개 staging: BLOCKED. 깨끗한 별도 Windows VM 증거가 없으므로 `release/` 쓰기를 fail-closed로 거부했다.
- 테스트 종료 뒤 `.omc/build/m24`에서 실행된 Cardnews 프로세스가 남지 않았음을 확인했다.

### 검증된 M24 격리 산출물

루트:

- `.omc/build/m24/m24-release-2026-07-17-13-03-37/`

Lite:

- 설치 파일: `Lite/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- 무설치 실행: `Lite/win-unpacked/Cardnews Studio Lite.exe`
- installer SHA-256: `0738b0c713e4d035a9a0863a67e5089e2cbcbeccad7383801db7c848ee30aa71`
- portable EXE SHA-256: `4efbd6e1c7d50b7a3ef2779399e240790b93a8916b2db088c4b124e6058b9f90`

Pro:

- 설치 파일: `Pro/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- 무설치 실행: `Pro/win-unpacked/Cardnews Studio Pro.exe`
- installer SHA-256: `b5bfa508bfcdd63684ce8fc3a9fda5bba136a31e25a61f1c337b3a475120647d`
- portable EXE SHA-256: `b0f4ce10e3591e414b0a5fe5db9605183ba642fdcf992085737d0c3676feb043`

Evidence:

- `.omc/evidence/v6/m24-export-media-editor-ux-hardening/`
- package state: `.omc/evidence/v6/m24-export-media-editor-ux-hardening/package-state.json`
- G12 final meta: `.omc/evidence/v6/m24-export-media-editor-ux-hardening/G12-portable-installed-smoke/G12-portable-installed-smoke.meta.json`
- G13 blocked meta: `.omc/evidence/v6/m24-export-media-editor-ux-hardening/G13-clean-vm-stage-handoff/G13-clean-vm-stage-handoff.meta.json`

### 패키징 하네스에서 함께 수정한 문제

- Windows Node 24에서 `npm`/`npm.cmd` 직접 spawn이 `EINVAL` 또는 `ENOENT`로 실패하던 문제를 고정 `ComSpec /d /s /c npm run build:<edition>` 호출로 교정했다.
- Pro 패키지가 QA 마커를 `data-cardnews-*`로 치환하는 계약에 맞춰 패키지 PNG 검증기가 Lite/Pro별 선택자를 사용하도록 수정했다.
- Electron 자식 프로세스 종료와 NSIS 제거 완료가 늦는 경우를 실행 파일 절대 경로 기반 종료 재시도 및 EXE/app.asar 동시 제거 대기로 보강했다.

### 다음 필수 작업

1. 깨끗한 Windows VM에 격리 산출물의 Lite/Pro 설치 파일을 복사한다.
2. 설치, 실행, 영상 미리보기, 카드별 시간, PNG/MP4 내보내기, 제거, Defender 검사를 수행하고 결과 JSON을 남긴다.
3. `node scripts/record-m24-vm-gate.mjs --evidence <clean-vm-result.json>`으로 G13 VM 증거를 기록한다.
4. VM meta가 pass인 경우에만 `node scripts/package-m24-release.mjs --phase stage --require-vm-evidence`를 실행한다.
5. stage가 pass일 때 생성되는 새 `release/M24-*` 폴더만 공개 배포 후보로 사용한다.

## 6-32. 편집 DOMRect 좌표계 구조 수정 (2026-07-17 Codex)

첨부 화면에서 실제 텍스트·도형과 파란 선택 상자가 어긋나는 문제를 요소별 보정값 없이 좌표 변환 구조에서 수정했다. 기존 저장 데이터 형식과 편집 기능은 유지했으며, 이번 작업에서 EXE 패키징이나 `release/` 공개 배포물 변경은 수행하지 않았다.

### 확인된 원인

- 의미 요소는 `.content`, `.header`, `.footer`에서 실제 렌더링되는데 오버레이는 추정 기본 배치 사각형을 우선 사용해 서로 다른 좌표를 기준으로 삼고 있었다.
- 일부 DOMRect 측정에서 카드의 `left/top` 원점을 제거하지 않은 채 카드 크기로만 정규화했다.
- 저장된 카드 좌표를 실제 요소에 적용할 때 요소별 `offsetParent` 차이를 반영하지 않았다.
- 오버레이의 화면 픽셀 `min-height: 18px`가 확대·축소 상태에서 실제 렌더 높이와 다른 선택 상자를 만들었다.
- 기존 테스트는 실제 렌더 DOMRect와 오버레이 DOMRect의 일치를 측정하지 않았다.

### 수정 방식

- `src/ui/editorGeometry.ts`에 카드 DOMRect 기준 좌표·포인터 변환을 단일화했다.
- `src/render-engine/semanticPlacement.ts`에 카드 좌표를 실제 `offsetParent` 로컬 CSS 픽셀로 변환하는 공유 계약을 만들었다.
- 카드 원점, 부모 border와 scroll, 부모 CSS scale을 한 번만 반영하고 `devicePixelRatio`는 좌표 계산에서 제외했다.
- 부모 편집 앱과 독립 렌더 HTML이 같은 배치 함수를 사용한다.
- 폰트·이미지·영상 준비 후 실제 요소 DOMRect를 측정하며, 드래그·리사이즈 중 실제 요소와 오버레이에 동일한 임시 변환을 적용한다.
- 의미 요소의 가짜 기본 카드 사각형과 편집 오버레이의 화면 픽셀 최소 높이를 제거했다.
- 텍스트, 도형, 선, 이미지, 영상 자유 레이어에 안정적인 `data-editor-layer-id`를 부여했다.
- 요소별 하드코딩 보정값은 추가하지 않았고 저장 좌표의 기존 백분율 형식도 유지했다.

### 검증 결과

- `npm run typecheck`: PASS.
- `npm test`: 53 files, 381 tests PASS.
- 좌표계 집중 테스트: 5 files, 60 tests PASS.
- M24 geometry, UX, regression, Lite source build, Pro source build 게이트: 모두 PASS.
- Playwright DOMRect 실측:
  - 기본 scale 0.534: 최대 오차 0.047px 미만.
  - 축소 scale 0.291102: 최대 오차 0.032px 미만.
  - 확대 scale 1.126664: 최대 오차 0.082px 미만.
  - 제목 드래그·리사이즈 중과 완료 후: 최대 오차 0.038px 미만.
  - 이미지 추가·드래그·리사이즈: 최대 오차 0.015px 미만.
  - 중앙 정렬 가이드: 최대 오차 0.008px 미만.
- `git diff --check`: whitespace error 없음.

### 증거

- `.omc/evidence/v6/editor-coordinate-space-domrect/verification.md`
- `.omc/evidence/v6/editor-coordinate-space-domrect/editor-coordinate-alignment.png`

### 다음 작업

좌표 수정본을 공개 배포하려면 기존 M24 절차대로 clean Windows VM G13 증거를 먼저 통과한 뒤 새 Lite/Pro EXE를 패키징·staging한다.

## 6-33. 좌표계 수정본 Lite/Pro EXE 재패키징 (2026-07-18 Codex)

6-32의 DOMRect 좌표계 구조 수정이 포함된 현재 소스로 Lite/Pro 설치형과 무설치 폴더를 새 격리 실행 경로에 다시 생성했다. 기존 `release/` 공개 배포물은 변경하지 않았다.

### 패키징 실행

- 실행 ID: `m24-release-2026-07-17-17-06-21`
- 격리 루트: `.omc/build/m24/m24-release-2026-07-17-17-06-21/`
- G11 isolated package: PASS.
- 패키지 보안 검사: PASS, findings 0건.
- G12 portable smoke: Lite/Pro 실행과 1080x1350 PNG 생성 PASS.
- G12 installed smoke: Lite/Pro silent install, 설치본 PNG 생성, 새 프로필 실행, silent uninstall, 잔여 파일 없음 PASS.
- 테스트 종료 후 Cardnews 잔존 프로세스: 0개.

첫 G11 시도는 샌드박스 네트워크가 Electron 런타임 다운로드를 `EACCES 20.200.245.247:443`로 차단해 실패했다. 네트워크 허용 상태에서 동일 하네스를 재실행했으며 코드 변경 없이 최종 G11/G12가 PASS했다.

### Lite 산출물

- 설치 파일: `.omc/build/m24/m24-release-2026-07-17-17-06-21/Lite/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- 무설치 실행 파일: `.omc/build/m24/m24-release-2026-07-17-17-06-21/Lite/win-unpacked/Cardnews Studio Lite.exe`
- 설치 파일 SHA-256: `64b2284d93b85a92790d03ebabfeef6d9aaf8ac8aeec5545283681efbb336d93`
- 무설치 EXE SHA-256: `569667732ba08032fcbae0216cc18d3b60db0159f401c9eb657941afd7c49335`

### Pro 산출물

- 설치 파일: `.omc/build/m24/m24-release-2026-07-17-17-06-21/Pro/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- 무설치 실행 파일: `.omc/build/m24/m24-release-2026-07-17-17-06-21/Pro/win-unpacked/Cardnews Studio Pro.exe`
- 설치 파일 SHA-256: `73c803071aec6487930f6c2b9d45a2c317f7d9dc483926fcc0786263982bba0b`
- 무설치 EXE SHA-256: `3271b511193f645e46c096d13228ed94b464246cef805ae61192d1f2635e0253`

### 증거

- 패키지 보안: `.omc/build/m24/m24-release-2026-07-17-17-06-21/package-security.json`
- G11: `.omc/evidence/v6/m24-export-media-editor-ux-hardening/G11-isolated-package/G11-isolated-package.meta.json`
- G12: `.omc/evidence/v6/m24-export-media-editor-ux-hardening/G12-portable-installed-smoke/G12-portable-installed-smoke.meta.json`
- Lite 무설치 렌더: `.omc/build/m24/m24-release-2026-07-17-17-06-21/lite-portable-render.png`
- Lite 설치본 렌더: `.omc/build/m24/m24-release-2026-07-17-17-06-21/lite-installed-render.png`
- Pro 무설치 렌더: `.omc/build/m24/m24-release-2026-07-17-17-06-21/pro-portable-render.png`
- Pro 설치본 렌더: `.omc/build/m24/m24-release-2026-07-17-17-06-21/pro-installed-render.png`

### 공개 배포 주의

이번 결과는 현재 PC의 격리 설치·무설치 검증까지 통과한 패키지다. Clean Windows VM G13 증거는 별도이므로 `release/` 공개 staging은 수행하지 않았다.

## 6-34. 편집·썸네일 렌더 일치 및 본문 번호 영속성 수정 (2026-07-18 Codex)

편집 화면과 왼쪽 썸네일의 의미 요소 위치가 달라지는 문제, 본문 번호가 수정 후 `01`로 돌아가거나 삭제되지 않는 문제를 병렬 조사한 뒤 공통 렌더 준비 계약과 명시적 본문 번호 상태로 수정했다. 기존 dirty worktree와 `release/` 공개 배포물은 변경하지 않았으며 EXE 패키징도 수행하지 않았다.

### 확정 원인

- 본문 번호는 `src/render-engine/cardTemplate.ts`의 `computeBodyNumber()`와 `renderCardBody()`에서 자동 생성됐지만, 선택 UI는 `src/ui/App.tsx`의 `buildSemanticSlotDrafts()`가 만든 임시 값을 편집했다.
- `updateSemanticSlotText()`와 `CardOverride`에 본문 번호 전용 값이 없어 텍스트 변경·삭제 상태가 실제 페이지 override와 저장 데이터에 남지 않았다.
- 의미 요소 Delete/Backspace가 선택 이벤트 처리에서 차단되어 있었고, 렌더 시 자동 번호가 다시 만들어졌다.
- 중앙 Stage와 썸네일은 모두 `buildCardHtml()`을 사용하지만 `semanticItemPlacements`의 런타임 동기화 시점이 달랐다.
- 썸네일 sandbox에서 iframe 스크립트가 실행되지 않았고, Stage의 첫 DOMRect 측정은 폰트·이미지 준비를 기다리느라 지연될 수 있었다.
- 이미지가 초기 `complete` 확인과 이벤트 리스너 등록 사이에 완료되면 readiness Promise가 끝나지 않는 경쟁 상태가 있었다.

### 수정 구조

- `src/domain/bodyNumber.ts`: 자동, 사용자 지정, 삭제 상태를 `inherit/show/hide`와 `bodyNumberText`로 해석하고 변경·삭제·자동 복구를 불변 업데이트로 제공한다.
- `src/domain/types.ts`, `src/storage/deckStore.ts`: `bodyNumberText`, `bodyNumberStyle`을 저장·검증·복원하며 빈 문자열과 삭제 상태도 보존한다.
- `src/ui/m22MediaUi.ts`, `src/ui/App.tsx`: 본문 번호 편집, Delete, Backspace, 툴바 삭제, 복제, 자동 번호 복귀, Undo/Redo를 동일한 override 경로로 처리한다.
- `src/domain/pageOperations.ts`: 페이지 복제 시 override와 의미 배치 맵을 깊은 복사하고 `card-N:` 의미 ID를 새 카드 번호로 다시 매핑한다.
- `src/render-engine/semanticPlacement.ts`: Stage와 썸네일이 같은 준비·동기화 함수를 사용한다. 즉시 한 번 배치한 뒤 폰트·이미지·프레임 준비 후 다시 확정한다.
- `src/ui/App.tsx`: 첫 실제 DOMRect를 즉시 커밋하고 자산 준비 후 같은 문서인지 확인해 재측정한다.
- `src/render-engine/cardTemplate.ts`, `electron/videoFrameProducer.ts`: 저장된 본문 번호 값·스타일·삭제 상태를 PNG와 영상 프레임에 그대로 사용한다.
- `src/domain/aspectRatios.ts`: 완료 기준에 있었지만 누락됐던 세로형 `9:16`을 1080x1920으로 추가했다.

### 검증 결과

- 수정 전 RED: 13개 실패 재현.
- 이미지 readiness 경쟁 상태: 수정 전 timeout 재현, 수정 후 5/5 PASS.
- 관련 회귀: 3 files, 80 tests PASS.
- 전체 회귀: 53 files, 403 tests PASS.
- `npm run typecheck`: PASS.
- Lite build 및 `verify-edition --edition lite --scan dist dist-electron`: PASS.
- Pro build 및 Pro edition 확인: PASS.
- 실제 Electron UI 라운드트립: 사용자 값 `A`, Delete, Backspace, 툴바 삭제, Undo, Redo, 페이지 전환, 저장, 다시 열기, 프로젝트 archive, PNG 삭제 상태 모두 PASS.
- 중앙 Stage 대 썸네일: 사용자 값 상태와 삭제 상태 모두 누락 0, 스타일 불일치 0, 최대 정규화 좌표 오차 0.
- 실제 PNG: 삭제된 본문 번호 미포함, 218,869 bytes.
- 실제 FFmpeg MP4 인코딩: 영상+오디오 스트림, 1초, 27,372 bytes PASS.
- 영상 프레임 본문 번호 사용자 값·삭제 상태: `electron/videoFrameProducer.test.ts` PASS.
- 실제 비율별 Electron PNG: 1:1 1080x1080, 4:5 1080x1350, 9:16 1080x1920 모두 PASS.
- `git diff --check` 관련 파일: whitespace error 없음. 기존 LF/CRLF 변환 경고만 존재.
- lint: `package.json`에 lint 명령이 없어 NOT TESTED.

### 증거

- 전체 증거 루트: `.omc/evidence/v6/render-sync-body-number/`
- RED: `01-red-tests.log`, `27-red-image-race.log`
- GREEN: `28-green-image-race.log`, `36-targeted-aspect-body-number.log`, `38-full-tests-final.log`
- 빌드: `41-build-lite-final.log`, `42-verify-edition-lite-final.log`, `43-build-pro-final-after-lite.log`, `44-verify-edition-pro-final.log`
- 실제 Electron UI: `45-electron-prod-smoke-final.log`, `45-electron-prod-after.png`, `45-electron-prod-after.txt`
- 저장·PNG: `45-body-number-roundtrip.cardnews`, `45-card-02-deleted.html`, `45-card-02-deleted.png`
- 실제 MP4: `40-video-mp4-smoke-final.log`, `video-smoke/body-number-final/out/m22-smoke.mp4`
- 비율별 PNG: `47-ratio-1x1.meta.json`, `47-ratio-4x5.meta.json`, `47-ratio-9x16.meta.json`

### 남은 한계

- 실제 MP4 인코더 통합 스모크와 본문 번호 영상 프레임 테스트는 각각 통과했지만, 사람이 MP4 프레임을 추출해 본문 번호 픽셀을 눈으로 비교하는 단계는 수행하지 않았다.
- 한글 본문 번호는 renderer·저장 단위 테스트로 검증했고 실제 Electron 스모크의 입력값은 `A`였다.
- 기존 dirty worktree가 매우 크므로 이 작업과 무관한 변경은 정리하거나 되돌리지 않았다.

## 6-35. 한글 IME 본문 번호 입력 및 최종 게이트 보강 (2026-07-18 Codex)

6-34 이후 실제 한글 입력을 Electron UI 라운드트립에 추가했다. 편집 중 문자열은 inline textarea 상태에 있고 blur 시 카드 override로 커밋되는 기존 계약을 그대로 검증했으며, 합성 DOM 이벤트 대신 Chromium DevTools Protocol의 `Input.insertText`로 포커스된 편집기에 한글을 입력했다.

### 추가 수정

- `src/ui/App.tsx`: 일반 텍스트와 의미 텍스트 편집기가 native `input`과 `compositionend`의 최종 값을 모두 상태에 반영하도록 보강했다.
- `electron/main.ts`: 본문 번호 스모크가 `첫 번째` 입력, blur 커밋, 중앙 Stage·썸네일 일치, workspace 저장을 검증한 뒤 편집기를 다시 열어 `A` 입력을 검증한다.
- 스모크의 카드 선택 판정은 재렌더 전 DOM 노드 객체 비교가 아니라 현재 활성 카드 인덱스를 기준으로 확인한다.
- `src/ui/m22MediaUi.test.ts`: 두 편집기의 IME 최종 값 반영 계약을 고정했다.

### 최종 검증

- 표적 테스트: 2 files, 57 tests PASS.
- 전체 회귀: 53 files, 404 tests PASS.
- `npm run typecheck`: PASS.
- 실제 Electron UI:
  - `첫 번째` 입력·커밋·저장 PASS.
  - `A` 재편집·커밋·저장 PASS.
  - 중앙 Stage 대 썸네일 누락 0, 스타일 불일치 0, 최대 정규화 좌표 오차 0.
  - Delete, Backspace, 툴바 삭제, Undo, Redo, 페이지 전환, 저장·재열기, archive, PNG PASS.
- Lite build 및 스트리핑 검증: PASS.
- Pro 최종 복원 build 및 에디션 확인: PASS.
- `git diff --check`: whitespace error 없음. 기존 LF/CRLF 변환 경고만 존재.

### 추가 증거

- 실제 한글 Electron 라운드트립: `.omc/evidence/v6/render-sync-body-number/83-electron-prod-ime-commit-flow.log`
- 최종 화면: `.omc/evidence/v6/render-sync-body-number/83-electron-prod-ime-commit-flow.png`
- UI 본문 텍스트: `.omc/evidence/v6/render-sync-body-number/83-electron-prod-ime-commit-flow.txt`
- 저장 archive: `.omc/evidence/v6/render-sync-body-number/83-body-number-roundtrip.cardnews`
- 삭제 상태 HTML/PNG: `.omc/evidence/v6/render-sync-body-number/83-card-02-deleted.html`, `83-card-02-deleted.png`
- 전체 테스트: `.omc/evidence/v6/render-sync-body-number/84-full-tests-final-ime.log`
- Lite/Pro 게이트: `85-build-lite-final-ime.log`, `86-verify-edition-lite-final-ime.log`, `87-build-pro-final-ime.log`, `88-verify-edition-pro-final-ime.log`

### 남은 한계

- 실제 MP4 파일 생성은 PASS이고 영상 프레임의 본문 번호 상태는 자동 테스트로 검증했지만, 최종 MP4에서 프레임을 추출해 사람이 픽셀을 대조하는 수동 검수는 수행하지 않았다.
- `package.json`에 lint 명령이 없어 lint는 NOT TESTED다.
- 이번 작업에서도 EXE 패키징과 `release/` 공개 배포물 변경은 수행하지 않았다.

## 6-36. 최신 Lite/Pro EXE 패키징 및 배포 후보 구성 (2026-07-18 Codex)

6-35의 한글 IME·본문 번호·렌더 동기화 수정이 포함된 소스로 Lite/Pro를 새 격리 루트에서 다시 패키징했다. 이전 2026-07-17 패키지는 재사용하지 않았으며, 실제 사용자 전달용 설치형 묶음과 테스트용 무설치 폴더·ZIP을 별도 배포 후보 루트에 구성했다.

### 최신 격리 패키지

- 실행 루트: `.omc/build/m24/m24-release-2026-07-18-05-22-39/`
- Lite 설치 EXE: `.omc/build/m24/m24-release-2026-07-18-05-22-39/Lite/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- Lite 무설치 EXE: `.omc/build/m24/m24-release-2026-07-18-05-22-39/Lite/win-unpacked/Cardnews Studio Lite.exe`
- Pro 설치 EXE: `.omc/build/m24/m24-release-2026-07-18-05-22-39/Pro/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- Pro 무설치 EXE: `.omc/build/m24/m24-release-2026-07-18-05-22-39/Pro/win-unpacked/Cardnews Studio Pro.exe`
- 패키지 보안 보고서: `.omc/build/m24/m24-release-2026-07-18-05-22-39/package-security.json`

### 배포 후보 루트

- 전체: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/`
- Lite 설치형: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Lite/Installer/`
- Lite 무설치 폴더·ZIP: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Lite/Portable/`
- Pro 설치형: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Pro/Installer/`
- Pro 무설치 폴더·ZIP: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Pro/Portable/`
- 공통 설명서·배포 안내: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Documents/`
- 검증 보고서·렌더 증거: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Verification/`
- 전체 체크섬: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/SHA256SUMS.txt`
- 릴리스 매니페스트: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/release-manifest.json`

### 핵심 파일 SHA-256

- Lite 설치 EXE: `1e99fe3770cf5df9d14f3be402177c7803edf214120a88eafeb89806378bf900`
- Lite Portable ZIP: `2a926de5855326fa0c2f6f79abc4559262b187d7602e89b57011eb5ed568d76b`
- Pro 설치 EXE: `7b00b54108ed7858eb6460a7a3b7e8d46035bba978e2b9db2a2731c82fadb6af`
- Pro Portable ZIP: `ce5a12dbf791b632eacad18679d4ec79a59ecb59152d9add48655ae6b88554a0`

### 패키징 전 보강

- `scripts/verify-m23-canvas.mjs`: Stage가 `prepareSemanticItemPlacements(document)`를 통해 폰트·이미지 준비를 기다리는 현재 구조를 검증하도록 오래된 정적 게이트를 갱신했다.
- `scripts/verify-packaged-render.mjs`: 비율 변경 후 React가 삭제 버튼을 다시 렌더링할 때 이전 DOM 참조를 클릭하던 설치형 스모크의 경쟁 상태를 제거했다. 카드 삭제 시 버튼을 매 시도 다시 조회하고 실제 카드 수 감소를 확인하며 최대 3회 재시도한다.
- `scripts/generate-lite-distribution-guide.mjs`, `scripts/generate-usage-guide.mjs`, `scripts/generate-pro-distribution-guide.mjs`: 최신 `내보내기 → PNG 카드 / MP4 영상`, 9:16, 영상 만들기·카드별 시간 흐름과 실제 배포 파일명을 반영했다.
- 배포 문서 추가: `docs/README-배포안내.txt`, `docs/README-무설치.txt`, `docs/배포전-최종체크리스트.txt`.

### 최종 검증

- M24 G8 전체 회귀: typecheck PASS, 53 files / 404 tests PASS.
- M24 G9 Lite source build·에디션 스트리핑: PASS.
- M24 G10 Pro source build·에디션·FFmpeg smoke: PASS.
- M24 G11 격리 패키징·패키지 보안: PASS.
- M24 G12 무설치:
  - Lite/Pro 새 사용자 프로필 실제 실행·종료 PASS.
  - Lite/Pro 4:5 PNG 1080×1350 렌더 PASS.
- M24 G12 설치형:
  - Lite/Pro 자동 설치 PASS.
  - 실제 실행과 4:5 PNG 1080×1350 렌더 PASS.
  - 자동 제거 및 격리 설치 경로 잔여물 없음 PASS.
- 배포 후보:
  - 설치 EXE, 무설치 EXE와 `app.asar`가 격리 검증 원본과 SHA-256 동일.
  - Lite/Pro Portable ZIP의 모든 엔트리를 끝까지 읽고 실행 EXE, `resources/app.asar`, 해당 HTML 설명서와 `README-무설치.txt` 존재 확인 PASS.
  - HTML 사용설명서를 Playwright Chromium에서 열어 시각 캡처 PASS.
  - 설명서에 로컬 `file:///` 또는 `C:\Users\...` 경로 누출 없음 PASS.
  - 최종 보고서: `release/Cardnews-Studio-2.0.0-Release-Candidate-2026-07-18/Verification/distribution-validation.json`.

### 남은 배포 게이트

- 현재 PC 검증은 통과했지만 기존 앱·Node.js·개발 도구가 없는 Clean Windows VM 또는 다른 실제 PC 설치 검증은 수행하지 않았다. 따라서 폴더명은 `Release-Candidate`로 유지했다.
- 설치 EXE는 상용 Authenticode 코드 서명이 없어 `NotSigned`이며 Windows SmartScreen 경고가 표시될 수 있다.
- 공개 대규모 배포 전 `배포전-최종체크리스트.txt`의 다른 PC 항목을 수행하고, 통과 후 Release Candidate 표시를 제거한다.
