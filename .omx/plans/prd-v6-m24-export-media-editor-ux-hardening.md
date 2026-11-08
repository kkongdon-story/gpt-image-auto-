# PRD: V6 M24 Export, Media, Editor Geometry, and UX Hardening

Status: RALPLAN consensus approved on 2026-07-17

## 1. Goal

M24 makes the existing M21-M23 editor and video pipeline understandable, bounded, and releaseable.

The milestone must:

1. expose the existing per-card scene duration model in the editor;
2. make every semantic selection box match the rendered item and move without jumping;
3. distinguish media import from media assignment;
4. replace the PNG-only top action with one Export flow for PNG and MP4;
5. show the timeline only when a video project needs it;
6. replace the opaque `prepare · 10%` wait with a bounded, diagnosable export state machine;
7. provide safe Pro-only CLI installation actions when Codex CLI or Claude Code is missing;
8. display a real, seekable selected-card video preview;
9. reorganize the accumulated menus without removing established capabilities;
10. release Lite and Pro only after source, portable, installed, and clean-VM evidence agrees.

M24 does not promise that software can never fail. It enforces a fail-closed rule: a failed, blocked, stale, skipped, or missing mandatory gate prevents staging and public-ready labeling.

## 2. Source of Truth

### 2.1 User evidence

The attached editor screenshot shows:

- the title selection rectangle far above the visible title;
- oversized semantic rectangles crossing unrelated content;
- badge, title, subtitle, body, footer, next hint, page number, and media boundaries overlapping;
- click and drag targets that do not correspond to the visible item;
- a timeline and media feature set whose relationship is not obvious from the main flow.

### 2.2 Current code findings

- `src/domain/media.ts`
  - `defaultCardSceneSettings.durationMs` is already `3000`;
  - card duration is already normalized to `500..180000ms`;
  - this is an editor/persistence/visibility gap, not a missing domain primitive.
- `src/domain/videoTimeline.ts`
  - compiles `override.scene` per card;
  - already derives scene starts, ends, frame ranges, transitions, media ownership, and total duration.
- `src/ui/App.tsx`
  - always renders the M23 timeline;
  - displays scene duration but has no direct timeline duration editor;
  - keeps PNG generation in the top bar and MP4 export in the right Export panel;
  - exposes repeated import actions that immediately apply to different targets;
  - already requests `liveVideo` for the selected preview card;
  - measures DOM rectangles for flow semantic items, then switches to saved placement rectangles after the first card placement;
  - calculates drag deltas from the overlay and snaps immediately, with no click/drag threshold.
- `src/render-engine/cardTemplate.ts`
  - emits semantic placement CSS with `position: fixed !important`;
  - emits a real `<video>` only when `liveVideo === true`;
  - otherwise video layers are rendered as color placeholders.
- `electron/videoExporter.ts`
  - reports `prepare · 10%` immediately before awaiting FFmpeg preflight;
  - has cancellation after spawn, but no exporter-level no-progress watchdog around preflight, producer initialization, first frame, or final drain.
- `electron/videoFrameProducer.ts`
  - has local video metadata/seek timeouts;
  - document readiness checks card, fonts, and images, while video readiness is deferred;
  - failures are not consistently reported with a user-visible phase and diagnostic bundle.
- `electron/ai/cliProviderDiscovery.ts`
  - already returns install status, version, hint, and diagnostics;
  - the provider definition is the correct central place for fixed, allowlisted install metadata.

### 2.3 Official CLI installation sources verified on 2026-07-17

- Codex CLI:
  - install: `npm install -g @openai/codex`
  - verify: `codex --version`
  - official source: `https://help.openai.com/en/articles/11096431`
- Claude Code on Windows:
  - recommended PowerShell native installer: `irm https://claude.ai/install.ps1 | iex`
  - package-manager alternative: `winget install Anthropic.ClaudeCode`
  - verify: `claude --version`
  - diagnose: `claude doctor`
  - official source: `https://code.claude.com/docs/en/installation`

Implementation must re-check official OpenAI and Anthropic documentation before shipping because installation instructions are externally versioned.

## 3. Scope

### In scope

- Lite/Pro shared duration editing, timeline behavior, geometry, media UX, export UX, video preview, menu organization, PNG/MP4 reliability, diagnostics, packaging, and release evidence.
- Pro-only CLI status and installation actions.
- Backward-compatible project migration.
- Source, browser, portable, installed, and clean-VM validation.
- Append-only `HANDOFF.md` update after implementation.

