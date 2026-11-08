# M22 Interview Context Snapshot

## Request

The user wants an interview followed by an implementation-ready PRD for:

1. A card-first image workflow with an optional global image setting.
2. Per-card video media and a Shorts-compatible video export.
3. Footer movement to the far right edge.
4. An option to hide the automatic body-card number.
5. Direct editing on the center canvas in a Canva-like workspace.
6. A user-editable global AI instruction that affects CLI responses and improves output quality.

## Current Code Facts

- `Deck.backgroundId` is the global background reference.
- `CardOverride.backgroundId` is already a card-level override, including `null` for no background.
- The renderer resolves card override first and global background second.
- The current UI uploads/manages backgrounds in the global Design panel, then selects the card override in Content > Design. The data model is split, but the workflow is not card-first.
- No video asset, timeline, duration, audio, transition, encoder, or MP4 export contract exists in source/package scripts.
- The current center canvas is an iframe plus a React overlay. It directly selects/transforms custom text, shape, line, and image layers. Standard title/subtitle/body slots remain primarily form-driven, apart from limited typography/title placement controls.
- Body cards receive an automatically computed `.big-number` (`01`, `02`, ...) with no visibility setting.
- Footer X/Y exists in `ChromeSlotStyle`, but UI and renderer constrain offsets to `-40..40` pixels, which cannot guarantee edge-to-edge placement for every aspect ratio.
- AI is Pro-only. It serializes a fixed Kkongdon system message plus conversation history to installed Claude/Codex/Gemini CLIs. Fixed topic/research/draft prompts also exist. There is no user-managed global instruction contract yet.
- Lite/Pro share manual editor behavior; AI and bulk generation are Pro-only under the established edition contract.

## Approved Product Decisions

1. Export one sequential `1080x1920`, 30 fps, H.264/AAC MP4 containing every card as a scene.
2. Support both a full-card background video and movable/resizable free video layers.
3. Keep the editor intentionally light: scene duration, clip in/out, volume, one primary audio source, and basic transitions only.
4. Use one primary audio source per card and automatically mute every other video source on that card.
5. Make title, subtitle, body, badge, and footer selectable, movable, and directly editable while keeping them semantic slots.
6. Use a global body-number default plus per-card `inherit / show / hide`.
7. Replace the fixed Kkongdon AI persona with an editable general default instruction. The current generic cardnews/output guidance becomes the reset value.
8. Media editing and MP4 export are common to Lite and Pro. AI instruction editing and CLI chat remain Pro-only.
9. Preserve PNG export, old project loading, and the current static renderer contract.

## Approved Architectural Direction

- Introduce a unified media catalog and resolver while keeping legacy background/image stores readable.
- Use `inherit / none / asset` for card background media, with the card override taking precedence over the global default and the style background as final fallback.
- Store imported media under Electron user data and persist stable IDs, never raw external absolute paths.
- Add optional scene/media/semantic-slot fields so old workspaces remain valid without a destructive migration.
- Add a separate deterministic MP4 composition/export path. Do not turn the existing PNG renderer into a time-aware API.
- Reuse the same card HTML/CSS renderer for static content in preview, PNG, and video frames.
- Use normalized semantic-slot placement for full-card movement, with legacy footer pixel offsets preserved on read.
- Store the editable AI default instruction in Pro settings and prepend it to every supported CLI conversation beneath immutable app safety/format constraints.
- Add project archive v2 media entries while retaining project archive v1 import.

## Explicit Non-goals

- Automatic captions or speech-to-text.
- Video filters, visual effects, keyframes, or a multi-track timeline.
- Multi-source audio mixing, BGM tracks, or an audio editor.
- Screen recording or direct SNS upload.
- Recreating the full Canva product.
- Replacing semantic title/body content with arbitrary free layers.
- Removing PNG or PNG ZIP export.

## Interview Mode

- Standard depth.
- One question per round.
- Stop when ambiguity is at or below 0.20, then create the interview transcript, PRD, and test specification.
- No product implementation or EXE packaging in this interview task.
- Final measured ambiguity: 0.07.
- User approved the final edition and non-goal boundary.
