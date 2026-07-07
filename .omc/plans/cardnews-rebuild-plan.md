# Plan: 정보형 카드뉴스 제작기 재설계

> Status: FINAL CONSENSUS
> Source spec: `.omc/specs/deep-interview-cardnews-rebuild.md`
> Prior draft: `.omc/drafts/cardnews-rebuild-plan-draft.md`
> Handoff doc: `HANDOFF.md`
> Finalized: 2026-07-06

## 1. Decision

기존 Chrome 확장 프로그램(ChatGPT DOM 자동화)은 제품 방향에서 폐기한다. 새 제품은 Electron + React 기반 독립 앱으로 만든다. 사용자는 배경 이미지 1장, 헤더/푸터, 10장 카드별 라벨 문법 텍스트를 입력하고, 앱은 결정론적 HTML/CSS 텍스트 레이어를 Electron 오프스크린 렌더러에서 PNG로 캡처한다.

렌더링은 `BrowserWindow({ webPreferences: { offscreen: true } })`의 `paint` 이벤트에서 받은 `NativeImage`를 PNG로 저장하는 방식을 1차 경로로 쓴다. 숨겨진 일반 창의 `capturePage()`는 기본 경로로 쓰지 않는다. 단, Phase 3 검증에서 오프스크린 렌더링이 반복 블랭크 프레임 또는 픽셀 결정론성 실패를 보이면 Option B로 전환한다: `puppeteer-core` + 번들된 `chrome-headless-shell`로 cardprinter식 렌더 경로를 채택한다.

## 2. Final Acceptance Criteria

1. Windows 개발 환경에서 `npm run dev`로 Electron 앱이 실행되고, 최종 배포 목표는 Claude Code 없이 설치 가능한 앱이다.
2. 배경 이미지 1장을 선택하면 10장 모든 카드의 공통 배경으로 적용되고, 선택 파일의 절대 경로는 renderer에 직접 노출하지 않는다.
3. 카드별 textarea는 `유형: 표지|본문|마무리`, `제목:`, `소제목:`, `본문:`, `출처:`, `강조:` 라벨을 순서와 누락에 견고하게 파싱한다.
4. `본문:` 안에서 `-`로 시작하는 줄은 불릿 리스트로 구조화되고, 일반 줄은 문단으로 구조화된다.
5. 카드 유형별 템플릿이 실제로 달라진다: 표지는 대형 헤드라인 중심, 본문은 제목+본문블록 중심, 마무리는 CTA/강조 중심이다.
6. 헤더(상단 라벨)와 푸터(SNS 계정명)는 10장 모든 PNG 안에 렌더링된다.
7. 동일 입력을 두 번 렌더링하면 PNG 픽셀 해시가 모두 동일하다.
8. 품질 게이트는 최소 대비(WCAG 4.5:1), 텍스트 bbox 세이프존 포함, 폰트 크기 하한을 검사하고, 실패 시 카드 번호, 슬롯 이름, 측정값, 요구값을 UI에 표시한다.
9. 렌더 완료 후 10장 썸네일, 카드별 품질 게이트 상태, 저장 위치를 한 화면에 표시하고, 사용자가 승인/수정/재생성을 선택할 수 있다. 승인 전 PNG 세트는 최종 완료 상태로 표시하지 않는다.
10. 렌더 실패, 게이트 실패, 스타일 추출 실패는 서로 다른 사용자 메시지와 재시도/수정 액션을 가진다.
11. 참고 캐러셀 이미지 업로드 시 팔레트, 레이아웃 구조, 폰트 분위기 초안이 추출되고, 사용자가 미리보기에서 승인해야 적용된다.
12. 스타일 추출 API 키가 없거나 호출이 실패하면 기본 newsprint 스타일로 계속 렌더링할 수 있다.
13. 로컬 이미지 파일은 확장자와 MIME을 검증하고, 지원 형식은 `png`, `jpg`, `jpeg`, `webp`로 제한한다.
14. renderer 프로세스는 Node API에 직접 접근하지 않는다. 모든 파일/렌더/스타일 작업은 `contextBridge`로 노출한 `window.cardnews.*` API를 통해 main 프로세스가 처리한다.
15. 번들 폰트는 OFL 등 라이선스를 `fonts/NOTICE.md`와 `THIRD_PARTY_NOTICES.md`에 기록하고, 앱 설정/정보 화면에서 확인 가능하게 한다.
16. 10장 렌더링은 기본 동시성 1로 순차 처리한다. 사용자가 보는 진행률은 `1/10`부터 `10/10`까지 갱신되고, 목표 시간은 일반 1080x1350 카드 10장 기준 15초 이하로 둔다.
17. `HANDOFF.md`는 각 Phase 완료 또는 주요 결정 변경 시 업데이트되어 다음 에이전트가 문서만 보고 이어받을 수 있다.

## 3. Architecture

### 3.1 App Layers

