# M24 Architect Review

Reviewer agent: `019f6f1a-4bad-7e91-b522-475ee983791c`

Verdict: REVISE

## Strongest antithesis

M24 combines geometry repair, migration, timeline mode, media UX, video playback, exporter liveness, CLI installation, menu IA, and full release validation in one milestone. Because much of the current behavior is integrated in `src/ui/App.tsx`, broad simultaneous edits could hide the root cause or make regression ownership unclear.

## Required repairs

1. Use one evidence metadata field and one stale-evidence rule.
2. Align PRD and test-spec gate IDs and order.
3. Revalidate official CLI recipes and preserve existing Gemini discovery scope.
4. Stop assuming selected-card `liveVideo` wiring is absent; isolate URL, codec, readiness, package path, and overlay failures.
5. Enumerate every persistence target for `videoProjectMode`.
6. Select one canonical export progress field across domain, API, IPC, preload, UI, and diagnostics.

## Applied synthesis

- M24 remains one public milestone but now has an ordered release-blocking core and a later usability/provider track.
- Menu movement is prohibited until export liveness G5 passes.
- `status` is canonical; stale is derived.
- Gate IDs are shared verbatim across PRD and test specification.
- Current official OpenAI and Anthropic sources confirm the planned Codex npm and Claude native PowerShell/WinGet recipes.
- Selected-card video diagnosis is evidence-first.
- `videoProjectMode` round-trip targets and canonical export `stage` ownership are explicit.

The revised documents require a fresh Critic review before consensus is complete.

## Revision 1 re-review

Verdict: APPROVE

The Architect confirmed that all six required repairs are closed:

- canonical `status` evidence contract and derived staleness;
- identical G0-G13 gate IDs;
- current Codex/Claude recipes with Gemini discovery preserved;
- evidence-first blank-video diagnosis;
- explicit `videoProjectMode` persistence targets;
- canonical export `stage` field.