### Out of scope

- Full CapCut-style multi-track NLE.
- Fabric, Konva, or another retained-mode canvas migration.
- Arbitrary video transcoding on import.
- Cloud rendering.
- New AI providers or new AI content capabilities.
- New Lite access to AI, CSV bulk, or other Pro-only features.
- Code signing and auto-update.
- Overwriting an M23 or current public distribution.

### 3.1 Delivery sequencing

M24 remains one public-release milestone but is implemented as two ordered internal tracks:

1. release-blocking core:
   - RED harness and migration;
   - semantic geometry and interaction;
   - duration, timeline, media assignment, and live preview;
   - unified export, watchdog, cancellation, cleanup, and diagnostics.
2. usability and provider hardening:
   - Pro CLI installation;
   - menu IA, accessibility, and performance.

Broad menu movement may not begin until the release-blocking core reaches G5 `pass`. Isolated packaging may not begin until both tracks and G8 regression are `pass`. This prevents a menu refactor from obscuring geometry, playback, or exporter root causes while keeping all nine user requirements mandatory for M24 release.

## 4. Invariants

1. Board, PNG, MP4, and saved project data use the same normalized card-coordinate geometry.
2. A semantic item ID maps to exactly one rendered ownership element per card.
3. The compiled video timeline remains the authority for preview and export timing.
4. Media URLs resolve only from imported asset IDs or controlled temporary renderer output.
5. CLI commands come from a fixed provider registry, never from user-authored shell text.
6. CLI installation is never silent and never runs without an explicit confirmation.
7. Lite contains no executable Pro AI provider path, install command, or CLI process bridge.
8. Export always reaches success, a classified failure, or cancellation; it cannot remain indefinitely in one phase.
9. Later release gates refuse to run when an earlier mandatory gate is not `pass`.
10. Development and packaging do not modify prior public release artifacts.

## 5. Edition Matrix

| Capability | Lite | Pro |
| --- | --- | --- |
| Per-card duration | enabled | enabled |
| Photo-reel video mode | enabled | enabled |
| Timeline and transitions | enabled | enabled |
| Media library and per-card assignment | enabled | enabled |
| Selected-card live video preview | enabled | enabled |
| Unified PNG/MP4 Export dialog | enabled | enabled |
| Geometry and menu hardening | enabled | enabled |
| Codex/Claude status and install UI | absent/stripped | enabled |
| AI conversation and generation | locked/stripped per existing matrix | enabled |
| CSV bulk generation | locked/stripped per existing matrix | enabled |

The M24 shared work must not weaken the existing edition verifier.

## 6. RALPLAN-DR

### Principles

1. One normalized contract is better than parallel editor/render/export models.
2. Root-cause gates precede UI patches.
3. Long work must be observable and cancellable.
4. Beginner clarity comes from explicit actions and progressive disclosure.
5. Release claims require artifact evidence, not source-only confidence.

### Decision drivers

1. Resolve the user's current blockers without reopening the M22/M23 architecture.
2. Preserve existing project compatibility and style fidelity.
3. Prevent another package from being distributed with source-only or unpacked-only validation.

### Option A: Harden the existing DOM renderer and compiled timeline

Approach:

- keep the existing renderer;
- replace mixed geometry behavior with one placement contract;
- expose existing scene duration;
- add explicit video mode;
- unify export UX and instrument the current exporter;
- reorganize the inspector.

Benefits:

- smallest compatibility surface;
- board/PNG/MP4 can continue sharing the renderer;
- existing project archives remain viable.

Costs:

- iframe readiness, media lifecycle, and pointer behavior require disciplined tests;
- `App.tsx` remains a shared integration hotspot until later decomposition.

### Option B: Replace the editor with Fabric/Konva

Benefits:

- mature hit testing and transform handles.

Costs:

- introduces a second layout/rendering model;
- risks typography, style, PNG, and MP4 drift;
- materially expands migration and release risk.

Decision: rejected for M24.

### Option C: Patch only the visible controls

Benefits:

- lower short-term effort.

Costs:

- does not eliminate the geometry source conflict;
- does not bound export hangs;
- does not prove packaged video playback.

Decision: rejected.

### Decision

Use Option A. Extend the current normalized model and renderer, but require mechanical equivalence and packaged-path evidence before staging.

## 7. Domain Contracts

### 7.1 Per-card duration

