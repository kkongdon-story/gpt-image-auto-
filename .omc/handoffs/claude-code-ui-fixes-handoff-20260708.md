# Claude Code Handoff - Cardnews Studio V5 UI Follow-up

작성일: 2026-07-08  
프로젝트 루트: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

## 1. 한 줄 요약

사용자가 보고한 V5 UI 문제 4개를 수정했고, 검증 중 발견된 보안/경계 정규화 차단 이슈까지 함께 해결했다. 현재 소스, 테스트, 빌드, Electron 스모크는 통과했지만, 설치용 `release/Cardnews-Studio-Setup-1.0.0.exe` 재패키징은 이번 작업에서 수행하지 않았다.

## 2. 사용자 요청

최신 요청의 실제 목표:

1. 사이드 패널 카드 썸네일이 가운데 정렬되지 않는다.
2. 선 레이어 각도를 바꾸면 리사이즈/선택 박스가 이상하다.
3. 첨부 이미지처럼 헤더/디자인/스타일 종류를 다양화하고 싶다.
4. Threads는 아이디 텍스트가 아니라 `@` 로고/버튼으로 표시하되, 멘션 기본값은 `kkongdon_story`여야 한다.

추가로 리뷰 중 발견되어 같이 처리한 차단 이슈:

1. 커스텀 스타일 JSON의 CSS 문자열이 `srcDoc` HTML 안의 `<style>`을 탈출해 스크립트 삽입으로 이어질 수 있음.
2. 미리보기에서는 멘션이 정규화되지만 저장/렌더 경계에서 raw `@` 또는 `@kkongdon_story`가 남을 수 있음.

## 3. 현재 작업트리 상태

아직 커밋하지 않은 수정 파일:

```text
M electron/main.ts
M src/domain/types.ts
M src/render-engine/cardTemplate.test.ts
M src/render-engine/cardTemplate.ts
M src/render-engine/customStyles.test.ts
M src/render-engine/customStyles.ts
M src/render-engine/stylePresets.ts
M src/storage/deckStore.test.ts
M src/storage/deckStore.ts
M src/storage/projectArchive.ts
M src/ui/App.tsx
M src/ui/styles.css
?? src/render-engine/styleSafety.ts
```

주의: `src/domain/types.ts`, `src/render-engine/cardTemplate.ts`, `src/render-engine/cardTemplate.test.ts` 일부 변경은 이전 V5 작업 흐름에서 이미 진행된 수정과 섞여 있다. 무조건 되돌리지 말고 현재 diff를 기준으로 검토할 것.

## 4. 구현 내용

### 4.1 좌측 썸네일 중앙 정렬

파일:

- `src/ui/styles.css`

핵심:

- `.slide-thumb`를 가로 flex 느낌에서 centered grid로 정리했다.
- `.thumb-canvas`에 `justify-self: center`, `margin-inline: auto`를 적용했다.
- smoke evidence에서 `thumbnailCenterDelta: 0` 확인.

### 4.2 회전 선 레이어 리사이즈 안정화

파일:

- `src/ui/App.tsx`
- `src/render-engine/cardTemplate.ts`
- `electron/main.ts`

핵심:

- 실제 iframe/card 렌더의 line layer에는 `transform: rotate(90deg)`가 유지된다.
- 편집 오버레이의 선택/리사이즈 박스는 회전시키지 않는다.
- smoke evidence:
  - `lineOverlayTransform: "none"`
  - `lineStyleAttribute`에 `transform: rotate(90deg)` 포함.

### 4.3 스타일 프리셋 다양화

파일:

- `src/render-engine/stylePresets.ts`

추가한 프리셋:

- `warmstudio` - `웜 스튜디오 (사진)`
- `boldyellow` - `볼드 옐로우 캐러셀 (사진)`
- `orangecards` - `오렌지 체크 카드`
- `bluecheck` - `블루 체크 리스트`
- `soloops` - `솔로프리너 블랙 (사진)`

smoke evidence에서 `missingStyleNames: []` 확인.

### 4.4 Threads 버튼과 멘션 기본값 분리

파일:

