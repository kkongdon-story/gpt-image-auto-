# PRD: V6 M12 Lite/Pro Stable EXE Release Gates

## 1. Objective

Lite와 Pro를 각각 안정적인 Windows 배포 산출물로 만들기 위한 실행 계획을 고정한다. 목표는 EXE 생성 자체가 아니라, EXE 생성 전에 통과해야 할 기능 테스트, 디버깅, 보안, 에디션 분리, 패키지 smoke 게이트를 명확히 세우는 것이다.

이번 PRD가 승인되면 다음 실행 단계에서 이 문서와 테스트 스펙을 기준으로 Pro/Lite 산출물을 다시 만들고 검증한다.

## 2. Non-Goals

- 이번 계획 단계에서는 EXE를 생성하지 않는다.
- Lite/Pro 기능 매트릭스를 새로 바꾸지 않는다.
- 신규 기능을 추가하지 않는다. 단, 게이트 중 발견된 배포 차단 버그는 별도 수정 대상으로 분리한다.
- 코드 서명, 자동 업데이트, 실제 설치 프로그램 실행은 범위 밖이다. 설치 실행은 사용자 PC에 시스템 부작용을 만들 수 있으므로 별도 승인 후 수동 QA로 둔다.

## 3. Decision Drivers

1. OneDrive 경로의 `release/` 직접 빌드 실패 이력을 피해야 한다.
2. Lite에 Pro 기능이 섞이지 않았다는 증거가 패키지 내부까지 필요하다.
3. 최근 M9-M11에서 UI, 이미지, AI 흐름이 많이 바뀌었으므로 dev smoke뿐 아니라 실제 unpacked EXE smoke가 필요하다.
4. 최종 산출물은 사용자가 헷갈리지 않도록 Pro/Lite 설치 파일과 무설치 폴더를 분리해야 한다.
5. 실패하면 어느 게이트에서 실패했는지 바로 추적할 수 있도록 로그 위치와 명령이 고정되어야 한다.

## 4. Release Principles

- **Gate first**: 테스트와 보안 게이트가 모두 통과하기 전에는 `release/`를 갱신하지 않는다.
- **Isolated packaging**: Electron Builder 출력은 `%LOCALAPPDATA%`의 Pro/Lite 전용 폴더로 보낸다.
- **Copy after proof**: 로컬 패키지 검증이 끝난 뒤에만 프로젝트 `release/`로 복사한다.
- **Stage before replace**: `release/`의 기존 무설치 폴더는 새 폴더를 `.tmp`에 복사하고 검증한 뒤에만 교체한다.
- **Lite stripping is mandatory**: Lite는 `dist`, `dist-electron`, packaged `app.asar`, copied `release/`까지 네 단계로 검증한다.
- **Real EXE smoke**: 최종 판단은 dev Electron이 아니라 `win-unpacked`의 실제 EXE 실행 smoke를 포함한다.
- **Evidence over confidence**: 모든 게이트는 `.omc/evidence/v6/m12-lite-pro-exe-release/`에 로그를 남긴다.
- **Exit codes are evidence**: 모든 필수 명령은 stdout/stderr 로그와 함께 exit code, 시작/종료 시각, 명령 문자열을 남긴다.

## 5. Architecture Decision Record

### ADR-M12-1: Packaging Output Strategy

Chosen: `%LOCALAPPDATA%` isolated output per edition, then copy validated artifacts to project `release/`.

Rejected:
- Project `release/` direct build: OneDrive `EPERM`/`EBUSY` rename failure 이력이 있다.
- `npm run dist:win:pro` / `npm run dist:win:lite` direct scripts: 현재 설정상 shared `release/` output을 사용하므로 M12 공식 배포 경로로 쓰지 않는다.
- Single shared `release/win-unpacked`: Pro/Lite 중 마지막 빌드가 덮어써서 혼동을 만든다.
- Dev-only build: 설치 파일과 무설치 EXE 회귀를 증명하지 못한다.

### ADR-M12-2: Release Folder Layout

Chosen:

- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- `release/win-unpacked-pro-2.0.0/`
- `release/win-unpacked-lite-2.0.0/`

