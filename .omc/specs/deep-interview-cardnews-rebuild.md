# Deep Interview Spec: 정보형 카드뉴스 제작기 재설계 (cardprinter 아키텍처 채택)

## Metadata
- Interview ID: di-cardnews-20260706
- Rounds: 약 16 (Chrome 익스텐션 개조 라운드 1-7 → cardprinter 발견 후 아키텍처 피벗 → 실행형태/스타일학습/라벨/품질게이트 라운드)
- Final Ambiguity Score: ~35-40% (핵심 7개 구성요소 goal 대부분 0.85+, 세부 constraints/criteria 일부 설계 단계로 이월)
- Type: brownfield → 아키텍처 피벗으로 사실상 greenfield 재작성
- Generated: 2026-07-06
- Threshold: 0.2
- Threshold Source: default
- Status: EARLY_EXIT (사용자가 "2-3라운드만 더" 요청 후 명시적으로 스펙 전환에 동의)

## Topology

| 구성요소 | 상태 | 설명 |
|---|---|---|
| 실행 형태 | 확정 | Claude Code 불필요한 독립 앱. 사용자의 다른 프로젝트 "KOS POV Lab"(Electron+React)과 유사한 형태로 예상 |
| 내 캐러셀 스타일 학습 | 확정 | 참고 이미지 업로드 → AI 비전으로 팔레트+레이아웃 구조+폰트 분위기 추출 |
| 텍스트 계약/라벨 문법 | 확정 | 카드당 자유 textarea + 라벨(제목/소제목/본문/출처/강조) + 카드 유형 태그(표지/본문/마무리) |
| 카드 템플릿/디자인 | 확정 | cardprinter의 newsprint 톤(신문지형 마스트헤드)을 기본 템플릿으로 채택, 카드 유형별 다른 레이아웃 |
| 배경 이미지 업로드 | 확정 | 사용자 직접 업로드, 전체 카드 공통 1장 |
| 헤더/푸터 메타 | 확정 | 헤더=카드 상단 라벨/카테고리, 푸터=SNS 계정명. 둘 다 이미지 안에 실제 렌더링 |
| 출력/렌더링 | 확정 | 결정론적 HTML/CSS 텍스트 레이어 + headless Chrome PNG export (cardprinter와 동일, Windows에서 검증 완료) + 전체 품질 게이트(G1~G19 수준) 도입 |

## Goal

