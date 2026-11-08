# Deep Interview Transcript: V6 M22 Media, Video, Canvas, and AI

## Metadata

- Profile: Standard
- Context: Brownfield Electron/React application
- Rounds: 8 decision rounds plus code/research fact intake
- Threshold: ambiguity <= 0.20
- Final ambiguity: 0.07
- Context snapshot: `.omx/context/m22-media-video-canvas-ai-20260716-103438.md`
- Final status: ready for an implementation PRD and test specification
- Implementation status: not started by this interview

## Initial Request

The user asked for an interview and PRD covering six related improvements.

1. Make per-card image assignment the primary workflow while retaining a global image default.
2. Allow video on each card and export a Shorts-compatible video.
3. Let the footer move to the far right edge.
4. Allow the automatic body-card number to be hidden.
5. Make title, subtitle, body, badge, and footer directly editable on the center canvas.
6. Replace the low-quality fixed AI behavior with a user-editable global instruction that affects CLI results.

## Brownfield Facts

### [from-code][auto-confirmed] Images and storage

- `Deck.backgroundId` is the existing global background selection.
- `CardOverride.backgroundId` already encodes three states: undefined means inherit, null means no background, and a string means a local background.
- The renderer resolves a card override before the global background.
- The present workflow is inconvenient because upload/management is global while card assignment is nested under Content > Design.
- The project archive is version 1 and treats referenced visual assets as backgrounds, even when a custom image layer may originate in the separate image library.

### [from-code][auto-confirmed] Center canvas

- The center stage is a rendered iframe plus a React editing overlay.
- Custom text, shape, line, and image layers can already be selected and transformed.
- Standard title, subtitle, body, badge, and footer are semantic renderer slots and are not yet first-class overlay objects.
- Keeping semantic slots avoids a destructive conversion of all existing projects into free layers.

### [from-code][auto-confirmed] Footer and numbering

- Footer X/Y values exist but are normalized to a fixed pixel offset range, so the footer cannot reliably reach the physical right edge at every aspect ratio.
- Body cards always render an automatically computed `01`, `02`, and so on. No visibility contract exists.

### [from-code][auto-confirmed] AI and editions

- Pro currently prepends a hard-coded Kkongdon system message and hard-coded Kkongdon topic/research/draft prompt kernel.
- Lite has no AI IPC surface and must continue stripping Pro-only AI code.
- Manual content/design editing is already common to Lite and Pro.

### [from-research] Video export feasibility

- Electron offscreen rendering can produce bitmap frames and control frame rate.
- FFmpeg MediaFoundation exposes `h264_mf` on supported Windows systems and can encode in software or hardware mode.
- FFmpeg's own compliance guidance requires avoiding GPL/nonfree configuration for an LGPL distribution and explicitly calls out `libx264` as GPL.
- WebCodecs codec availability depends on the user agent, so it is not a sufficient single release contract for a Windows desktop exporter.

## Interview Rounds

### Round 1 - Final video unit

**Question focus:** whether export means one file per card or one connected Shorts video.

**[from-user] Decision:** Produce one 1080x1920 MP4 that connects all cards vertically as sequential scenes.

**Consequence:** The data model needs a project composition and card-scene timing, not only a video file field on a card.

### Round 2 - Video placement depth

**Question focus:** background-only video versus freely positioned video elements.

**[from-user] Decision:** Support both a full-card background video and freely movable/resizable video layers.

**Consequence:** A card can have one effective background media item plus zero or more video layers.

### Round 3 - Scope pressure pass

**Question focus:** whether this must become a complete video editor.

**[from-user] Decision:** Users will edit source videos in another tool. Cardnews Studio only needs per-scene duration, video in/out range, volume, and basic transitions.

**Pressure-pass finding:** The essence is not timeline editing. It is combining already-edited visual clips with the existing cardnews renderer. Keyframes, effects, filters, captions, and multi-track editing were removed from scope.

### Round 4 - Direct canvas editing boundary