- `CardSceneSettings.durationMs` remains the canonical per-card exposure value.
- Defaults remain:
  - `durationMs: 3000`;
  - `durationMode: "fixed"`.
- Valid fixed duration range remains `500..180000ms`.
- UI representation:
  - card timeline item contains a seconds input with a stepper;
  - inspector exposes the same value under `영상 > 장면`;
  - both edit the same override;
  - values display to one decimal place but persist as integer milliseconds.
- `fit-primary-video` remains available only as an explicit mode. It must not silently replace a user-entered fixed duration.
- A duration edit must update the compiled total and card widths without recreating unrelated card state.

### 7.2 Video project mode and timeline visibility

Add a backward-compatible deck-level flag:

```ts
type VideoProjectMode = "cards" | "video";
```

- New projects default to `"cards"`.
- Importing or assigning the first video changes the project to `"video"` after the user confirms the assignment.
- The user can select `영상 만들기` to enable `"video"` for photo-only reels.
- Removing the last video does not silently disable a photo-reel project.
- Legacy project migration:
  - infer `"video"` when an assigned background/video layer exists;
  - otherwise infer `"cards"`;
  - do not write migrated state until save or an explicit mode change.
- The field must round-trip through every persisted project shape and adapter:
  - `DeckDraft`;
  - `Deck`;
  - `DeckPreset`;
  - `WorkspaceState` autosave/restore;
  - project archive import/export;
  - Lite edition strip/sanitize functions;
  - packaged load paths.
- One shared normalization function owns defaulting and inference. UI components and package entry points may not independently infer the mode.
- Timeline renders only in `"video"` mode.
- A session-only collapse control may hide the timeline without changing project mode.

### 7.3 Semantic item identity

Required independently selectable items:

- header;
- page number;
- badge;
- body number;
- title;
- subtitle;
- every body paragraph and bullet;
- source;
- emphasis/CTA;
- footer;
- next hint.

Rules:

- one stable semantic ID per logical item;
- one owner DOM element per ID;
- nested descendants must not repeat the same semantic ID;
- duplicate or missing IDs are a test failure;
- hit testing resolves the topmost visible item and supports overlap cycling without selecting unrelated full-card containers.

### 7.4 Geometry authority

The canonical stored form is normalized card geometry:

```ts
type SemanticItemPlacement = {
  mode: "flow" | "card";
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: "top-left" | "top-center" | "top-right";
};
```

Rules:

- `.card` is the containing block.
- Card-positioned semantic owners use `position: absolute`, never viewport-fixed positioning.
- DOM measurement may seed a flow item at first selection.
- After materialization, the normalized placement is authoritative for overlay and render.
- Width and height refer to the owning semantic wrapper, not an unrelated content section.
- Overlay geometry uses the same anchor conversion as rendering.
- Zoom, CSS transform, device scale, and iframe coordinates are converted once.
- Pointer-down without a movement threshold is selection, not a transform.
- Drag threshold is 4 CSS pixels.
- Default snapping must not cause an initial jump. Guides may engage only after threshold.
- Undo/redo stores one transaction per completed gesture.

### 7.5 Media library and assignment

Import and assignment are separate concepts:

- `가져오기` copies/probes an asset into the project media library;
- `적용` assigns a library asset to a global background, selected-card background, or selected-card video layer;
- `보관만` imports without assignment.

After a new import, show an assignment sheet:

- `현재 카드 배경`;
- `모든 카드 배경`;
- `현재 카드 영상 레이어` for video;
- `보관만`.

Each card's Media section must show:

- inherited/global/none/current-asset status;
- selected asset name and kind;
- `변경`, `해제`, and `전역 따름`;
- whether a video automatically enabled video mode.

Import must remain bounded by the existing M23 media safety contract.

### 7.6 Selected-card live video

- Current source already passes `liveVideo` for the selected preview card. M24 must not assume missing wiring is the root cause.
- The RED harness must isolate, in order:
  - resolved source URL/protocol;
  - asset existence and media kind;
  - codec/container support;
  - `loadedmetadata`, seek, play, pause, and error events;
  - packaged custom-protocol and temporary-path resolution;
  - overlay/z-index visibility.
- Stage preview continues to pass `liveVideo: true` only for the selected full-size card when video mode is active and a playable video is assigned.
- Thumbnails use posters and never auto-play.
- Preview source URLs come from the controlled media resolver.
- The preview waits for `loadedmetadata`, then seeks to the selected timeline time.
- A video error displays a classified Korean state:
  - unsupported codec;
  - missing asset;
  - load timeout;
  - decode error.
