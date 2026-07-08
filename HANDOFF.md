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

## 7. 참고 리소스

- cardprinter 클론 위치(스크래치패드, 임시): `C:\Users\js480\AppData\Local\Temp\claude\...\scratchpad\cardprinter` — 세션 종료 시 사라질 수 있음. 재클론: `git clone https://github.com/kimsh-1/cardprinter`
- 렌더 결과 샘플: `cardprinter/examples/sample/out/card-01.png` ~ `card-08.png` (신문지형 데모, 검증 완료)
- 딥인터뷰 상태 파일: `.omc/state/deep-interview-state.json` (진행 중, interview_id: di-cardnews-20260706)