**Question focus:** one or two standard fields versus all visible standard text slots.

**[from-user] Decision:** Title, subtitle, body, badge, and footer must all be clickable, movable, and editable on the center canvas.

**Consequence:** Use a hybrid semantic-slot overlay. Do not convert standard content into arbitrary custom layers.

### Round 5 - AI instruction ownership

**Question focus:** keep the Kkongdon prompt as an editable brand prompt or remove it.

**[from-user] Decision:** Remove the fixed Kkongdon instruction. Rename it to a general default instruction. The current generic cardnews/output guidance becomes the initial value, and the user may edit or reset it.

**Consequence:** Kkongdon brand language must disappear from AI system and workflow prompts. Only immutable app format/security constraints remain internal.

### Round 6 - Audio collision rule

**Question focus:** behavior when multiple videos on one card contain audio.

**[from-user] Decision:** Select one primary audio source per card and automatically mute every other video.

**Consequence:** There is no multi-source audio mixer. Primary audio is explicit and deterministic.

### Round 7 - Automatic body number scope

**Question focus:** global switch, per-card switch, or both.

**[from-user] Decision:** Use a global default plus a per-card `inherit / show / hide` override.

**Consequence:** Existing projects default to visible numbering and keep their current appearance.

### Round 8 - Edition and non-goal closure

**Question focus:** final pressure test of product boundaries.

**[from-user] Decision:** Approved the following boundary.

- Image/video editing and MP4 export are common to Lite and Pro.
- Editable AI default instruction and CLI chat remain Pro-only.
- Exclude automatic captions, filters/effects, keyframes, multi-audio mixing, BGM tracks, screen recording, direct SNS upload, and a full Canva clone.
- Preserve PNG export and old project compatibility.

## Clarity Breakdown

| Dimension | Clarity | Remaining gap |
| --- | ---: | --- |
| Intent | 0.94 | No material gap |
| Outcome | 0.93 | Exact encoder quality values can be selected during implementation within the fixed 1080x1920 contract |
| Scope | 0.94 | Basic transition names may be chosen by the implementation plan |
| Constraints | 0.89 | FFmpeg binary provenance and LGPL release process require a release gate |
| Success criteria | 0.88 | Performance thresholds are specified conservatively in the test spec and may be tuned with measured baseline evidence |
| Brownfield context | 0.98 | No material gap |

Brownfield weighted ambiguity:

```text
1 - (0.94*0.25 + 0.93*0.20 + 0.94*0.20 + 0.89*0.15 + 0.88*0.10 + 0.98*0.10)
= 0.0715
```

## Readiness Gates

- Non-goals explicit: pass
- Decision boundaries explicit: pass
- Earlier answer pressure-tested: pass, Round 3 reduced a full video editor to a scene compositor
- Brownfield facts gathered before implementation decisions: pass
- Another question would materially change implementation: no
- Ready to crystallize: yes

## Decision Boundaries Delegated to Implementation Planning

The implementation plan may choose the following without another user interview as long as the fixed outcomes above are preserved.

- Exact names and icons of media controls.
- The small set of basic transitions, with `none` and `fade` mandatory.
- Default static-card duration and allowed min/max duration.
- Exact MP4 bitrate/quality value within the 1080x1920, 30 fps, H.264/AAC contract.
- Internal normalized coordinate representation and migration helper names.
- Whether a short clip freezes on its final frame or loops; the PRD selects freeze by default to avoid unexpected repetition.
- Evidence file naming beyond the mandatory evidence root.

The implementation plan may not change the edition matrix, output unit, semantic-slot scope, audio rule, old-project compatibility, or non-goals without user approval.

## Handoff Artifacts

- Requirements spec: `.omx/specs/deep-interview-m22-media-video-canvas-ai.md`
- PRD: `.omx/plans/prd-v6-m22-media-video-canvas-ai.md`
- Test spec: `.omx/plans/test-spec-v6-m22-media-video-canvas-ai.md`

