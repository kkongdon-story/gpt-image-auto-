# Deep Interview Context Snapshot: Lite/Pro Feature Separation

Created: 2026-07-09T03:49:52Z
Profile: standard
Task slug: lite-pro-feature-separation

## Task statement

사용자는 Cardnews Studio의 Lite 버전과 Pro 버전 기능 분리를 상세히 정리하려고 한다. UI/UX는 같게 유지하되, Lite에서는 Pro 기능 버튼/패널을 비활성화 또는 잠금 처리하는 방향을 원한다.

## Desired outcome

Lite에 제공할 기능과 Pro 전용 기능을 세부 기능 단위로 분류한 실행 가능한 스펙/매트릭스.

## Stated solution

- UI/UX는 Lite/Pro 동일하게 유지.
- Lite에서는 Pro 기능을 제거하기보다 버튼 비활성화/잠금 안내로 버전 차이를 보여줌.
- 최대한 상세하게 세부 기능을 분류.

## Probable intent hypothesis

사용자는 무료/입문용 Lite를 너무 약하게 만들면 체험 가치가 낮고, 너무 많이 열면 Pro 전환 이유가 약해지는 문제를 해결하려 한다. 따라서 기능 단위뿐 아니라 워크플로우, 저장/내보내기, 자동화, 편집 자유도, 브랜드/크레딧, AI 기능의 경계를 제품 전략 관점에서 확정해야 한다.

## Known facts/evidence

- `.omc/plans/v6-lite-pro-prd.md` §1에는 기존 확정 매트릭스가 있다.
- 기존 매트릭스는 다음을 Lite/Pro 공통으로 둔다:
  - 내장 스타일 프리셋 11종, 비율 4종, 포인트색/어둡기
  - 카드 편집, 추가/삭제, 미리보기, PNG/ZIP 내보내기
  - 배경 이미지 라이브러리 + Pixabay 검색
  - 양식.md 내보내기/불러오기
  - 폰트 임포트
  - 커스텀 스타일 임포트
  - 양식 프리셋 저장 + 워크스페이스 자동저장
  - 헤더/멘션/페이지번호 내용 변경
  - 크레딧 링크 유지
- 기존 매트릭스는 다음을 Pro 전용으로 둔다:
  - 헤더/멘션/페이지번호 스타일
  - 콘텐츠 디자인 전체: 레이어, 카드별 오버라이드, 편집 오버레이
  - 배지 모양/이미지 배지/배경 제거
  - 넘김기호 이미지 교체
  - CSV 벌크 생성
  - `.cardnews` 프로젝트 파일 저장/열기
  - 프로그램 내 AI
- HANDOFF M6 이후 현재 구조는 Lite 별도 축소 UI가 아니라 동일 `src/ui/App.tsx` shell을 공유하고, `src/edition/lite/index.tsx`가 Pro 기능을 `not_implemented`/`FeatureLock`으로 막는 구조다.
- `src/edition/pro/index.tsx`는 Pro API wrapper를 제공하고, `src/edition/lite/index.tsx`는 같은 시그니처의 잠금/stub을 제공한다.
- `scripts/verify-edition.mjs`는 Lite artifact에서 Pro-only symbol이 남는지 검사한다.

## Constraints

- Lite/Pro UI/UX는 최대한 같아야 한다.
- Lite는 Pro 기능 실행 경로를 실제로 포함하지 않아야 한다. 단순 CSS disabled만으로는 부족하며, API/IPC/bundle stripping 검증도 유지해야 한다.
- 기존 V6 하네스 불변 원칙을 유지해야 한다: 단일 렌더 계약, 결정론, 게이트 우회 금지, styleSafety 완화 금지, 하위호환, footerAccount 정규화.
- EXE packaging 여부는 이번 deep-interview 범위 밖이다.

## Unknowns/open questions

- Lite의 제품 포지션: 체험판, 무료 기본판, 강의 수강생 배포판, 납품용 viewer/editor 중 무엇인가?
- Lite에서 “사용해볼 수는 있지만 결과물에 제한”을 둘지, “결과물은 완성 가능하지만 고급 생산성만 제한”할지.
- Lite 워터마크/크레딧/브랜드 링크 정책.
- Lite export 제한: 장수, ZIP, 해상도, 일괄 내보내기, 상업 사용 문구.
- Pro 전환 유도 UX: disabled 버튼, lock panel, 안내 문구, 문의 링크, 업그레이드 CTA 중 어디까지.
- AI, CSV, 프로젝트 파일, 이미지 누끼 같은 Pro 기능을 Lite에서 “보이게 잠금”할지 “메뉴 자체 숨김”할지.

## Decision-boundary unknowns

- 에이전트가 제품 전략상 기본 Pro로 분류해도 되는 기준.
- 애매한 기능의 기본값: 기존 PRD는 “애매하면 Pro”였지만, 이번 재분류에서도 유지할지.
- Lite에 제한을 걸어도 되는 사용자 경험상의 하한선.

## Likely codebase touchpoints

- `src/edition/lite/index.tsx`
- `src/edition/pro/index.tsx`
- `src/ui/App.tsx`
- `electron/lite-main.ts`
- `electron/main.ts`
- `scripts/verify-edition.mjs`
- `.omc/plans/v6-lite-pro-prd.md`
- HANDOFF.md

## Prompt-safe initial-context summary status

not_needed
