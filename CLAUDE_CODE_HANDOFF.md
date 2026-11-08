# Claude Code Handoff: Cardnews Studio V6 Lite/Pro

작성일: 2026-07-08  
프로젝트 루트: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`  
기준 문서: `.omc/plans/v6-lite-pro-prd.md`  
진행 로그 SSOT: `HANDOFF.md`

## 1. 현재 상태 요약

V6 Lite/Pro 업그레이드는 M1부터 M5까지 순서대로 구현 및 커밋 완료된 상태다.

최근 마일스톤 커밋:

```text
3e97b61 Ship v2 release only after security evidence closes
bfa18ab Add Pro AI drafting without weakening Lite binaries
2f85e02 Separate distributable editions before Pro-only AI work
8e15c6a Make M2 editing assets render through one path
3271dae Keep M1 editor geometry and chrome controls deterministic
```

패키지 버전:

```text
package.json       2.0.0
package-lock.json  2.0.0
```

현재 `git status --short` 기준으로 커밋 대상 변경은 없고, `.omx/` 런타임 폴더만 untracked로 남아 있다.

## 2. 최종 산출물

사용자에게 전달할 실제 실행 대상은 `2.0.0` 산출물이다. 기존 v1 파일은 비교용으로 남아 있을 수 있으니 최종 대상과 혼동하지 말 것.

```text
release/Cardnews-Studio-Pro-Setup-2.0.0.exe
release/Cardnews-Studio-Lite-Setup-2.0.0.exe
release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe
release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe
```

현재 확인된 크기:

```text
release/Cardnews-Studio-Lite-Setup-2.0.0.exe                 106359082 bytes
release/Cardnews-Studio-Pro-Setup-2.0.0.exe                  106412648 bytes
release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe     235706368 bytes
release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe       235706368 bytes
```

## 3. 사용자가 원한 핵심 요구

`.omc/plans/v6-lite-pro-prd.md` 기준으로 다음 원칙을 지켜 구현했다.

- 미리보기와 PNG는 같은 `buildCardHtml()` 렌더 계약을 사용한다.
- hard-fail gate를 완화하지 않는다.
- `styleSafety.ts` allowlist를 느슨하게 풀지 않는다.
- v5 workspace/preset/deck/.cardnews는 optional 필드와 관대한 가드로 유지한다.
- `footerAccount`는 내부 경계에서 `kkongdon_story` 형태를 유지한다.
- Lite/Pro 기능 매트릭스는 변경하지 않는다.
- 애매한 신규 기능은 Pro 전용으로 둔다.
- Lite 바이너리에는 Pro 기능 코드가 물리적으로 남지 않아야 한다.
- `verify-edition.mjs` 스트리핑 검증은 완료 조건이다.

## 4. 큰 코드 구조

### 4.1 Domain

주요 파일:

```text
src/domain/types.ts
src/domain/cardnews-api.ts
src/domain/cardParser.ts
src/domain/deckImporter.ts
src/domain/chromeConfig.ts
src/domain/lineLayer.ts
src/domain/csvBulk.ts
```

역할:

- `types.ts`: Deck/Card/Layer/Chrome/Edition/AI 타입의 중심.
- `cardnews-api.ts`: Lite/Pro preload API 표면 분리. Lite에는 Pro 메서드가 없다.
- `cardParser.ts`: 라벨 문법과 명시적 줄바꿈 직렬화.
- `deckImporter.ts`: `양식.md` 문서 파싱. AI 초안도 이 경로만 통과한다.
- `chromeConfig.ts`: 헤더/푸터/페이지번호 chrome 설정 정규화.
- `lineLayer.ts`: 선 레이어 endpoint 모델과 legacy rect/rotation 마이그레이션.

### 4.2 Rendering

주요 파일:

```text
src/render-engine/cardTemplate.ts
src/render-engine/stylePresets.ts
src/render-engine/customStyles.ts
src/render-engine/styleSafety.ts
src/render-engine/backgroundRemoval.ts
src/render-engine/gates/*
```

역할:

- `cardTemplate.ts`: 미리보기와 PNG의 단일 HTML 렌더 경로.
- `styleSafety.ts`: 커스텀 스타일 allowlist와 CSS 값 안전성 검사.
- `customStyles.ts`: JSON/design.md 스타일 파싱 후 `styleSafety` 통과 여부 확인.
- `backgroundRemoval.ts`: 배지 이미지 단색 배경 제거 순수 모듈.
- `gates/*`: contrast, overflow, font floor, visual artifact 등 품질 gate.

중요:

- preview-only 렌더 경로를 만들면 안 된다.
- `cardTemplate.ts`에서 사용자 문자열은 `escapeHtml()` 또는 `escapeAttribute()` 경유가 원칙이다.
- M5에서 pageNumber template과 image id raw markup 방지 테스트를 추가했다.

### 4.3 UI

주요 파일:

```text
src/ui/App.tsx
src/ui/LiteApp.tsx
src/ui/styles.css
```

역할:

- `App.tsx`: Pro UI. 레이어 편집, 콘텐츠 폼, chrome 스타일, 배지 확장, next hint, CSV, 프로젝트 파일, AI 패널 포함.
- `LiteApp.tsx`: Lite UI. 공통 카드뉴스 제작 기능과 잠금 패널만 제공.
- `styles.css`: Pro/Lite 공통 스타일. AI panel, badge controls, overlay controls 등이 포함되어 있다.

Pro 전용 UI 대표 기능:

- 직접 편집 overlay
- 텍스트/도형/선/이미지 레이어
- 카드별 색감/레이아웃 override
- chrome style controls
- image badge + background removal
- next hint image
- CSV bulk
- `.cardnews` project export/import
- AI panel

Lite UI 대표 기능:

- 스타일/배경/양식/폰트/PNG/ZIP 기본 제작
- Pro 기능은 잠금 표시
- Threads/Kakao 문의 링크

### 4.4 Electron Main/Preload

주요 파일:

```text
electron/main.ts
electron/lite-main.ts
electron/preload.cts
electron/preload-lite.cts
electron/ai/cliAdapters.ts
```

역할:

- `main.ts`: Pro main process. Pro IPC 전체 포함.
- `lite-main.ts`: Lite main process. Pro IPC import/등록 없음.
- `preload.cts`: Pro preload API.
- `preload-lite.cts`: Lite preload API.
- `electron/ai/cliAdapters.ts`: Pro 전용 Claude/Codex/Gemini CLI adapter.

AI 보안 원칙:

- provider id는 `claude`, `codex`, `gemini` allowlist만 허용.
- 사용자 prompt를 shell argument로 넣지 않고 stdin으로만 전달한다.
- AI 출력은 실행하지 않는다.
- 카드 적용은 `parseDeckDocument()` 성공 시에만 한다.
- CLI 실제 로그인/네트워크는 환경 의존이라 최종 QA는 `CARDNEWS_MOCK_AI=1`로 deterministic smoke를 돌렸다.

### 4.5 Edition Build

주요 파일:

```text
scripts/build-edition.mjs
scripts/verify-edition.mjs
vite.config.ts
electron-builder.pro.json
electron-builder.lite.json
```

역할:

- `build-edition.mjs pro`: Pro renderer/main/preload를 빌드한다.
- `build-edition.mjs lite`: Lite renderer/main/preload만 남기도록 빌드 산출물을 재구성한다.
- `verify-edition.mjs`: Lite 산출물에 Pro-only 심볼이 남았는지 스캔한다.
- `electron-builder.pro.json`: Pro appId/productName/artifactName.
- `electron-builder.lite.json`: Lite appId/productName/artifactName.

중요:

- Lite는 단순 비활성화가 아니라 Pro 코드 부재가 목표다.
- AI, CSV bulk, remove background, project export/import, ProPanels 등은 Lite 금지 심볼 목록에 있다.

## 5. 마일스톤별 작업 내용

### M1: 선 endpoint + chrome style

핵심 변경:

- 선 레이어를 rect+rotation에서 `x1/y1/x2/y2/thickness` endpoint 모델로 전환.
- legacy 선 마이그레이션 추가.
- 선 선택/이동/끝점 조절/각도 입력 구현.
- 헤더/멘션/페이지번호 chrome 설정 모델 추가.
- 페이지번호 template, 색, 크기, 굵기, 위치, 표시 여부 UI 연결.

주요 smoke:

```text
line-endpoint-regression
chrome-style-regression
layer-controls-regression
style-matrix-smoke.mjs
```

### M2: 콘텐츠 폼 + 배지/배경제거 + next hint

핵심 변경:

- 콘텐츠 탭을 구조화 폼으로 승격.
- `|` 기반 명시적 줄바꿈 문법 추가. `\|`는 literal pipe.
- typography override에 letterSpacing, lineHeight, scope 추가.
- 배지 모양과 이미지 배지 지원.
- 이미지 라이브러리와 단색 배경 제거 추가.
- next hint를 기본 화살표/이미지/없음으로 확장.

주요 smoke:

```text
content-form-regression
badge-background-removal-regression
next-hint-image-regression
```

### M3: Lite/Pro edition 분리

핵심 변경:

- `ProCardnewsApi` / `LiteCardnewsApi` 분리.
- Pro renderer는 `App.tsx`, Lite renderer는 `LiteApp.tsx`.
- Lite main은 `electron/lite-main.ts`.
- Lite preload는 Pro API를 노출하지 않는다.
- Lite 저장/렌더 경계에서 Pro-only 필드 strip.
- Pro/Lite builder config 분리.
- `verify-edition.mjs` 추가.

주의:

- PRD는 이상적으로 `@edition` alias 구조를 제안했지만, 현재 구현은 실제 빌드 스크립트와 별도 entry 중심으로 Lite/Pro를 분리한다.
- 검증은 Lite packaged `app.asar`와 `win-unpacked` 스캔으로 수행했다.

### M4: Pro AI

핵심 변경:

- Pro API에만 `listAiProviders()` / `runAiChat()` 추가.
- Lite API/preload/main에는 AI IPC 없음.
- `electron/ai/cliAdapters.ts` 추가.
- `src/edition/pro/ai/aiPrompts.ts` 추가.
- Pro UI 내보내기 탭에 AI 패널 추가.
- mock AI draft smoke 추가.

디버깅 이력:

- NodeNext include/import extension 문제 해결.
- AI panel smoke 클릭 타이밍 문제 해결.
- `shell: true` + args 배열 경고 제거. provider별 고정 command string + stdin 전달로 변경.

### M5: 보안 + 2.0.0 release

핵심 변경:

- `package.json` / `package-lock.json` 버전 `2.0.0`.
- pageNumber template escape 테스트 추가.
- malicious image id raw markup 방지 테스트 추가.
- 코드/스크립트형 AI output이 deck 문서로 승인되지 않는 테스트 추가.
- M5 보안 체크리스트 증거 작성.
- Pro/Lite NSIS와 unpacked release 산출물 생성.

## 6. 검증 명령

일반 표준 검증:

```bash
npm run typecheck
npm test
npm run build
```

V6 전체 주요 smoke:

```bash
node node_modules/electron/cli.js scripts/style-matrix-smoke.mjs
CARDNEWS_SMOKE_ACTION=layer-controls-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=line-endpoint-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=chrome-style-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=content-form-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=badge-background-removal-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=next-hint-image-regression node node_modules/electron/cli.js .
CARDNEWS_SMOKE_ACTION=ai-draft-regression CARDNEWS_MOCK_AI=1 node node_modules/electron/cli.js .
```

Lite build and strip verification:

```bash
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
CARDNEWS_SMOKE_ACTION=edition-lite-regression node node_modules/electron/cli.js .
```

Release package verification:

```bash
node scripts/verify-edition.mjs --edition lite --scan "release/win-unpacked-lite-2.0.0/resources/app.asar" "release/win-unpacked-lite-2.0.0"
CARDNEWS_SMOKE_ACTION=ai-draft-regression CARDNEWS_MOCK_AI=1 "release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe"
CARDNEWS_SMOKE_ACTION=edition-lite-regression "release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe"
```

Security checks used for M5:

```bash
npm audit --audit-level=high
npx vitest run src/render-engine/cardTemplate.test.ts src/edition/pro/ai/aiPrompts.test.ts
```

## 7. Evidence 위치

V6 evidence root:

```text
.omc/evidence/v6/
```

가장 중요한 최종 evidence:

```text
.omc/evidence/v6/security/checklist.md
.omc/evidence/v6/security/final-typecheck.log
.omc/evidence/v6/security/final-test.log
.omc/evidence/v6/security/final-build-pro.log
.omc/evidence/v6/security/final-build-lite.log
.omc/evidence/v6/security/verify-edition-lite-package.log
.omc/evidence/v6/security/manual-asar-grep-lite.log
.omc/evidence/v6/security/verify-edition-release-lite.log
.omc/evidence/v6/security/smoke-release-pro-exe-ai-draft.log
.omc/evidence/v6/security/smoke-release-lite-exe-edition.log
```

최종 테스트 로그 기준:

```text
14 test files passed
89 tests passed
```

## 8. 패키징 방식과 주의점

OneDrive 아래에서 `electron-builder`가 `win-unpacked.tmp -> win-unpacked` rename 중 `EPERM`을 낼 수 있다. PRD §0.3에 따라 `%LOCALAPPDATA%` 아래로 출력 폴더를 바꿔 빌드한 뒤 `release/`로 복사했다.

사용한 방식:

```bash
npx electron-builder --win nsis -c electron-builder.pro.json -c.directories.output="C:/Users/js480/AppData/Local/cardnews-release-v6-m5-pro"
npx electron-builder --win nsis -c electron-builder.lite.json -c.directories.output="C:/Users/js480/AppData/Local/cardnews-release-v6-m5-lite"
```

그 뒤 복사:

```text
C:/Users/js480/AppData/Local/cardnews-release-v6-m5-pro/Cardnews-Studio-Pro-Setup-2.0.0.exe
-> release/Cardnews-Studio-Pro-Setup-2.0.0.exe

C:/Users/js480/AppData/Local/cardnews-release-v6-m5-lite/Cardnews-Studio-Lite-Setup-2.0.0.exe
-> release/Cardnews-Studio-Lite-Setup-2.0.0.exe

C:/Users/js480/AppData/Local/cardnews-release-v6-m5-pro/win-unpacked
-> release/win-unpacked-pro-2.0.0

C:/Users/js480/AppData/Local/cardnews-release-v6-m5-lite/win-unpacked
-> release/win-unpacked-lite-2.0.0
```

## 9. Review/개선 시 우선 볼 곳

### 9.1 Lite/Pro 경계

먼저 확인할 파일:

```text
src/domain/cardnews-api.ts
electron/preload.cts
electron/preload-lite.cts
electron/main.ts
electron/lite-main.ts
scripts/build-edition.mjs
scripts/verify-edition.mjs
```

확인할 것:

- Lite preload에 Pro method name이 없는가.
- Lite main에 Pro IPC가 등록되지 않는가.
- Lite packaged asar에 Pro-only symbol이 없는가.
- 신규 기능이 애매하면 Pro 전용으로 들어갔는가.

### 9.2 AI 경계

먼저 확인할 파일:

```text
electron/ai/cliAdapters.ts
src/edition/pro/ai/aiPrompts.ts
src/edition/pro/ai/aiPrompts.test.ts
src/ui/App.tsx
electron/main.ts
```

확인할 것:

- prompt가 argv가 아니라 stdin으로 전달되는가.
- provider id가 allowlist인지.
- AI output이 실행되지 않는가.
- deck 적용이 `parseDeckDocument()` 성공 후에만 되는가.
- Lite build에 AI IPC/adapter/UI가 남지 않는가.

### 9.3 단일 렌더 계약

먼저 확인할 파일:

```text
src/render-engine/cardTemplate.ts
electron/main.ts
src/ui/App.tsx
src/ui/LiteApp.tsx
```

확인할 것:

- preview와 PNG가 같은 HTML 계약을 쓰는가.
- UI-only preview hack이 생기지 않았는가.
- text/line/shape/image layer가 저장 -> preview -> PNG까지 같은 데이터로 이어지는가.

### 9.4 보안 테스트

먼저 확인할 파일:

```text
src/render-engine/cardTemplate.test.ts
src/edition/pro/ai/aiPrompts.test.ts
src/render-engine/customStyles.test.ts
scripts/verify-edition.mjs
```

확인할 것:

- pageNumber template raw HTML escape 테스트가 유지되는가.
- malicious image id가 raw markup으로 렌더되지 않는가.
- AI prompt injection 형태가 deck 문서로 승인되지 않는가.
- styleSafety allowlist가 완화되지 않았는가.

## 10. 남은 리스크

1. 실제 로그인된 Claude/Codex/Gemini CLI 왕복은 환경 의존이라 mock AI로 최종 검증했다. 실제 CLI가 설치/로그인된 PC에서는 Pro AI 패널에서 provider 상태와 대본 작성 왕복을 별도 확인하면 좋다.
2. 기존 v1 산출물과 `release/win-unpacked.tmp`가 남아 있을 수 있다. 최종 사용자 전달 대상은 `2.0.0` 파일이다.
3. Lite/Pro 분리는 자동 verifier로 확인했지만, 새 Pro 기능을 추가하면 반드시 `scripts/verify-edition.mjs` 금지 심볼 목록도 같이 갱신해야 한다.
4. `HANDOFF.md`는 상세 로그이고 이 문서는 빠른 인수인계용이다. Claude Code가 더 깊게 추적할 때는 `HANDOFF.md`의 `6-10`부터 `6-14`를 읽으면 된다.

## 11. Claude Code에게 권장하는 첫 작업 순서

1. `git status --short`로 변경 상태 확인.
2. `HANDOFF.md`의 `6-10`부터 `6-14`까지 읽기.
3. `.omc/plans/v6-lite-pro-prd.md`의 §0, §1, §7, §8, §9 재확인.
4. 다음 검증 실행:

```bash
npm run typecheck
npm test
npm run build
node scripts/verify-edition.mjs --edition lite --scan "release/win-unpacked-lite-2.0.0/resources/app.asar" "release/win-unpacked-lite-2.0.0"
CARDNEWS_SMOKE_ACTION=ai-draft-regression CARDNEWS_MOCK_AI=1 "release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe"
CARDNEWS_SMOKE_ACTION=edition-lite-regression "release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe"
```

5. UI 개선이나 버그 수정이 들어가면 해당 smoke를 새로 추가하거나 기존 smoke에 반영.

## 12. 사용자에게 설명할 때의 핵심 문장

```text
Cardnews Studio는 이제 Lite/Pro가 분리되어 있고, Lite에는 Pro 기능 코드가 검증 기준으로 남지 않습니다.
Pro는 레이어 편집, 배지/넘김기호, CSV, 프로젝트 파일, AI 대본 작성까지 포함합니다.
최종 배포 대상은 release 폴더의 2.0.0 Pro/Lite 설치파일과 무설치 실행파일입니다.
```