- `src/ui/App.tsx`
- `src/storage/deckStore.ts`
- `src/storage/deckStore.test.ts`
- `electron/main.ts`

핵심:

- 상단 Threads 버튼은 `@`로 보이게 유지.
- 멘션 input 기본값은 `kkongdon_story`.
- `@`, `@kkongdon_story`, 빈 값 모두 저장/렌더 경계에서 `kkongdon_story`로 정규화.
- 저장된 deck 파일도 `footerAccount: "kkongdon_story"`로 확인.

관련 코드 포인트:

- `src/ui/App.tsx`의 `defaultFooterAccount`, `normalizeFooterAccount`
- `src/storage/deckStore.ts`의 `normalizeFooterAccount`
- `src/storage/deckStore.test.ts`의 boundary regression test

### 4.5 커스텀 스타일 CSS 보안 방어

파일:

- `src/render-engine/styleSafety.ts` 새 파일
- `src/render-engine/customStyles.ts`
- `src/render-engine/customStyles.test.ts`
- `src/storage/deckStore.ts`
- `src/storage/projectArchive.ts`
- `electron/main.ts`
- `src/ui/App.tsx`

핵심:

- `isSafeStylePresetRecord` / `validateStylePresetSafety` 추가.
- `</style>`, `<script>`, `javascript:`, `expression(`, `@import`, `url(`, control chars, `<`, `>`, `;`, `{}`, backslash 등을 사용자 스타일 CSS 필드에서 차단.
- background/color/font/radius/scrim stop별 허용 문법을 제한.
- `parseStyleJson`, 저장소 custom style guard, 프로젝트 import guard, Electron IPC guard가 모두 같은 safety validator를 사용.
- preview iframe에는 `sandbox="allow-same-origin"`을 추가했고 `allow-scripts`는 주지 않았다.
- 오프스크린 PNG 렌더는 내부 메트릭 스크립트가 필요하므로, 여기서는 style validator가 핵심 방어선이다.

## 5. 검증 결과

마지막으로 통과한 명령:

```powershell
npm run typecheck
npm test
npm run build
```

결과:

- `npm run typecheck` 통과
- `npm test` 통과: 10 files / 68 tests
- `npm run build` 통과

Electron smoke:

```powershell
$env:CARDNEWS_SMOKE_ACTION='layer-controls-regression'
$env:CARDNEWS_SMOKE_SCREENSHOT='.omc/evidence/v5/latest-layer-controls-green.png'
$env:CARDNEWS_SMOKE_TEXT='.omc/evidence/v5/latest-layer-controls-green.txt'
node node_modules/electron/cli.js .
```

결과:

- exit code 0
- Chromium GPU/cache 관련 stderr warning은 있었으나 smoke 자체는 통과.

핵심 evidence:

- `.omc/evidence/v5/latest-layer-controls-green.txt`
- `.omc/evidence/v5/latest-layer-controls-green.png`

최신 smoke text의 핵심 값:

```json
{
  "thumbnailCenterDelta": 0,
  "threadsLinkText": "@",
  "defaultMentionValue": "kkongdon_story",
  "normalizedPreviewFooter": "kkongdon_story",
  "lineOverlayTransform": "none",
  "lineRotationInputValue": "90",
  "missingStyleNames": [],
  "textStyle": {
    "footerText": "kkongdon_story",
    "fontSize": "80px",
    "fontWeight": "950",
    "textAlign": "right"
  }
}
```

저장 deck 직접 확인:

```powershell
$deckPath = Join-Path $env:APPDATA 'gpt-cardnews-auto\gpt-cardnews-auto\decks\current\deck.json'
(Get-Content $deckPath -Raw | ConvertFrom-Json).footerAccount
```

결과:

```text
kkongdon_story
```

## 6. 리뷰 결과

진행 중 코드 리뷰/보안 리뷰에서 한 차례 FAIL이 있었고, 모두 수정 후 PASS를 받았다.

### 6.1 보안 리뷰

처음 FAIL:

- custom style CSS가 `srcDoc` HTML `<style>`을 탈출할 수 있다는 HIGH 이슈.

수정 후 PASS:

