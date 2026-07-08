# V6 M7/M8 작업 명세 — AI 챗봇 UI + 이미지 피커/배지 색

작성: 2026-07-08 (Claude 설계, Codex 실행용)
전제: M6(Lite UI 공용 셸 재구성, task-mrbtqd29-tpxvbh) 완료·커밋 후 착수
필독: .omc/plans/v6-lite-pro-prd.md §0(하네스 규칙)·§1(매트릭스) — 불변 원칙/함정 그대로 적용

공통 완료 조건: typecheck/test/build/build:lite exit 0 · verify-edition lite pass ·
관련 스모크 갱신 후 exit 0 · Pro 회귀(layer-controls/chrome-style/content-form) exit 0 ·
커밋 + HANDOFF.md 섹션 추가 + .omc/evidence/v6/{m7|m8}/ 증거 저장

---

## M7 — AI 패널을 챗봇형 UI로 재구성 (Pro 전용)

### 문제 (사용자 피드백)
현재 AI UI가 "프리셋 버튼 + textarea 2개 나열"이라 챗봇 형태가 아니고 직관적이지 않다.
(스크린샷 기준: 입력 textarea → 프리셋 버튼 → 보내기 → 결과 textarea → 카드에 적용)

### 목표 UX (챗봇형)
1. **대화 스레드 뷰**: 스크롤 영역에 user/assistant 말풍선 교차 표시. 세션 내 이력 유지(메모리), [새 대화] 버튼으로 초기화.
2. **입력부**: 하단 고정 멀티라인 입력창 + 전송 버튼. Enter=전송, Shift+Enter=줄바꿈. 전송 중에는 입력 비활성 + assistant 자리 로딩 스피너 말풍선.
3. **프리셋 칩 4종**(주제 탐색/자료 검색/대본 작성/이미지 프롬프트): 입력창 바로 위. 클릭 시 **입력창에 템플릿이 채워지고 포커스**(자동 전송 금지 — 사용자가 주제를 다듬어 보냄). 기존 aiPrompts.ts 빌더 재사용.
4. **양식 감지 → 적용 버튼**: assistant 응답에서 extractTemplateDocument()로 양식.md 블록이 감지되면, 해당 말풍선 하단에 [카드에 적용] 버튼 + "카드 N장 감지" 배지 표시. 클릭 시 기존 parseDeckDocument 적용 경로 그대로(성공/경고 상태 메시지). 블록 자체는 접힌 <details>로 표시(펼치면 원문).
5. **오류 처리**: CLI 실패/타임아웃은 assistant 오류 말풍선(재시도 버튼 포함)로 표시. 크래시 금지.
6. **상단 컴팩트 바**: provider 셀렉트(claude/codex/gemini) + 상태 점(설치됨=초록/미설치=회색) + 새로고침. 미설치 provider 선택 시에만 설치 안내(명령 복사 버튼) 노출. 기존 "AI 설정/대본" 세로 나열 UI 폐기.
7. **배치**: AI 패널은 세로 공간이 필요하므로 topbar의 [AI] 버튼 → 우측 슬라이드오버 패널(폭 ~400px, 인스펙터 위 오버레이)로 여닫는 구조 권장. 기존 내보내기 탭 내 배치는 제거. (Lite에서는 M6 잠금 스텁 패턴 그대로 — 버튼은 보이되 잠금 안내.)

### 구현 지침
- 대화 직렬화: 기존 runAiChat(messages) 경로 유지. 이력은 최근 12턴만 CLI에 전달(초과분은 잘라내되 UI에는 전부 표시).
- CARDNEWS_MOCK_AI=1 모드: 프리셋 무관 첫 응답에 mock 양식.md 초안 반환(기존 buildMockDraftDocument 재사용) — 스모크 결정론 유지.
- ai-draft-regression 스모크 갱신: AI 버튼 클릭 → 패널 열림 → 프리셋 칩 클릭(입력창 채워짐 확인) → 전송 → assistant 말풍선 + [카드에 적용] 버튼 등장 → 적용 → 카드 파싱/렌더 완료 검증.
- 보안 원칙 불변: provider allowlist, stdin 전달, AI 출력 실행 금지(parse-only).

---

## M8 — 이미지 피커 공용화 + 배지 텍스트 색 (Pro 전용)

### 문제 (사용자 피드백 3건)
1. 넘김기호 "표시 방식"에서 이미지를 선택하면 **무의미한 이미지만 붙는다** — 기능이 제 역할을 못 함.
2. 배지의 **텍스트 색상을 바꿀 수 없다**.
3. **이미지 배지를 눌렀을 때 다 이상한 것만 나온다** — 넘김기호 이미지도 동일.

### 원인 진단 (착수 시 반드시 확인 후 수정)
- 이미지 선택 UI가 파일명 드롭다운뿐이라 어떤 이미지인지 볼 수 없고, 라이브러리 목록이 배경 라이브러리와 섞이거나 비어 있을 때 엉뚱한 항목이 선택되는지 확인할 것 (library/images vs library/backgrounds 분리 상태 점검).
- 선택 후 미리보기/렌더에 실제 반영되는 데이터 경로(imageId → 파일 경로 → data URL/file URL) 를 끝까지 추적해, 잘못된 id 해석·캐시 문제·기본 placeholder 노출이 있으면 수정.

### 목표 1 — 공용 이미지 피커 모달
- 새 컴포넌트 `ImagePickerModal`: **썸네일 그리드**(각 항목 실제 이미지 미리보기 + 파일명), [파일 추가](라이브러리 등록), [배경 제거](기존 removeImageBackground — 체커보드 미리보기 유지), 선택/선택 해제, 닫기.
- 적용처 3곳 통일: 배지 이미지, 넘김기호 이미지, 이미지 레이어 소스 선택.
- 선택된 이미지는 각 컨트롤 옆에 **작은 썸네일 미리보기**로 항상 표시(파일명만 X). "없음(해제)" 명시 버튼.
- 썸네일 데이터 URL은 main IPC에서 축소 JPEG(기존 getBackgroundPreview 패턴 재사용, 이미지 라이브러리용으로 일반화)로 제공, 렌더러 캐시.

### 목표 2 — 배지 텍스트 색 오버라이드
- 타입: CardBadgeOverride에 `textColor?: string` (#rrggbb, 기존 hex 검증 재사용).
- 렌더: cardTemplate 배지 텍스트 color를 override.textColor ?? preset.badgeInk로. data-background-color는 배지 배경 유지 → **대비 게이트가 자동 방어**(완화 금지).
- UI: 카드 [디자인] 탭 배지 섹션에 색 스와치(기존 accentSwatches) + 커스텀 hex 입력 + [스타일 기본값] 리셋.
- 영속화: overrides 저장/로드/프리셋/워크스페이스 왕복 + 관대한 가드.

### 스모크/테스트
- badge-background-removal-regression 갱신: 피커 모달 열림 → 썸네일 그리드 존재 → 선택 → 컨트롤 옆 썸네일 반영 → 렌더 HTML에 이미지 src 존재.
- next-hint-image-regression 갱신: 동일 피커 경로 + 마지막 카드 미표시 규칙 유지.
- 신규 단위 테스트: badge textColor가 템플릿 CSS에 반영 + 잘못된 색 거부.
