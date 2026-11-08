# Consensus Gate: V6 M12 Lite/Pro EXE Release Gates

Date: 2026-07-09
Mode: ralplan

## Artifacts

- Context: `.omx/context/lite-pro-exe-release-gates-20260709.md`
- PRD: `.omx/plans/prd-v6-m12-lite-pro-exe-release-gates.md`
- Test Spec: `.omx/plans/test-spec-v6-m12-lite-pro-exe-release-gates.md`
- Architect Review: `.omx/plans/review-v6-m12-architect.md`
- Critic Review: `.omx/plans/review-v6-m12-critic.md`

## Consensus Result

Status: APPROVED AFTER ITERATION

The initial plan was reviewed by Architect and Critic. Both returned ITERATE, not because the release strategy was wrong, but because execution evidence and safety semantics needed tightening. Their required changes have been applied.

## Applied Consensus Changes

1. M12 uses `%LOCALAPPDATA%` isolated Pro/Lite package outputs and avoids direct `npm run dist:win:*` release scripts.
2. Every mandatory gate requires command metadata with command, start/end time, exitCode, accepted exit codes, reviewRequired, logPath, and success.
3. Review-style commands have explicit exit-code semantics:
   - `rg` exit `1` can pass when it means no matches.
   - `npm audit --omit=dev` non-zero requires severity review.
4. Lite stripping is required at source, local package, and copied release package levels.
5. `ai-provider-command-regression` is required for AI command security.
6. `@electron/asar` import availability is checked before relying on package-level Lite scans.
7. Packaged EXE smoke uses timeout handling and exact-process cleanup.
8. Release unpacked folders are staged in `.tmp` paths and verified before replacing final paths.
9. Final workspace build artifacts are restored to Pro with `npm run build:pro`.
10. `HANDOFF.md` must be updated append-only with M12 release evidence.

## Execution Recommendation

Use the PRD and test spec as the next implementation contract. Do not package EXEs until M12-1 through M12-4 pass. If any mandatory gate fails, stop packaging and fix the blocker first.

Recommended next command to the agent:

```text
[$ultrawork](C:\Users\js480\.codex\skills\ultrawork\SKILL.md)
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m12-lite-pro-exe-release-gates.md 와
.omx/plans/test-spec-v6-m12-lite-pro-exe-release-gates.md 기준으로 M12-1부터 순서대로 실행해.
각 게이트의 로그와 .meta.json 증거를 .omc/evidence/v6/m12-lite-pro-exe-release/에 남기고,
Lite/Pro EXE 패키징은 %LOCALAPPDATA% isolated output에서 먼저 검증한 뒤 release/로 staged copy해.
최종적으로 HANDOFF.md를 append-only로 갱신해.
```