- Blank color is not a successful preview.
- Switching cards, deleting media, closing the project, and unmounting revoke temporary URLs and stop playback.

### 7.7 Unified export request

Replace the top-bar `PNG 생성` action with `내보내기`.

The modal has two output choices:

1. `이미지(PNG)`
   - current card;
   - all cards ZIP;
   - existing quality-gate result and approval flow.
2. `영상(MP4)`
   - 1080x1920;
   - total duration;
   - card duration summary;
   - transition summary;
   - start/cancel;
   - success folder action.

Output type selection must not mutate project state.

### 7.8 Export state machine

Replace the coarse four-phase display with:

```ts
type VideoExportStage =
  | "compile"
  | "preflight"
  | "producer_init"
  | "render"
  | "encode"
  | "finalize";
```

`stage` is the canonical progress field across:

- `src/domain/videoExport.ts`;
- `src/domain/cardnews-api.ts`;
- renderer state;
- Pro and Lite preload bridges;
- Pro and Lite main-process handlers;
- diagnostic event records.

The legacy in-memory field `phase` is renamed during implementation. Export progress is not persisted, so no archive migration is required. A compatibility alias may exist only at one typed adapter boundary during the change and must be removed before G8.

Required behavior:

- stage transitions are monotonic;
- progress heartbeat at least every 2 seconds during active work;
- elapsed time is visible;
- cancellation works before and after FFmpeg spawn;
- partial files and temporary render windows are cleaned.

No-progress watchdog defaults:

- preflight: 30 seconds;
- producer initialization/first frame: 45 seconds;
- render: 30 seconds without a frame or heartbeat;
- encoder drain/finalize: 60 seconds.

Long exports may exceed these total durations while progress continues.

On timeout:

- abort owned child processes;
- close capture windows;
- remove partial output;
- return a classified Korean error with the last completed stage;
- write a sanitized diagnostic bundle.

### 7.9 Export diagnostics

Each MP4 job records:

- job ID and timeline digest;
- source-state digest;
- output target and free disk preflight;
- FFmpeg resolved path, version, encoder capability, and probe duration;
- stage enter/leave timestamps;
- heartbeat timestamps;
- current card/frame;
- child process IDs owned by the job;
- sanitized stderr tail;
- cleanup result;
- final verdict.

User content, credentials, raw prompts, and direct personal file paths must not appear in diagnostics.

### 7.10 CLI installation registry

Pro provider metadata becomes structured:

```ts
type AiProviderInstallRecipe = {
  provider: "codex" | "claude";
  platform: "windows";
  method: "npm" | "powershell-native" | "winget";
  command: readonly string[];
  verifyCommand: readonly string[];
  doctorCommand?: readonly string[];
  officialUrl: string;
};
```

Rules:

- commands are fixed literals in the main process;
- renderer sends only a provider and recipe ID;
- no arbitrary shell string crosses IPC;
- user sees command, source, prerequisites, and confirmation;
- recipes are revalidated against their official URL during the implementation release gate;
- installation opens a visible terminal;
- no admin elevation is requested automatically;
- cancellation and non-zero exit are shown;
- provider discovery refreshes after completion;
- authentication remains a separate user action;
- Lite build strips recipes, IPC, and install UI.
- Existing Gemini discovery remains unchanged. M24 adds install recipes only for Codex and Claude Code; it must not remove or silently change Gemini discovery.

Preferred Windows methods:

- Codex: npm recipe after `node --version` and `npm --version` pass.
- Claude: official native PowerShell recipe as the recommended method; WinGet as an explicit package-manager alternative.

### 7.11 Menu information architecture

Top bar:

- project identity/style/aspect;
- undo/redo;
- AI entry in Pro;
- one `내보내기` command.

Right inspector:

- `콘텐츠`: card text and card structure;
- `디자인`: typography, colors, chrome, layers;
- `미디어`: library, global assignment, selected-card assignment, video mode;
- `내보내기`: recent results and diagnostics, also opened by the top command.

Context inspector:

- selecting a layer or semantic item shows its relevant controls first;
- advanced controls are collapsed by default;
- duplicate import and export buttons are removed;
- no card-inside-card visual nesting;
- labels use consistent terms: `가져오기`, `적용`, `해제`, `내보내기`.

