# M23 Durable Execution Brief

Project root: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

Implement in order from:

- `.omx/plans/prd-v6-m23-canvas-video-timeline-hardening.md`
- `.omx/plans/test-spec-v6-m23-canvas-video-timeline-hardening.md`
- `.omx/plans/m23-canvas-video-timeline-ralplan-consensus.json`

Required execution order:

1. M23-0 forensic RED harness.
2. M23-1 schema and semantic identity.
3. M23-2 board transform engine.
4. M23-3 live-video preview and import limits.
5. M23-4 canonical timeline and UI.
6. M23-5 frame ownership and transitions.
7. M23-6 encoder quality and real MP4 gates.
8. M23-7 regression and edition verification.
9. M23-8 isolated packaging and packaged QA.
10. M23-9 staged release and append-only handoff.

Hard constraints:

- Write every gate log and `.meta.json` under `.omc/evidence/v6/m23-canvas-video-timeline-hardening/`.
- Stop downstream work when any prior G0-G11 gate is not `pass`.
- Keep the M22 distribution intact.
- Package Lite/Pro in isolated output roots first.
- Require fresh-profile and clean Windows VM install/export/uninstall evidence before public-ready staging.
- Stage only into a new `release/distribution/Cardnews-Studio-M23-{runId}/` folder.
- Keep Lite AI/provider/bulk stripping rules unchanged.
- Append `HANDOFF.md`; do not rewrite its history.

Completion means all PRD requirements, test traceability, quantitative media gates, packaged checks, hashes, rollback data, final independent code review, and Ultragoal quality gate are clean.