Rationale: 두 에디션을 동시에 보관할 수 있고 사용자가 실행 파일을 혼동하지 않는다.

### ADR-M12-3: AI Verification

Chosen: packaged Pro EXE에서는 mock AI smoke를 필수로 하고, 실제 Claude/Codex/Gemini CLI 로그인 상태는 manual QA로 둔다.

Rationale: 실제 CLI는 로그인, 네트워크, 권한 상태에 따라 흔들린다. 배포 차단 게이트는 deterministic해야 한다.

### ADR-M12-4: Final Workspace Build State

Chosen: 모든 패키징과 release 복사 검증이 끝난 뒤 `npm run build:pro`를 다시 실행해 로컬 `dist`/`dist-electron`을 Pro 기준으로 복원한다.

Rationale: 패키징 순서상 Lite build가 마지막이면 개발자가 다음 세션에서 Pro를 실행한다고 생각해도 Lite 산출물이 남을 수 있다. M11 종료 상태와 같이 최종 작업공간은 Pro 기준으로 둔다.

## 6. Milestones

### M12-1. Preflight and Evidence Setup

Acceptance:
- `.omc/evidence/v6/m12-lite-pro-exe-release/` 생성.
- 현재 branch/status 기록.
- 기존 `release/` 상태와 이전 산출물 목록 기록.
- 빌드 산출물 대상 폴더가 `%LOCALAPPDATA%` Pro/Lite로 분리됨.
- 명령 실행 로그 형식이 command/start/end/exitCode/logPath를 기록하도록 준비됨.
- `rg` no-match, `npm audit` non-zero처럼 검토형 명령의 허용 exit code가 테스트 스펙에 명시됨.

Exit condition:
- 이후 게이트 실패 시 원인 추적에 필요한 baseline evidence가 있다.

### M12-2. Source Quality Gate

Acceptance:
- `npm run typecheck` 통과.
- `npm test` 통과.
- `git diff --check` 통과 또는 CRLF 경고만 명시.
- 보안 관련 targeted tests가 기존 suite에 포함되어 통과.

Exit condition:
- source-level 회귀가 없는 상태에서 edition build로 넘어간다.

### M12-3. Edition Separation Gate

Acceptance:
- `npm run build:lite` 통과.
- `node scripts/verify-edition.mjs --edition lite` 통과.
- Lite smoke:
  - `edition-lite-regression`
  - `edition-lite-basic-flow`
- `npm run build:pro`로 로컬 산출물을 Pro 기준으로 복원.
- Pro smoke:
  - `content-title-whitespace-regression`
  - `inspector-design-scroll-regression`
  - `image-picker-library-hygiene-regression`
  - `badge-background-removal-regression`
  - `next-hint-image-regression`
  - `chrome-style-regression`
  - `ai-provider-detection-regression`
  - `ai-raw-chat-regression`
  - `ai-timeout-progress-regression`
  - `ai-draft-regression`

Exit condition:
- Lite/Pro source artifacts와 핵심 기능 smoke가 모두 통과한다.

### M12-4. Debugging and Security Gate

Acceptance:
- `npm audit --omit=dev` 결과 기록. high 이상 취약점이 있으면 차단 또는 명시적 risk accept 필요.
- `@electron/asar` import 의존성 확인. 직접 dependency/devDependency가 아니면 transitive 사용 사실과 release risk를 명시하거나 후속 수정으로 승격한다.
- secret/token 문자열 검색 결과 기록. false positive는 allowlist로 문서화.
- IPC exposure audit: Lite preload/main에 Pro IPC가 없는지 확인.
- external open/path handling audit: 사용자 입력 path/url 처리가 기존 보안 기준을 유지하는지 확인.
- AI command audit: provider command allowlist, stdin prompt 전달, shell injection 방어가 유지되는지 확인하고 `ai-provider-command-regression` smoke를 통과시킨다.
- debugging audit: 최근 사용자 신고 영역별 가설, 재현 smoke, 결과를 기록.

