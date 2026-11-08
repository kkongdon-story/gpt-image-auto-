# M24 Context Snapshot: Export, Media, Editor Geometry, and UX Hardening

## Task statement

Plan the next milestone after M23 so the application can:

1. edit each card's exposure duration instead of forcing every card to 3 seconds;
2. make title, subtitle, body, badge, footer, next hint, and page-number selection geometry match the rendered content and drag predictably;
3. make media import and per-card/global assignment understandable to a first-time user;
4. replace the top-right PNG-only action with one Export flow that offers PNG or MP4;
5. show the timeline automatically when video is present and on demand for photo-based reels;
6. diagnose and eliminate MP4 export stalls at `prepare · 10%`;
7. offer safe, official installation guidance when Codex CLI or Claude Code is missing;
8. render uploaded video as an actual playable preview instead of a blank color surface;
9. reorganize the accumulated menus for clearer, lower-friction operation;
10. carry the fixes through Lite/Pro verification, isolated packaging, installed and portable smoke tests, and staged distribution.

## Desired outcome

Produce a fail-closed PRD and test specification for M24. Implementation may proceed only after the plan's root-cause gates, acceptance criteria, edition checks, package parity checks, and release gates are satisfied. Existing M23 or public release artifacts must not be overwritten during development.

## Known facts and evidence

- M23 planning artifacts exist:
  - `.omx/plans/prd-v6-m23-canvas-video-timeline-hardening.md`
  - `.omx/plans/test-spec-v6-m23-canvas-video-timeline-hardening.md`
  - `.omx/plans/m23-canvas-video-timeline-ralplan-consensus.json`
- The current worktree has many existing modified and untracked files. M24 planning must not revert or normalize unrelated work.
- `src/domain/media.ts` defines `defaultCardSceneSettings.durationMs = 3000`, with normalized card scene limits of 500 ms to 180,000 ms.
- `src/domain/videoTimeline.ts` already compiles per-card `override.scene` values into a canonical timeline, so the missing capability is primarily editing, persistence, visibility, and regression coverage rather than a new timeline model.
- `src/ui/App.tsx` always renders the M23 timeline and shows each compiled scene duration, but does not expose a direct per-card duration editor in the visible timeline surface.
- `StageCanvas` measures semantic DOM rectangles, but `semanticRectFor` uses measured geometry only while a slot remains in flow mode; once a placement is card-positioned, the stored placement rectangle becomes the overlay source.
- `src/render-engine/cardTemplate.ts` emits semantic-item placement CSS with `position: fixed !important`, while the editor overlay calculates percentages in card coordinates. This is a concrete root-cause candidate for the visible box/content mismatch.
- Drag deltas are calculated from the overlay bounds, snapped by default, and immediately persist the full semantic rectangle. No drag threshold or selected-only geometry contract is evident in the current path.
- The current media import helper accepts a target (`global`, `card`, or `video-layer`) and immediately applies the imported asset, but the UI exposes similar import buttons in multiple panels. First-time users must infer library versus assignment semantics.
- The top bar directly calls PNG generation, while PNG result actions and MP4 export controls live separately under the Export inspector.
- `src/ui/App.tsx` already passes `liveVideo` for the selected preview card, and `cardTemplate.ts` emits real `<video>` elements when that flag is true. The blank preview therefore requires RED isolation of source URL/protocol, asset lookup, codec support, metadata/seek readiness, packaged-path resolution, and overlay visibility rather than assuming missing live-video wiring.
- `electron/videoExporter.ts` publishes `prepare · 10%` immediately before awaiting FFmpeg preflight. The await has no explicit phase watchdog, heartbeat, or diagnostic timeout at the exporter boundary.
- `electron/videoFrameProducer.ts` has local 5-second media readiness/seek timeouts, but document readiness checks fonts and images only. Video readiness is handled later and errors can lack phase-specific context.
- CLI provider discovery already exposes `installed`, `installHint`, version, and diagnostics. The current hard-coded Claude hint is the legacy npm form.
- Current official commands verified on 2026-07-17:
  - Codex CLI: `npm install -g @openai/codex`
  - Claude Code on Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
  - Claude Code alternative on Windows: `winget install Anthropic.ClaudeCode`
- Claude's official docs recommend the native installer and `claude --version` / `claude doctor` verification. Installation must never happen silently.

## Constraints

- This task is planning only. Do not modify product code or package artifacts.
- Preserve the current Lite/Pro edition matrix. Shared editor, media, timeline, and export usability fixes apply to both editions; Pro-only AI capability remains stripped or locked in Lite.
- Do not promise that implementation can never fail. Enforce a release rule that no artifact is staged when any mandatory gate is failed, blocked, stale, or missing evidence.
- Keep board preview, PNG rendering, MP4 frame rendering, and saved project data on one normalized geometry and timeline contract.
- Use isolated build roots under `.omc/build/` before copying anything to `release/`.
- Every gate writes a human-readable log and machine-readable `.meta.json`.
- Clean Windows VM installation remains a mandatory public-distribution gate, not an optional confidence check.

## Unknowns to resolve during implementation

- Whether the screenshot's geometry mismatch is caused solely by `position: fixed`, or also by duplicate semantic selectors, stale measured rectangles, anchor conversion, zoom/DPI scaling, or pointer capture.
- Whether the reported `prepare · 10%` stall is in FFmpeg preflight, executable probing, process spawn, frame-producer initialization, IPC progress delivery, or a packaged-path issue.
- Whether blank video preview is caused by an invalid preview URL/protocol, missing asset resolution, codec support, metadata/seek readiness, packaged media-path resolution, or an overlay/z-index issue.
- Whether photo-reel mode should be stored at deck level as an explicit `videoMode` flag or derived only from timeline visibility preferences. The plan should prefer an explicit persisted project mode with backward-compatible inference.

## Likely codebase touchpoints

- `src/domain/types.ts`
- `src/domain/media.ts`
- `src/domain/videoTimeline.ts`
- `src/domain/videoExport.ts`
- `src/domain/cardnews-api.ts`
- `src/render-engine/cardTemplate.ts`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `electron/videoExporter.ts`
- `electron/videoFrameProducer.ts`
- `electron/ffmpegPreflight.ts`
- `electron/ai/cliProviderDefinitions.ts`
- `electron/ai/cliProviderDiscovery.ts`
- `electron/main.ts`
- `electron/lite-main.ts`
- `electron/preload.cts`
- `electron/preload-lite.cts`
- `scripts/verify-edition.mjs`
- M24 verification, packaging, and evidence scripts to be added only during implementation.

## Planning decision drivers

1. Geometry and rendered output must have one source of truth.
2. Export must never hang without a bounded error, cancellation path, and diagnostic evidence.
3. First-time usability must improve without hiding expert controls or changing the edition contract.
4. Public release must be prevented unless source, unpacked, installed, Lite, and Pro evidence all agree.
