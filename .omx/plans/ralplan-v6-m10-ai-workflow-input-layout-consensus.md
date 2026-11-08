# RALPLAN Consensus Handoff: V6 M10 AI Workflow, Input, and Layout

Status: RALPLAN approved; consensus gate complete
Date: 2026-07-09

## Planning Artifacts

- PRD: `.omx/plans/prd-v6-m10-ai-workflow-input-layout.md`
- Test spec: `.omx/plans/test-spec-v6-m10-ai-workflow-input-layout.md`
- Context snapshot: `.omx/context/cardnews-v6-m10-ai-workflow-input-layout-context-20260708T173131Z.md`

## RALPLAN-DR Summary

Principles:

1. Preserve user keystrokes exactly in active inputs.
2. Hide internal AI prompt plumbing from the normal user workflow.
3. Convert provider-specific CLI errors into actionable product states.
4. Keep common fixes shared, Pro-only providers stripped from Lite.
5. Require screenshot/smoke evidence for the exact reported QA paths.

Decision Drivers:

1. User cannot confidently test Pro because core text and AI flows feel unreliable.
2. Provider CLI behavior varies by local environment.
3. Packaging should wait until this batch passes Pro and Lite verification.

Options:

1. Targeted M10 bugfix pass with mode-aware AI workflow state. Recommended.
2. Minimal symptom patch. Rejected because it does not solve the AI workflow confusion.
3. Full AI panel rewrite. Rejected as too broad before packaging.

ADR:

- Decision: implement Option 1.
- Why chosen: it fixes the reported blocking defects while keeping the diff bounded and testable.
- Consequence: AI state/action code in `src/ui/App.tsx` should become more explicit, and provider commands need a small testable abstraction.

## Architect Review

Verdict: APPROVE.

Architect summary:

- The plan matches the real failure surfaces: active title edits appear to round-trip through parse/serialize normalization, AI presets currently write generated prompts into the composer, provider commands are static shell strings, and the inspector defect sits in a nested scroll/panel path.
- Strongest antithesis: avoid AI workflow redesign in M10 and patch only Codex flags, Claude wording, textarea normalization, and CSS. Rejected because the user's fourth defect is a real workflow failure, not cosmetic copy.
- Tradeoff: the targeted AI workflow-state fix solves prompt contamination but touches fragile `src/ui/App.tsx` before packaging.
- Synthesis: keep the AI state change narrow, make provider command construction typed/testable, and strengthen the inspector test around `콘텐츠 -> 디자인` lower controls.
- No blocking principle violations found.

Architect-required refinements applied:

- R1 now explicitly tests active textarea trailing spaces before blur/save.
- R2 now requires evidence for the nested `콘텐츠 -> 디자인` lower-control path.
- R3 now requires both `--skip-git-repo-check` and project/workspace cwd when available.
- R5 now requires `새 대화` to clear composer, internal prompt/debug state, selected workflow context, detected draft state, and next-step actions.

## Critic Review

Verdict: APPROVE.

Critic justification:

- The plan is actionable and grounded in the real failure surfaces: `App.tsx` routes title edits through serialization, AI presets overwrite `aiInput`, AI calls include prior thread history by default, Codex is configured as `codex exec -`, and provider cwd is currently `storageRoot()`.
- Principles/options consistency: Pass. Option 1 follows the stated principles, and the minimal-patch/full-rewrite alternatives are fairly rejected.
- Risk mitigation clarity: Pass. The plan separates shared Lite/Pro input/layout fixes from Pro-only AI/provider work and requires Lite stripping verification.
- Testability: Pass. R1-R5 have concrete unit/smoke/manual evidence paths.
- No blocking acceptance/test gaps found.

Critic execution notes applied:

- R1 evidence must include save/reload line-break preservation, not only active DOM smoke.
- R3 implementation must define the project/workspace cwd discovery strategy before coding the Codex command builder.

## Consensus Gate

```json
{
  "planning_artifacts": {
    "prd": ".omx/plans/prd-v6-m10-ai-workflow-input-layout.md",
    "test_spec": ".omx/plans/test-spec-v6-m10-ai-workflow-input-layout.md",
    "context": ".omx/context/cardnews-v6-m10-ai-workflow-input-layout-context-20260708T173131Z.md"
  },
  "ralplan_architect_review": {
    "verdict": "APPROVE",
    "completed_before_critic": true,
    "summary": "Plan is architecturally sound if the AI workflow change stays narrow, provider command construction becomes testable, and the nested content-design inspector path is directly verified."
  },
  "ralplan_critic_review": {
    "verdict": "APPROVE",
    "completed_after_architect": true,
    "summary": "Plan is actionable, alternatives are fair, risks are mitigated, and R1-R5 are testable with Pro and Lite gates."
  },
  "ralplan_consensus_gate": {
    "complete": true,
    "reason": "Architect APPROVE completed first; Critic APPROVE completed second; required refinements were applied."
  }
}
```

## Follow-up Execution Hints

Recommended next command after approval:

```text
$ultragoal C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto\.omx\plans\prd-v6-m10-ai-workflow-input-layout.md 와 test-spec-v6-m10-ai-workflow-input-layout.md 기준으로 구현해. EXE 패키징은 하지 말고 M10 증거와 HANDOFF.md를 갱신해.
```

Parallel option:

```text
$team M10을 4개 lane(input/layout, provider, AI workflow, verification)으로 나눠 구현하고 Lite/Pro 검증까지 완료해.
```

Ralph fallback:

```text
$ralph M10 PRD/test-spec를 단일 소유자로 구현하고 검증 증거를 남겨.
```