- `electron/main.ts`: 앱 수명주기, 파일 선택/복사, deck 저장, offscreen render orchestration, IPC handler.
- `electron/preload.ts`: `contextBridge.exposeInMainWorld('cardnews', ...)`만 노출.
- `src/ui`: React UI. deck 입력, 스타일 승인, 게이트 오류 표시, 생성 진행률 표시.
- `src/domain`: `Deck`, `Card`, `StyleProfile`, `RenderResult`, `QualityGateResult` 타입.
- `src/lib/cardParser.ts`: textarea 라벨 문법 파서.
- `src/render-engine`: HTML 템플릿, offscreen renderer, slot metric extraction, PNG writer.
- `src/render-engine/gates`: contrast, overflow, font floor gates.
- `src/storage`: `app.getPath('userData')` 하위 JSON 저장소.

### 3.2 IPC Contract

Renderer는 아래 API만 호출한다.

```ts
window.cardnews = {
  chooseBackgroundImage(): Promise<LocalImageRef | CardnewsError>;
  chooseStyleReferenceImages(): Promise<LocalImageRef[] | CardnewsError>;
  loadDeck(): Promise<Deck | CardnewsError>;
  saveDeck(input: DeckDraft): Promise<Deck | CardnewsError>;
  parseCard(rawText: string): Promise<Card | CardnewsError>;
  extractStyle(imageRefs: LocalImageRef[]): Promise<StyleExtractionDraft | CardnewsError>;
  approveStyle(profile: StyleProfile): Promise<StyleProfile | CardnewsError>;
  renderDeck(deckId: string): Promise<RenderJobResult | CardnewsError>;
  openOutputFolder(jobId: string): Promise<void | CardnewsError>;
}
```

`LocalImageRef`는 원본 절대 경로 대신 앱 내부 관리 ID, 표시용 파일명, 크기, MIME, 내부 복사 경로만 가진다. renderer에서 임의 파일 경로를 main으로 보내 렌더러가 읽게 하지 않는다.

### 3.3 Storage Contract

`app.getPath('userData')/gpt-cardnews-auto/` 아래에 저장한다.

- `decks/<deckId>/deck.json`
- `decks/<deckId>/assets/background.<ext>`
- `decks/<deckId>/assets/style-reference-<n>.<ext>`
- `decks/<deckId>/style-profile.json`
- `renders/<jobId>/card-01.png` ... `card-10.png`
- `renders/<jobId>/slots.json`
- `renders/<jobId>/gate-report.json`

## 4. Error UX

### Render Failure

- Trigger: 오프스크린 `paint` 이벤트 미발생, 빈 PNG, 폰트 로딩 타임아웃, 템플릿 JS 오류.
- UI: "카드 3 렌더링에 실패했습니다. 폰트/이미지 로딩 또는 템플릿 오류입니다."
- Action: 실패 카드 재시도, 전체 재생성, 문제 상세 열기.
- Evidence: `render-error.json`에 카드 번호, stage, error code, stack 요약 저장.

### Quality Gate Failure

- Trigger: 대비, 오버플로, 폰트 하한 실패.
- UI: "카드 4의 제목 대비가 3.2:1입니다. 최소 4.5:1이 필요합니다."
- Action: 텍스트 수정, 스타일 자동 조정 제안, 해당 카드 재검사.
- Evidence: `gate-report.json`에 measured/required/card/slot 저장.

### Style Extraction Failure

- Trigger: API 키 없음, 네트워크 실패, 모델 응답 JSON 파싱 실패, 이미지가 분석 불가.
- UI: "스타일 분석을 완료하지 못했습니다. 기본 newsprint 스타일로 계속 만들 수 있습니다."
- Action: 다시 시도, 참고 이미지 교체, 기본 스타일 사용.
- Evidence: `style-extraction-error.json`에 provider, error code, retryable 저장. 원본 이미지는 외부로 전송 전 사용자 승인 문구를 거친다.