## 8. UX Flow

### 8.1 First image/video import

1. User opens `미디어`.
2. User selects `이미지 가져오기` or `영상 가져오기`.
3. Probe/import completes.
4. Assignment sheet asks where to use it.
5. Current assignment is reflected immediately.
6. If video is assigned, video mode and timeline appear.

### 8.2 Photo reel

1. User selects `영상 만들기`.
2. Timeline appears with every card at 3.0 seconds.
3. User adjusts each card duration.
4. User selects `내보내기 > 영상(MP4)`.

### 8.3 Export

1. User selects `내보내기`.
2. User chooses PNG or MP4.
3. Preflight summary appears.
4. Progress identifies the current stage and elapsed time.
5. Success offers folder/open actions; failure offers a concise cause and diagnostic path.

### 8.4 Missing Pro CLI

1. AI panel reports the provider as missing.
2. User selects `설치 안내`.
3. App displays official source, fixed command, prerequisites, and verification.
4. User explicitly selects `설치 실행` or `명령 복사`.
5. A visible terminal performs the fixed recipe.
6. App refreshes provider status after exit.

## 9. Requirements

### R1. Per-card exposure duration

- Edit duration from timeline and inspector.
- Persist and round-trip through save/open and archives.
- Preview and MP4 use the compiled value.
- Total duration differs from expected by no more than one frame.

### R2. Pixel-accurate selection and movement

- Required semantic items have independent, correctly sized boundaries.
- Click does not move.
- Drag does not jump.
- Board, PNG, and MP4 placements agree.

### R3. Beginner-safe media flow

- Import and assignment are visibly distinct.
- New imports offer explicit destinations.
- Selected card and global state are always discoverable.

### R4. Unified Export flow

- Top bar exposes one Export action.
- PNG and MP4 are selected from the same modal.
- Existing PNG quality approval remains available.

### R5. Conditional timeline and photo-reel mode

- Video assignment auto-enables video mode.
- Photo-only projects can explicitly enable it.
- Timeline is hidden in card-only mode and persistent in video mode.

### R6. Bounded MP4 export

- No indefinite `prepare · 10%`.
- Every stage has heartbeat, timeout, cancellation, cleanup, and diagnostics.
- Injected stalls prove failure behavior.

### R7. Safe CLI installation

- Current official recipes are shown in Pro.
- Install is explicit, visible, allowlisted, and verifiable.
- Lite has no install path.

### R8. Real selected-card video preview

- Uploaded supported video shows moving decoded frames.
- Timeline seek changes the visible frame.
- Blank placeholder is a classified error, not success.

### R9. Menu and readability cleanup

- Commands are grouped by task.
- Duplicate media/export actions are removed.
- Keyboard, focus, tooltip, and responsive behavior remain usable.

### R10. Release and rollback

- Shared fixes pass in Lite and Pro.
- Pro-only boundaries pass source and package scans.
- Portable and installed builds pass fresh-profile smoke.
- Clean Windows VM passes install, launch, edit, preview, PNG, MP4, close, uninstall, and residue checks.
- Staged hashes match isolated hashes.

## 10. Implementation Milestones

### M24-0. Forensic RED harness

- capture the attached geometry failure;
- add duplicate-ID, coordinate, click-jump, blank-video, and `prepare 10%` stall probes;
- record current menu and export paths;
- no product fix before RED evidence.

### M24-1. Schema and migration

- add video project mode;
- wire existing scene duration into persistence;
- add provider recipe schema;
- round-trip old and new projects through `DeckDraft`, `Deck`, `DeckPreset`, `WorkspaceState`, archives, Lite sanitizers, and packaged load paths.

### M24-2. Geometry unification

- replace viewport-fixed semantic placement;
- enforce one semantic owner;
- materialize flow geometry once;
- add click threshold, pointer cleanup, and one-gesture history.

### M24-3. Timeline and duration editor

- conditional timeline;
- photo-reel mode;
- timeline duration control;
- total and card selection synchronization.

### M24-4. Media assignment and live preview

- centralized media workflow;
- explicit assignment sheet;
- selected-card live video;
- error and lifecycle cleanup.

### M24-5. Unified export and watchdog

- Export modal;
- stage model;
- heartbeat/watchdog;
- cancellation before spawn;
- diagnostics and cleanup.

### M24-6. Pro CLI installation