Exit condition:
- 배포 차단 보안/디버깅 이슈가 없거나, 남은 이슈가 EXE 배포를 막지 않는다고 문서화되어 있다.

### M12-5. Isolated Package Build

Acceptance:
- Pro package build succeeds in `%LOCALAPPDATA%\cardnews-release-pro-m12`.
- Lite package build succeeds in `%LOCALAPPDATA%\cardnews-release-lite-m12`.
- 두 폴더 모두 installer와 `win-unpacked`를 가진다.
- Lite packaged artifact scan passes:
  - `%LOCALAPPDATA%\cardnews-release-lite-m12\win-unpacked\resources\app.asar`
  - `%LOCALAPPDATA%\cardnews-release-lite-m12\win-unpacked`

Exit condition:
- `release/`에 복사하기 전 로컬 패키지가 독립적으로 검증된다.

### M12-6. Packaged EXE Smoke Gate

Acceptance:
- Pro unpacked EXE smoke:
  - `ai-draft-regression` with mock AI
  - `ai-provider-detection-regression`
  - `image-picker-library-hygiene-regression`
  - `chrome-style-regression`
- Lite unpacked EXE smoke:
  - `edition-lite-regression`
  - `edition-lite-basic-flow`
- Electron/Chromium cache or GPU warning은 exit 0과 `PASS`가 있으면 non-blocking으로 기록한다.

Exit condition:
- 실제 EXE 실행 기준으로 Pro/Lite 핵심 회귀가 없다.

### M12-7. Release Copy and Final Verification

Acceptance:
- 검증된 `%LOCALAPPDATA%` 산출물을 project `release/`로 복사한다.
- copied release Lite package scan 통과.
- copied release Pro/Lite EXE smoke 통과.
- installer와 unpacked EXE의 size, SHA256, last modified 기록.
- release unpacked folder는 `.tmp` staging copy 검증 후 final path로 교체한다.
- `npm run build:pro`를 다시 실행해 작업공간 build artifact를 Pro 기준으로 복원한다.
- `HANDOFF.md`에 append-only 방식으로 M12 결과, 산출물 위치, 증거 위치, 잔여 리스크 기록.

Exit condition:
- 사용자가 실행할 최종 Lite/Pro 설치 파일과 무설치 EXE 위치가 명확하다.

## 7. Stop/Block Rules

다음 중 하나라도 발생하면 EXE 배포 산출물 갱신을 중단한다.

- `typecheck`, `test`, 또는 mandatory smoke 실패.
- Lite `verify-edition` 실패.
- packaged Lite `app.asar`에서 Pro-only symbol 발견.
- high 이상 production dependency 취약점이 확인되고 mitigation 또는 risk accept가 없다.
- Pro/Lite productName, appId, installer artifactName이 혼동되는 상태.
- 실제 unpacked EXE가 smoke action을 시작하지 못함.
- 필수 명령의 exit code를 증거로 복원할 수 없음.

## 8. Manual QA Checklist

자동 게이트 통과 후 사용자가 직접 확인할 항목:

1. Pro EXE 실행 후 AI 팝업에서 Claude/Codex/Gemini provider 표시와 실제 응답 확인.
2. Pro에서 이미지 선택, 배지, 넘김 기호, 배경 제거 슬라이더 동작 확인.
3. Pro에서 제목/소제목 입력 시 띄어쓰기와 줄바꿈 즉시 반영 확인.
4. Lite EXE에서 Pro 전용 버튼이 잠김/비활성/안내 상태인지 확인.
5. Lite에서 기본 카드 작성과 PNG 생성이 가능하고, Pro AI/CSV/project/background removal이 실행되지 않는지 확인.
6. 설치 프로그램은 필요 시 별도 승인 후 실행한다.

## 9. Handoff Requirements

M12 실행 완료 후 `HANDOFF.md`에 다음을 남긴다.

- 실행한 명령과 로그 파일 목록.
- 최종 산출물 절대 경로.
- SHA256과 파일 크기.
- Lite stripping 결과.
- Pro/Lite packaged smoke 결과.
- 보안 점검 결과와 known residual risk.
- 다음 세션이 처음 확인할 일.
