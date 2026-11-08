# Context Snapshot: Lite/Pro EXE Release Gates

Date: 2026-07-09
Mode: ralplan
Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

## User Goal

Lite 버전과 Pro 버전을 안정적인 Windows EXE 산출물로 다시 만들기 전에 기능 테스트, 점검 게이트, 디버깅, 보안 점검을 포함한 실행 계획을 세운다.

## Current Grounding

- `package.json` version is `2.0.0`.
- Build scripts:
  - `npm run build:pro` -> `node scripts/build-edition.mjs pro`
  - `npm run build:lite` -> `node scripts/build-edition.mjs lite`
  - `npm run dist:win:pro` and `npm run dist:win:lite` build NSIS installers.
- Electron Builder configs:
  - Pro: `electron-builder.pro.json`, productName `Cardnews Studio Pro`, appId `story.kkongdon.cardnews`.
  - Lite: `electron-builder.lite.json`, productName `Cardnews Studio Lite`, appId `story.kkongdon.cardnews.lite`.
- Lite stripping verification:
  - `scripts/verify-edition.mjs --edition lite`
  - Can also scan packaged `app.asar` and unpacked folder via `--scan`.
- Known packaging pitfall:
  - Directly building into project `release/` under OneDrive previously failed with `EPERM`/`EBUSY` rename problems.
  - M5 solved this by building in `%LOCALAPPDATA%` and copying validated artifacts back into `release/`.
- Latest implementation status:
  - M11 completed AI provider detection, raw chat, timeout/progress, and Lite stripping regression.
  - M11 explicitly did not package EXEs.
  - Current local `dist`/`dist-electron` were restored to Pro after M11.
- Working tree is dirty with expected ongoing project modifications. Release planning must preserve all existing changes and must not reset or revert unrelated files.

## Release Constraints

- Do not generate final EXE until source gates, edition gates, security checks, and packaged smoke gates pass.
- Lite/Pro feature matrix must remain separated. Ambiguous new features default to Pro.
- Lite must pass source artifact stripping and packaged artifact stripping.
- Pro-only AI/image/project/bulk/layer productivity features must not leak into Lite runtime, preload, renderer, or packaged `app.asar`.
- Use actual unpacked EXE smoke checks, not only dev Electron.
- Installer execution/real installation is a separate manual/system side-effect check and should not be required for automated completion unless the user explicitly authorizes it.

## Key Test Surfaces

Pro:
- content whitespace/input reliability
- inspector/layout scroll
- image picker hygiene
- badge/background removal
- next hint image
- chrome style
- AI provider detection
- raw AI chat
- timeout/progress
- AI draft workflow with mock provider

Lite:
- edition lock regression
- basic manual creation/export flow
- absence of Pro-only IPC symbols and UI/runtime entry points
- packaged `app.asar` stripping

## Recommended Artifact Layout

Build in isolated local folders:

- `%LOCALAPPDATA%\cardnews-release-pro-m12`
- `%LOCALAPPDATA%\cardnews-release-lite-m12`

Copy only validated artifacts into project release:

- `release/Cardnews-Studio-Pro-Setup-2.0.0.exe`
- `release/Cardnews-Studio-Lite-Setup-2.0.0.exe`
- `release/win-unpacked-pro-2.0.0/Cardnews Studio Pro.exe`
- `release/win-unpacked-lite-2.0.0/Cardnews Studio Lite.exe`