- `styleSafety.ts` validator 도입.
- `parseStyleJson`, `deckStore`, `projectArchive`, `electron/main.ts`에서 같은 guard 사용.
- preview iframe sandbox 적용.

### 6.2 코드 품질 리뷰

처음 FAIL:

- preview만 멘션 정규화되고 저장/렌더 경계에서는 raw footer가 남을 수 있음.
- 추가 FAIL: `deckStore.ts` fallback이 `@kkongdon_story`로 남아 있었음.

수정 후 PASS:

- `buildDeckFromDraft`와 stored deck parse 단계에서 모두 `kkongdon_story`로 정규화.
- UI save/workspace/preset boundary도 같은 정규화 사용.
- `deckStore.test.ts`에 blank / `@` / `@kkongdon_story` / `kkongdon_story` 회귀 테스트 추가.

## 7. 재현 및 실행 방법

개발 실행:

```powershell
cd "C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto"
npm run dev
```

검증:

```powershell
npm run typecheck
npm test
npm run build
```

Electron smoke:

```powershell
$env:CARDNEWS_SMOKE_ACTION='layer-controls-regression'
$env:CARDNEWS_SMOKE_SCREENSHOT='.omc/evidence/v5/latest-layer-controls-green.png'
$env:CARDNEWS_SMOKE_TEXT='.omc/evidence/v5/latest-layer-controls-green.txt'
node node_modules/electron/cli.js .
```

패키징이 필요하면:

```powershell
npm run dist:win
```

예상 산출물:

- `release/Cardnews-Studio-Setup-1.0.0.exe`
- `release/win-unpacked/Cardnews Studio.exe`

주의: 이번 세션에서는 `dist:win` 재패키징을 수행하지 않았다. 클로드가 릴리즈 exe까지 갱신해야 한다면 위 명령을 실행하고 설치 파일/무설치 실행 파일을 직접 실행해 smoke/manual QA를 해야 한다.

## 8. 남은 리스크와 다음 권장 작업

1. `scripts/style-matrix-smoke.mjs`는 보조 광범위 검증으로 실행했으나, 기존 임의 테스트 레이어가 새 스타일 위에서 겹침/대비 실패를 만들며 오래 돌거나 실패한다. 이번 요구사항의 acceptance gate로 사용하지 않았다.
2. 설치용 exe는 아직 재생성하지 않았다. 사용자에게 배포하려면 `npm run dist:win` 후 아래 둘을 다시 확인해야 한다.
   - `release/Cardnews-Studio-Setup-1.0.0.exe`
   - `release/win-unpacked/Cardnews Studio.exe`
3. working tree에 이전 V5 작업의 수정도 함께 남아 있으므로, 커밋 전에는 `git diff`를 파일별로 다시 리뷰해야 한다.
4. custom style safety validator는 의도적으로 보수적이다. AI가 만든 JSON에서 복잡한 CSS 값을 허용하고 싶다면, `styleSafety.ts`에서 문법 단위를 명시적으로 확장해야 한다. raw string 허용으로 되돌리면 안 된다.

## 9. 클로드 코드에게 요청할 추천 프롬프트

```text
프로젝트 루트:
C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

먼저 .omc/handoffs/claude-code-ui-fixes-handoff-20260708.md를 읽고 현재 수정 상태를 감사해줘.
그 다음 git diff를 파일별로 검토하고, 아래를 순서대로 수행해줘.

1. npm run typecheck, npm test, npm run build 재실행
2. CARDNEWS_SMOKE_ACTION=layer-controls-regression Electron smoke 재실행
3. release 산출물 갱신이 필요하면 npm run dist:win 실행
4. release/Cardnews-Studio-Setup-1.0.0.exe 와 release/win-unpacked/Cardnews Studio.exe 직접 실행/smoke QA
5. 문제 없으면 Lore commit protocol에 맞춰 커밋 메시지 작성

주의:
- 커스텀 스타일 CSS 안전성 검사는 완화하지 말 것.
- Threads 버튼은 @ 로고/버튼이고, 멘션/저장 footer는 kkongdon_story가 맞다.
- 기존 수정 파일을 무단 revert하지 말 것.
```