- update official recipes;
- fixed IPC allowlist;
- visible terminal and explicit confirmation;
- refresh and verification;
- Lite stripping.

### M24-7. Menu IA, accessibility, and performance

- four inspector groups;
- context-first controls;
- remove duplicates;
- focus order, keyboard, tooltips, and layout checks;
- render-count and interaction-latency profiling.

### M24-8. Full regression and isolated packaging

- M21-M23 regressions;
- Lite/Pro edition/security scans;
- isolated portable and installer builds;
- artifact manifests and hashes.

### M24-9. Packaged QA, staging, and handoff

- fresh profile;
- clean Windows VM;
- install/uninstall residue;
- immutable stage copy;
- append-only handoff.

## 11. Gate and Evidence Contract

Evidence root:

`.omc/evidence/v6/m24-export-media-editor-ux-hardening/`

Each gate creates:

- `{gate}.log`;
- `{gate}.meta.json`;
- relevant screenshots, videos, frame samples, trace JSON, package hashes, or diagnostic bundles.

Every `.meta.json` includes:

- schema version;
- gate ID and requirement/test IDs;
- command and working directory;
- start/end timestamps and duration;
- exit code;
- source commit and dirty-state digest;
- fixture IDs;
- edition;
- machine/OS/display-scale profile where relevant;
- input and artifact hashes;
- assertions;
- `status: pass | fail | blocked | skipped`.

`stale` is not a stored status. A gate runner derives staleness when the evidence commit, dirty-state digest, fixture hash, dependency evidence hash, or packaged source hash differs from the current release candidate. Derived stale evidence is treated as non-pass and cannot be rewritten by a later gate.

Gate order:

1. `G0-workspace-inventory`
2. `G1-red-reproduction`
3. `G2-schema-duration-migration`
4. `G3-geometry-interactions`
5. `G4-media-live-preview`
6. `G5-export-liveness`
7. `G6-cli-safety-lite-stripping`
8. `G7-menu-accessibility-performance`
9. `G8-shared-regression`
10. `G9-lite-source-build`
11. `G10-pro-source-build`
12. `G11-isolated-package`
13. `G12-portable-installed-smoke`
14. `G13-clean-vm-stage-handoff`

A gate runner must refuse to start a later gate unless every prerequisite is `pass`.

## 12. Acceptance Summary

| Area | Release threshold |
| --- | --- |
| Duration | `500..180000ms`, archive round-trip, total within one frame |
| Semantic identity | duplicate IDs = 0; missing required IDs = 0 |
| Geometry | overlay/render edge error <= 2 CSS px |
| Output equivalence | board/PNG/MP4 bbox delta <= 2 output px |
| Click behavior | pointer movement under 4px changes geometry 0 times |
| Drag behavior | initial jump <= 2 CSS px |
| Timeline | visible exactly when video mode is enabled |
| Preview | supported video changes pixels at two seek times |
| Media flow | import and assignment pass all destination scenarios |
| Export liveness | heartbeat gap <= 2s; injected stalls terminate at configured watchdog |
| Cleanup | partial files, temp windows, orphan FFmpeg/renderers = 0 |
| CLI safety | arbitrary command IPC cases accepted = 0 |
| Lite stripping | Pro CLI/install symbols and IPC matches = 0 |
| Packaging | source, portable, installed, VM gates all pass |
| Distribution | staged hashes equal isolated hashes |

## 13. Deliberate Pre-mortem

### Scenario 1: Removing `position: fixed` does not fix the boxes

Cause:

- duplicate semantic owners, stale measurement, anchor conversion, zoom, or DPI still diverge.

Prevention:

- RED matrix isolates each branch;
- item-owner uniqueness is asserted;
- overlay and renderer rectangles are captured in the same coordinate report;
- no release on a delta over tolerance.

### Scenario 2: Export no longer stalls at preflight but stalls later

Cause:

- frame producer initialization, video seek, FFmpeg stdin backpressure, or exit wait blocks.

Prevention:

- one exporter-level stage controller;
- heartbeats from every nested operation;
- fault injection at preflight, producer, first frame, render, encoder, and finalize;
- owned process cleanup assertion.

### Scenario 3: Preview works in development but is blank in the package

Cause:

- `file://`, blob lifetime, MIME, codec, or packaged path differs.

Prevention:

- asset-ID resolver only;
- source, portable, and installed playback tests;
- pixel-change assertion, not DOM-only `<video>` presence.

