# RALPLAN Consensus Handoff: V6 M13 Lite Template Pack GPTs

Date: 2026-07-09
Workflow: `$ralplan`
Consensus status: complete

## Planning Artifacts

- PRD: `.omx/plans/prd-v6-m13-lite-template-pack-gpts.md`
- Test spec: `.omx/plans/test-spec-v6-m13-lite-template-pack-gpts.md`
- Context snapshot: `.omx/context/lite-open-design-gpts-template-pack-20260709T091500Z.md`

## Review Artifacts

- Architect iteration 1: `.omx/plans/review-v6-m13-architect-iteration1.md`
  - Verdict: ITERATE
- Architect iteration 2: `.omx/plans/review-v6-m13-architect-iteration2.md`
  - Verdict: APPROVE
- Critic iteration 1: `.omx/plans/review-v6-m13-critic-iteration1.md`
  - Verdict: ITERATE
- Architect iteration 3: `.omx/plans/review-v6-m13-architect-iteration3.md`
  - Verdict: APPROVE
- Critic iteration 2: `.omx/plans/review-v6-m13-critic-iteration2.md`
  - Verdict: APPROVE

## Consensus Gate

```json
{
  "ralplan_consensus_gate": {
    "complete": true,
    "architect_approved": true,
    "critic_approved": true,
    "required_order": "Architect -> Critic",
    "final_architect_review": ".omx/plans/review-v6-m13-architect-iteration3.md",
    "final_critic_review": ".omx/plans/review-v6-m13-critic-iteration2.md"
  }
}
```

## Final Decision

Proceed with Option A:

- Open Lite content/design controls.
- Keep AI, bulk, automated background removal, and full project archive import/export Pro-only.
- Add a safe import-only template-pack workflow for Lite and Pro.
- Add a GPTs builder guide for reference analysis, text-removed background generation, and app-compatible JSON/package output.
- Fix the `넘김 기호`/typography UI grouping.
- Clarify `양식 관리` versus `스타일 관리`.
- Add a persisted GPTs shortcut URL setting using the centralized external-link policy.

## Execution Boundaries

- M13 does not package EXE files.
- M13 does not add in-app AI image generation.
- M13 does not add in-app OCR.
- M13 does not implement template-pack export.
- M13 does not open full project archive import/export in Lite.

## Required Verification

Run and record evidence for:

```bash
npm run typecheck
npm run test
node scripts/verify-edition.mjs --edition lite
npm run build:lite
npm run build:pro
```

Also run manual/Playwright smoke for:

- Lite content/design open
- Lite AI/bulk locked
- Pro AI/bulk available
- one-card template-pack import
- multi-card template-pack import
- unsafe archive rejection
- next-hint controls only affect next hint
- typography controls affect main typography
- GPTs URL persistence and allow-list behavior

## Suggested Follow-up Command

```text
[$ultragoal]
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m13-lite-template-pack-gpts.md 와
.omx/plans/test-spec-v6-m13-lite-template-pack-gpts.md 기준으로 구현해.
Lite는 콘텐츠/디자인 기능을 열고 AI/벌크/프로젝트 아카이브는 잠가.
템플릿팩 import, GPTs 제작 가이드, 넘김 기호/타이포그래피 UI 분리,
양식/스타일 관리 기능 분류, GPTs URL 설정을 구현해.
EXE 패키징은 하지 말고 Lite/Pro 검증과 HANDOFF.md 갱신까지 완료해.
```
