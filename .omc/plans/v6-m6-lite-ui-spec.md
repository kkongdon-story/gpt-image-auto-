# V6 M6 작업 명세 — Lite UI를 Pro와 동일 화면 구성으로 재구성

작성: 2026-07-08 (Claude 설계, Codex 실행용). 이전 시도 task-mrbtqd29-tpxvbh는 스톨되어 종료됨.
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto
필독: .omc/plans/v6-lite-pro-prd.md §0(하네스 규칙·함정)·§1(Lite/Pro 매트릭스)

## 이전 시도 잔재 처리

- 미완성 diff가 `git stash` 항목 **"stalled-m6-partial-1832"** 로 보관되어 있다(대상: src/edition/lite/index.tsx, src/edition/pro/index.tsx, src/ui/App.tsx, src/ui/main.tsx, 합계 +248줄).
- 착수 시 `git stash show -p stash@{0}`로 내용을 검토해 **쓸 만하면 pop해서 이어가고, 방향이 어긋나면 stash는 그대로 두고 클린 트리에서 새로 시작**해도 된다(강제 아님).

## 문제 (사용자 피드백, Lite 배포 시급)

현재 Lite 빌드(src/ui/LiteApp.tsx)는 별도 축소 UI라서 좌측 슬라이드 레일도 없고 전체 구성이 Pro와 다르다. 사용자 요구: **화면 구성은 Pro와 완전히 동일, Pro 전용 기능 버튼만 잠금(비활성) 표시.**

## 목표 아키텍처

1. **App.tsx = 유일한 공용 셸.** LiteApp.tsx의 별도 레이아웃 폐기.
2. Pro 전용 기능의 **렌더 지점만** `@edition` alias 모듈로 분기:
   - `src/edition/pro/` = 실제 기능 컴포넌트/훅 (App.tsx 인라인 Pro 로직을 여기로 추출)
   - `src/edition/lite/` = 같은 자리·같은 크기의 잠금 스텁 (자물쇠 + "Pro에서 사용 가능" + Threads/카카오 링크, 기존 data-smoke-role="edition-lock" 패턴 유지)
3. Lite에서 Pro와 동일하게 보이고 동작해야 하는 것: 좌측 슬라이드 레일+썸네일, 중앙 스테이지 미리보기, 우측 인스펙터 탭 구조, topbar 전체(스타일/비율/헤더/멘션/초기화/PNG 생성), 스타일 11종·포인트색·어둡기, 배경 라이브러리+Pixabay 검색, 양식.md 내보내기/불러오기, 폰트 임포트, 커스텀 스타일 임포트, 양식 프리셋, 카드 추가/삭제, 콘텐츠 구조화 폼([내용] 탭), PNG/ZIP 내보내기, 크레딧.
4. Lite에서 잠금 스텁으로 대체: 카드 [디자인] 탭 내용, 편집 모드(오버레이), 크롬 스타일 패널, 넘김기호 이미지 선택, CSV 벌크, .cardnews 프로젝트, AI 패널, 배경 제거 버튼. **버튼/탭 자체는 보이되** 내용/클릭이 잠금 안내.
5. **스트리핑 원칙 절대 유지**: Lite 번들에 Pro 기능 코드가 물리적으로 남으면 안 된다. App.tsx 인라인 Pro 로직(레이어 오버레이 핸들러/AI 상태·핸들러/CSV/프로젝트/크롬 스타일 UI)을 edition/pro로 추출해야 verify-edition이 통과한다. Lite preload/main 전용 entry는 현행 유지.

## 작업 순서 (스톨 방지 — 단계별로 작게, 단계마다 typecheck)

S1. App.tsx의 Pro 전용 UI 블록 식별 → edition/pro 컴포넌트로 추출(기능 변화 없음, Pro 빌드 회귀 확인) → 중간 커밋 허용
S2. edition/lite에 동일 시그니처 잠금 스텁 구현
S3. main.tsx/빌드가 @edition alias로 App.tsx 단일 엔트리 사용, LiteApp.tsx 제거
S4. edition-lite-regression 스모크 갱신: Lite 화면에 (a)슬라이드 레일 (b)스테이지 미리보기 (c)인스펙터 탭 구조 (d)Pro 자리마다 edition-lock 스텁 (e)잠금 IPC not_implemented — 검증
S5. 최종 게이트 전체

## 완료 조건 (전부 통과)

1. npm run typecheck / npm test / npm run build / npm run build:lite → exit 0
2. node scripts/verify-edition.mjs --edition lite --scan dist dist-electron → pass (금지 심볼 갱신 포함)
3. CARDNEWS_SMOKE_ACTION=edition-lite-regression → exit 0 (S4 신규 기준)
4. Pro 회귀: layer-controls-regression / chrome-style-regression / content-form-regression → exit 0
5. Lite 기본 플로우(스타일 변경→카드 편집→PNG 생성) 스모크 확인
6. 커밋 + HANDOFF.md 6-15 섹션 기록 + .omc/evidence/v6/m6-lite-ui/ 증거 저장

## 함정 (PRD §0.3 승계 — 재발 금지)

- iframe sandbox="allow-same-origin" 유지, allow-scripts 금지 / transform scale은 숫자만(ResizeObserver)
- exactOptionalPropertyTypes → 조건부 스프레드 / styleSafety·게이트·멘션 정규화(kkongdon_story) 완화 금지
- OneDrive EPERM: dist 패키징은 이번 범위 아님. 필요 시 %LOCALAPPDATA% 출력 우회
- 빌드류 명령은 `| tail` 금지(실패 은폐) — 로그 파일 리다이렉트 후 exit code 확인