## 5. Privacy and Security

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`를 기본값으로 유지한다.
- renderer는 파일 시스템 경로, Node `fs`, shell, 임의 IPC 채널에 직접 접근하지 않는다.
- main 프로세스는 파일 선택 다이얼로그로 받은 파일만 앱 데이터 디렉토리로 복사한다.
- 이미지 검증은 확장자, MIME, 파일 크기 상한(기본 25MB), 실제 이미지 디코딩 성공 여부를 함께 본다.
- 참고 캐러셀 이미지는 스타일 추출 시 외부 API로 전송될 수 있음을 UI에서 명시하고, 사용자가 승인해야 호출한다.
- 렌더 결과와 입력 이미지는 로컬에만 저장한다. 사용자가 명시적으로 스타일 추출을 실행할 때만 참고 이미지가 외부 API로 전송된다.
- IPC handler는 입력 스키마를 검증하고 알 수 없는 필드는 거부한다.

## 6. Font and License Plan

- 기본 한글 폰트 후보는 OFL 또는 동등하게 재배포 가능한 라이선스만 사용한다.
- 후보: Pretendard, Noto Sans KR, Noto Serif KR 등. 실제 번들 전 라이선스 파일을 저장소에 포함한다.
- `fonts/NOTICE.md`와 `THIRD_PARTY_NOTICES.md`에 폰트명, 버전/출처, 라이선스, 라이선스 전문 위치를 기록한다.
- 폰트는 Phase 3 렌더 결정론성 테스트 전에 고정한다. 시스템 폰트 의존은 재현성을 떨어뜨리므로 기본 경로로 쓰지 않는다.

## 7. Performance and Concurrency

- 기본 렌더링은 카드 10장을 순차 처리한다. 오프스크린 BrowserWindow는 1개를 재사용하거나 카드별 생성/폐기 중 더 안정적인 방식을 Phase 3에서 실측해 결정한다.
- 동시성 2 이상은 실험 플래그로만 둔다. 기본값으로 병렬 렌더링하지 않는다.
- 목표: 1080x1350 카드 10장, 기본 newsprint 스타일, 로컬 배경 이미지 기준 15초 이하.
- timeout: 카드 1장당 폰트/이미지 준비 5초, paint 대기 5초. 초과 시 render failure로 분류한다.
- 진행률 이벤트: `render:progress`로 cardIndex, total, stage(`prepare|render|gate|write`)를 보낸다.
- Phase 3에서 `paint` 이벤트 image hash와 PNG hash를 모두 기록해 블랭크 프레임과 스테일 프레임을 탐지한다.

## 8. Implementation Phases

### Phase 1: Electron Scaffold

Files:
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `electron/main.ts`
- `electron/preload.ts`
- `src/ui/App.tsx`
- `src/ui/main.tsx`
- `src/ui/styles.css`
- `src/domain/types.ts`

Deliverables:
- Electron + React + TypeScript dev server.
- Secure preload with `window.cardnews` stub methods.
- UI skeleton: background chooser, header/footer fields, 10 card textareas, render button, status panel.
- Existing extension files remain as legacy reference only; new app code does not call them.

Verification:
- Failing-first: `npm run typecheck` fails before scaffold because config/source entrypoints are absent.
- Green: `npm run typecheck` exits 0 after scaffold.
- Real surface: `npm run dev` launches Electron window and shows the scaffold controls.

### Phase 2: Parser and Domain Contract

Deliverables:
- `Card`, `Deck`, `StyleProfile` types.
- `parseCardText(raw)` for Korean labels and bullets.
- Unit tests for label order, missing labels, invalid type, bullets, empty card.

Verification:
- Parser tests fail before implementation, pass after.
- UI can parse all 10 cards and show structured preview/debug output.

### Phase 3: Templates and Offscreen Renderer

Deliverables:
- cover/body/cta templates.
- offscreen BrowserWindow renderer using `paint` event.
- slot metric extraction via `executeJavaScript`, returning JSON-serializable objects only.
- PNG writer and `slots.json`.

Verification:
- 1-card render produces non-empty PNG.
- Same input rendered twice gives identical SHA-256.
- Blank/stale frame detector fails if image is transparent/empty or repeated incorrectly.
- If this phase cannot make offscreen rendering reliable, record evidence in `HANDOFF.md` and switch to Option B.

### Phase 4: Quality Gates

Deliverables:
- contrast gate.
- overflow gate.
- font floor gate.
- UI gate failure report.

Verification:
- Intentional low-contrast fixture fails with measured ratio.
- Intentional overflowing text fixture fails with bbox and safezone values.
- Valid fixture passes all gates.

### Phase 5: Style Extraction

Deliverables:
- reference image picker.
- style extraction prompt and provider boundary.
- preview/approve UI.
- fallback to default style on missing key/failure.

Verification:
- Missing API key shows recoverable error and still allows default render.
- Mocked successful extraction creates a style profile with palette/layout/font mood.
- User approval is required before applying extracted style.

### Phase 6: Packaging and End-to-End QA

Deliverables:
- Windows package config.
- `THIRD_PARTY_NOTICES.md`.
- Full 10-card output flow.
- Final `HANDOFF.md` update.

Verification:
- Build succeeds.
- Full manual flow: choose background, enter 10 cards, render, inspect output folder, verify 10 PNGs + `gate-report.json`.

## 9. Phase Dependency Matrix

| Phase | Depends on | Blocks | Parallelizable Work |
|---|---|---|---|
| 1 Scaffold | final plan | all implementation | license notice draft can begin after package choice |
| 2 Parser | Phase 1 types/test runner | template data contract | UI copy polishing |
| 3 Renderer | Phase 1, minimal domain types | gates, final output | template variants can be developed alongside renderer once card type shape is fixed |
| 4 Gates | Phase 3 slot metrics | release-quality render | UI error panel can begin from planned error contract |
| 5 Style Extraction | Phase 1 IPC, storage contract | custom style UX | default newsprint renderer does not depend on it |
| 6 Packaging | Phases 1-5 | distribution | documentation can run alongside final QA |

Critical path: Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 6. Phase 5 is important but must not block default newsprint rendering if API credentials are absent.

## 10. Must Not Have

- No ChatGPT DOM automation in the new product path.
- No AI-generated text baked into images.
- No hidden-window `capturePage()` as the primary renderer.
- No renderer-process filesystem access.
- No external image upload without explicit user action and notice.
- No bundled font without license notice.
- No "render succeeded" status unless PNG exists, is non-empty, and gates either pass or report structured failures.