Chrome 익스텐션(ChatGPT DOM 자동화) 기반의 "GPT 이미지 자동 생성기"를 폐기하고, [cardprinter](https://github.com/kimsh-1/cardprinter)의 로컬 결정론 렌더링 아키텍처(HTML/CSS 텍스트 레이어 + headless Chrome 스크린샷 → PNG, 픽셀 단위 품질 게이트)를 채택한 **독립 실행형 정보형 카드뉴스 제작 앱**을 새로 만든다.

사용자는 배경 이미지 1장을 업로드하고, 10장의 카드마다 라벨 문법(`제목:`/`소제목:`/`본문:`/`출처:`/`강조:`)과 카드 유형(`유형: 표지`/`본문`/`마무리`)으로 텍스트를 입력하며, 헤더(상단 라벨)와 푸터(SNS 계정명)를 한 번 설정하면 전체 카드에 공통 적용된다. 원한다면 자신의 기존 캐러셀 이미지를 올려 그 스타일(팔레트/레이아웃/폰트 분위기)을 학습시켜 반영할 수 있다. 결과물은 카드마다 픽셀 단위로 100% 일관된 PNG 세트다.

## Constraints

- Claude Code가 설치되지 않은 사용자도 쓸 수 있어야 함 (cardprinter의 "개인 전용 스킬" 형태는 채택하지 않음)
- 텍스트는 항상 HTML/CSS 레이어로 렌더링 — AI가 이미지 위에 직접 글자를 그리게 하지 않음
- 배경 이미지는 AI 생성이 아니라 사용자 업로드 — gpt-image-2 API, rembg 누끼 파이프라인 불필요
- 쇼츠/릴스(영상) 기능은 범위 밖 — 카드 캐러셀(PNG)만
- 품질 게이트(대비/오버플로/폰트크기 하한/렌더다양성 등, cardprinter G1~G19 수준)를 처음부터 도입
- 모든 작업 진행 상황을 프로젝트 루트의 `HANDOFF.md`에 계속 기록하여, 세션이 끊기거나 다른 에이전트(Codex 등)가 이어받아도 맥락 손실 없이 작업 재개 가능해야 함

## Non-Goals

- Chrome 익스텐션 형태 유지 (폐기)
- ChatGPT DOM 자동화를 통한 이미지 생성 (폐기)
- AI 이미지 생성/누끼(rembg) 파이프라인 (배경은 사용자 업로드이므로 불필요)
- 쇼츠/릴스 영상 출력
- Claude Code 전용 스킬 형태 배포 (독립 앱으로 확정)

## Acceptance Criteria

- [ ] 배경 이미지 1장 업로드 시 전체 10장 카드에 공통 배경으로 적용됨
- [ ] 카드별 textarea에 라벨 문법(`제목:`/`소제목:`/`본문:`/`출처:`/`강조:`)을 입력하면 올바르게 파싱되어 구조화 데이터로 변환됨
- [ ] 본문 안에서 `-`로 시작하는 줄은 자동으로 불릿 리스트 스타일로 렌더링됨
- [ ] 카드마다 `유형: 표지`/`본문`/`마무리` 태그에 따라 다른 레이아웃 템플릿이 적용됨
- [ ] 헤더(상단 라벨)와 푸터(SNS 계정명)가 모든 카드에 공통으로 렌더링됨
- [ ] 결과 PNG는 headless Chrome 렌더링을 통해 생성되며, 텍스트 위치가 실행할 때마다 100% 동일함(비결정적이지 않음)
- [ ] 참고 캐러셀 이미지를 업로드하면 팔레트/레이아웃 구조/폰트 분위기가 추출되어 템플릿에 반영됨
- [ ] 대비(contrast)/오버플로/폰트크기 하한 등 품질 게이트를 통과하지 못하면 명확한 오류로 표시됨
- [ ] Claude Code 없이 설치된 앱 형태로 실행 가능함
- [ ] `HANDOFF.md`가 개발 진행 상황에 따라 계속 갱신되어, 세션이 끊겨도 다른 에이전트가 이어받을 수 있음

## Assumptions Exposed & Resolved

| 가정 | 도전 | 해결 |
|---|---|---|
| "출력은 여전히 ChatGPT가 생성한다" (라운드 1) | cardprinter 데모를 직접 보고 나서, 텍스트 위치 비결정성을 감수할 필요가 없다는 게 드러남 | 아키텍처 전면 피벗 — 로컬 결정론 렌더링 채택 |
| "1~10 슬롯"이 카드 내부 요소인지 카드 개수인지 불명확 (라운드 2) | 기존 코드는 10슬롯=10장 배치생성이었음 | 10장 독립 카드 + 카드당 가변 역할구성으로 확정, cardprinter copy.json의 타입드 구조와 합치 |
| "cardprinter처럼 만들고 싶다"는 요청이 곧 "cardprinter를 그대로 쓴다"는 뜻은 아님 | cardprinter는 AI 배경생성+누끼+쇼츠까지 포함한 무거운 파이프라인 | 사용자 배경 업로드 + 카드 캐러셀만 필요하다는 점에서, cardprinter의 S2/S3/S5~S6 부분집합만 재사용하기로 단순화 |
| "Claude 스킬처럼 대화형으로 만들면 되는 거 아닌가" | cardprinter는 스스로 "개인 전용 스킬"이라 명시 — 배포 불가 | 다른 사람도 쓸 수 있는 독립 앱(Electron 등)으로 확정, cardprinter의 렌더 엔진만 내부 로직으로 흡수 |

## Technical Context (brownfield)

- 기존 리포: `manifest.json`(MV3), `popup/`(popup.html/css/js, vanilla JS), `background/background.js`(Service Worker), `content/content.js`+`content/net-hook.js`(ChatGPT DOM 자동화) — **전부 폐기 대상**, 참고용으로만 남겨둠(재활용 안 함)
- 참고 아키텍처: `cardprinter`(https://github.com/kimsh-1/cardprinter) — Node.js 20+/Python 3.11+/headless Chrome 기반. 로컬 클론 후 Windows에서 렌더링 파이프라인 실제 검증 완료(`bash scripts/pipeline.sh examples/sample draft` → 0 FAIL 2 WARN)
  - 데이터 계약: `brief.json → copy.json(타입드 카드) → tokens.json(디자인시스템)`
  - 렌더: `build_carousel.mjs`(HTML 생성) → `export_card.mjs`(headless Chrome → PNG + slots.json)
  - 품질 게이트: `scripts/gates/g01~g19_*.mjs|py` (exit-code 기반)
  - 톤 티어: `references/tiers/*.json` (newsprint 등)
  - Windows 실행 시 필요한 로컬 패치: `PYTHONUTF8=1`, `pip install brotli fonttools`, headless Chrome 경로를 시스템 Chrome으로 대체
- 인수인계 문서: 프로젝트 루트 `HANDOFF.md` — 모든 결정사항과 다음 단계가 기록되어 있음, 계속 갱신 예정

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|---|---|---|---|
| Card | core domain | index, type(표지/본문/마무리), title, subtitle, body(paragraphs+bullets), source, emphasis | Deck에 10개 속함 |
| Deck | core domain | cards[], background_image, header_label, footer_account, style_tokens | Card 10개, StyleProfile 1개 참조 |
| StyleProfile | core domain | palette, layout_structure, font_mood | 참고 이미지에서 추출, Deck에 적용 |
| RenderEngine | supporting | headless Chrome, HTML template, quality gates | Deck → PNG[] 변환 담당 |
| HANDOFF.md | external system | 프로젝트 상태, 결정사항, 다음 단계 | 세션/에이전트 간 인수인계용 |

## Interview Transcript

<details>
<summary>전체 요약 (원문 전사는 세션 로그 및 HANDOFF.md 참조)</summary>

1. Round 0: 크롬 익스텐션 개조 토폴로지 확인 (배경/텍스트슬롯/헤더푸터/출력렌더링 4요소) — 확인됨
2. Round 1: 출력 렌더링 → "여전히 ChatGPT가 생성" (이후 피벗으로 무효화)
3. Round 2: 1~10 슬롯 = 10장 독립 카드 + 카드당 역할별 하위필드
4. Round 3: 배경 이미지 = 전체 공통 1장, 기존 전역참고이미지 재활용
5. Round 4: 헤더=상단라벨/카테고리, 푸터=SNS계정명
6. Round 5: 카드마다 역할 구성이 가변적
7. Round 6 (SIMPLIFIER): 자유 textarea + 라벨 문법 채택
8. **피벗**: 사용자가 cardprinter GitHub 리포 클론/설치/분석 요청 → 검증 완료 → "크롬 익스텐션 폐기, cardprinter 방식으로 재설계" 결정
9. Round(재확인): 토폴로지 재구성 — 유저 dismiss (진행 보류)
10. 사용자가 Threads 게시글(cardprinter 데모와 동일 스타일) 첨부 → 복제 대상 확인 (비주얼스타일 + 4단계 흐름 + 스타일학습 기능 + Codex 인수인계 요구사항)
11. Round: 실행 형태 → 독립 앱 (Claude Code 불필요, KOS POV Lab 유사)
12. Round: 스타일 학습 범위 → 팔레트+레이아웃구조+폰트분위기 전부
13. Round A: 카드 유형 태그 → 표지/본문/마무리 + 유형별 다른 레이아웃
14. Round B: 라벨 목록 → 제목/소제목/본문(-자동리스트)/출처/강조
15. Round C: 품질 게이트 → cardprinter 수준 전부 도입
16. 사용자 동의로 스펙 크리스탈라이즈 진행

</details>
