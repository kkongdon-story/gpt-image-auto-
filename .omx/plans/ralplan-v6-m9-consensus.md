# RALPLAN Consensus Log: V6 M9 Test Feedback Bugfixes

Status: approved
Date: 2026-07-08

## Artifacts

- Context: `.omx/context/cardnews-v6-m9-bugfix-context-20260708T123229Z.md`
- PRD: `.omx/plans/prd-v6-m9-test-feedback-bugfixes.md`
- Test spec: `.omx/plans/test-spec-v6-m9-test-feedback-bugfixes.md`

## Planner Decision

Recommended path: targeted bugfix pass before packaging, with shared UI/render fixes applied to both editions and Pro-only image/AI fixes verified through edition stripping.

## Architect Review

Verdict: ITERATE.

Required change: clarify the footer data model. The draft introduced `footerText` language while the codebase currently uses `footerAccount` across domain, storage, workspace, presets, and Lite filtering.

Applied resolution:
- Keep the persisted field name `footerAccount` in this bugfix.
- Redefine it as footer display text that preserves user input, including `@`.
- Add a derived `normalizeThreadsHandle()` path only for social URL construction.
- Explicitly name old tests/smokes that must change: `src/storage/deckStore.test.ts` and `electron/main.ts`.

Consensus synthesis:
- A future schema rename to `footerText` is semantically cleaner, but too wide before packaging.
- This bugfix should favor compatibility and observable behavior.

## Critic Review

Verdict: APPROVE.

Reasoning:
- The eight reported defects are represented as R1-R8 with concrete acceptance criteria.
- The footer `@` behavior now has a clear data-model contract: keep `footerAccount` as the persisted display field and derive `normalizeThreadsHandle()` only for social URLs.
- The test spec covers footer persistence/rendering, page format dropdowns, typing responsiveness, badge case, inspector layout, image-library hygiene, background-removal tolerance, AI preset modes, and Lite regression.
- Stop conditions correctly block release packaging if any screenshot scenario still reproduces, Lite leaks Pro features, or smoke images remain visible in normal image pickers.

## Next Execution Lane

Use `$ultrawork` or `$omo:ulw-loop` to implement the approved plan from:

`C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\.omx\plans\prd-v6-m9-test-feedback-bugfixes.md`

Required paired test spec:

`C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\.omx\plans\test-spec-v6-m9-test-feedback-bugfixes.md`

Recommended execution prompt:

```text
[$ultrawork](C:\Users\js480\.codex\skills\ultrawork\SKILL.md)
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m9-test-feedback-bugfixes.md 와
.omx/plans/test-spec-v6-m9-test-feedback-bugfixes.md 를 읽고 R1부터 R8까지 순서대로 구현해.
공통 버그는 Lite/Pro 모두 수정하고, 이미지/AI 관련 Pro 기능은 Lite에서 잠금/스트리핑 검증까지 완료해.
각 요구사항의 수용 기준과 테스트 스펙 T1-T9를 통과시키고, EXE 패키징은 아직 하지 말고 테스트 증거와 HANDOFF.md만 갱신해.
```