### Scenario 4: Menu cleanup hides established actions

Cause:

- visual simplification removes discoverability or keyboard access.

Prevention:

- command inventory before edit;
- every command maps to one new location;
- keyboard/focus and first-run scenarios are scripted;
- duplicate actions are removed only after route parity passes.

### Scenario 5: CLI install becomes a shell injection or support problem

Cause:

- renderer-provided command text, hidden terminal, elevation, or stale external command.

Prevention:

- fixed recipe IDs;
- main-process allowlist;
- explicit preview and confirmation;
- official-doc re-verification;
- visible terminal and post-install status check;
- feature stripped from Lite.

### Scenario 6: Source passes but the release remains unsafe

Cause:

- package drift, stale build folder, app.asar leakage, installer-only path failure, or missing VM evidence.

Prevention:

- isolated run IDs;
- immutable hash manifest;
- source/unpacked/app.asar scans;
- portable, installed, and VM gates;
- staging command requires all prior `.meta.json` verdicts.

## 14. ADR

### Decision

Keep the existing DOM/CSS renderer and compiled timeline. Add a single card-relative semantic geometry contract, explicit video project mode, centralized media assignment, unified export UI, a watchdog-backed export state machine, and allowlisted Pro CLI installation recipes.

### Drivers

- preserve existing styles and archives;
- make board, PNG, and MP4 agree;
- address actual user-facing release blockers;
- keep Lite/Pro boundaries explicit.

### Alternatives considered

- retained-mode canvas replacement;
- minimal UI-only patch;
- external video editor integration.

### Why chosen

The chosen path repairs current contracts without introducing another renderer or abandoning the existing timeline and archive model.

### Consequences

- `App.tsx` integration work must be serialized carefully;
- renderer and packaged media readiness need quantitative evidence;
- package validation remains longer than a source-only cycle;
- a later milestone may decompose the inspector and export controller after behavior is locked.

### Follow-ups

- evaluate component extraction after M24 regression coverage exists;
- evaluate optional import transcoding only from unsupported-codec telemetry;
- keep code signing and update delivery separate from feature hardening.

## 15. Execution Staffing Guidance

Available agent types:

- `debugger`: geometry, blank-preview, and export-stall root cause;
- `executor`: domain, UI, renderer, Electron, and scripts;
- `designer`: inspector IA, media assignment, and export modal review;
- `test-engineer`: fault injection, fixtures, browser/package automation;
- `verifier`: source/package/VM evidence audit;
- `code-reviewer`: cross-module and security review;
- `git-master`: milestone commits following the repository's Lore protocol.

Recommended lanes:

1. Geometry/renderer: debugger + executor, high reasoning.
2. Timeline/media UX: executor + designer review, high reasoning.
3. Export/process safety: debugger + executor, high reasoning.
4. CLI/security: executor + code-reviewer, high reasoning.
5. Tests/release evidence: test-engineer + verifier, high reasoning.

`src/ui/App.tsx`, edition entrypoints, and release scripts remain leader-serialized shared files. Disjoint domain/test modules may use `$team`. `$ultragoal` is the default durable execution follow-up; `$ralph` is only an explicit single-owner fallback.

## 16. Definition of Done

M24 is complete only when:

- R1-R10 trace to passing tests;
- G0-G13 all have fresh `pass` metadata;
- the attached geometry scenario passes at required scales and DPI values;
- the selected supported video visibly changes frames in source, portable, and installed builds;
- injected preflight/producer/encoder stalls terminate with cleanup and diagnostics;
- Lite contains no Pro CLI/install path;
- both portable and installer builds pass fresh-profile tests;
- a clean Windows VM passes the full install/export/uninstall scenario;
- staged hashes match isolated hashes;
- `HANDOFF.md` is appended with commands, evidence, artifact paths, limitations, and rollback target;
- prior distributions remain unchanged.

## 17. Suggested Follow-up Command

After RALPLAN Architect and Critic approval, execute from a fresh durable goal:

```powershell
[$ultragoal] .omx/plans/prd-v6-m24-export-media-editor-ux-hardening.md와 .omx/plans/test-spec-v6-m24-export-media-editor-ux-hardening.md를 기준으로 M24-0부터 순서대로 구현해. G0-G13은 선행 gate가 pass일 때만 진행하고, Lite/Pro isolated package와 clean Windows VM 증거가 모두 pass일 때만 새 배포 폴더로 stage해.
```
