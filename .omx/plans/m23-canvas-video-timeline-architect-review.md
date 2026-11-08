# M23 Architect Review

## Review 1

- Role: Architect
- Agent: `019f6dee-d878-7470-9a27-7d240e75e1f3`
- Verdict: `REVISE`

### High findings

1. The older planner draft allowed staging after fresh-profile smoke, while the PRD/test spec require a clean Windows VM install/export/uninstall gate before public-ready staging.
2. The older draft described 300MiB as recommended and 500MiB as hard maximum and left MOV/WebM open, conflicting with the PRD's 300MiB hard new-import limit and MP4/H.264 contract.
3. The older draft's 4.5Mbps/2Mbps exceptions conflict with the final motion >=6Mbps and static SSIM/PSNR gates.

### Medium findings

1. Evidence roots differed between the planner draft and formal PRD/test spec.
2. Performance thresholds require a recorded reference-machine profile; missing profile must yield `blocked`.

### Security finding

Preview/export media URLs must resolve only from imported library asset IDs or controlled temporary render outputs. Arbitrary `file://` paths are forbidden, temporary URLs must be revoked, and failed imports must be quarantined/cleaned. This must be a release blocker.

### Steelman antithesis

A retained-mode canvas engine could provide more deterministic hit testing and transforms than an iframe/DOM editor and avoid some font/video readiness races.

### Tradeoff and synthesis

Keeping one DOM/CSS renderer reduces board/PNG/MP4 drift but increases measurement lifecycle complexity. The acceptable synthesis is to use measured DOM rectangles only to seed unset normalized placement, then persist normalized geometry as the authoritative composition. T3-T5 must prove equivalence.

### Required revisions

- Normalize the older draft to the formal evidence root, import policy, quality thresholds, and VM gate.
- Add reference-machine blocking behavior.
- Add explicit controlled-media-origin security invariant.
- Prevent any public-ready pointer change unless G0-G11 all pass.

## Review 2

- Role: Architect
- Agent: `019f6dee-d878-7470-9a27-7d240e75e1f3`
- Verdict: `APPROVE`

All prior findings are closed:

- Clean Windows VM is required before public-ready staging.
- New imports use the single 300MiB MP4/H.264/AAC-or-none policy and legacy 300-500MiB media is read-only/non-duplicable.
- Quality gates use motion >=6Mbps and static SSIM/PSNR, with the attached-equivalent 0.204Mbps result rejected.
- All artifacts use `.omc/evidence/v6/m23-canvas-video-timeline-hardening/`.
- Missing reference-machine evidence is `blocked`.
- Arbitrary paths/direct `file://` are forbidden at the renderer boundary.

The steelman and tradeoff remain: a retained-mode canvas could simplify hit testing, but it would create a second layout engine. The approved synthesis keeps the DOM/CSS renderer, uses DOM rectangles only to seed unset normalized geometry, and requires T3-T5 to prove board/PNG/MP4 equivalence.

Remaining Architect blockers: none.

## Review 3

- Role: Architect
- Agent: `019f6dee-d878-7470-9a27-7d240e75e1f3`
- Verdict: `REVISE`

The execution brief referenced the durable consensus JSON before that file existed. A placeholder consensus record must exist with `ralplan_consensus_gate.complete:false`; it may change to true only after final Architect then Critic approval.

The architecture principles and DOM-extension tradeoff remain approved. This review changes only the durable handoff ordering.

## Review 4

- Role: Architect
- Agent: `019f6dee-d878-7470-9a27-7d240e75e1f3`
- Verdict: `APPROVE`

The durable consensus placeholder exists, resolves from the M23 execution brief, and correctly blocks execution with `complete:false` until the subsequent Critic approval. No remaining Architect blockers.
