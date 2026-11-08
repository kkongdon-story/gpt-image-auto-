# Deep Interview Context: Reference Carousel JSON Workflow

## Task Statement
Add a workflow where a user captures/saves cardnews carousel reference images from the internet, asks ChatGPT to analyze the images into a sample JSON, then imports that JSON into Cardnews Studio so the generated carousel resembles the reference as closely as possible.

## Desired Outcome
The app should support a reference-image-to-template workflow that can bring over or recreate visual elements such as eyes, logos, decorative marks, yellow borders, tapes, arrows, text blocks, and per-card layout/style decisions from a six-card carousel reference.

## Stated Solution
Use a richer JSON format than the current style-theme JSON. The JSON may include `referenceImage`, `cards[].image`, `backgroundImage`, or similar fields, plus per-card content and style/layout metadata.

## Probable Intent Hypothesis
The user wants non-technical users to benchmark a good carousel design, ask an AI to translate that design into a program-readable template, and then get a close visual starting point inside the app without manually rebuilding every detail.

## Known Facts / Evidence
- Current custom style JSON imports one style preset/theme, not a full carousel package.
- `src/render-engine/customStyles.ts` currently asks external AI for a single style JSON and validates color/font/theme fields.
- Built-in style presets include `usesPhoto`, `pageBackground`, `textBackdrop`, `chromeBackdrop`, `ink`, `accentDefault`, badge styling, font stacks, scrim stops, and related theme fields.
- Current card content import is still based on `양식.md` / card text parsing.
- The app already has an image library and uses ids for background, badge image, next hint image, and image layers.
- Rendering supports background images, per-card background override paths, badge image ids, next-hint image ids, and image layers.
- Project archive/export already understands workspace, presets, styles, backgrounds, and fonts as separate assets.
- Pro has richer image and AI features; Lite should likely lock/strip advanced AI/image extraction according to existing edition split principles.

## Constraints
- Imported JSON must not contain arbitrary local paths from ChatGPT such as `/mnt/data/...` as trusted app assets.
- External image assets should be imported through the app's image/background library and rewritten to internal ids.
- The format must remain safe against CSS/script injection.
- Lite/Pro separation must remain clear.
- The workflow should not promise exact duplication when source images contain copyrighted artwork, logos, or raster-only details that cannot be vectorized reliably.

## Unknowns / Open Questions
- Whether first release should support exact asset extraction/import from the reference screenshots or only a close editable reconstruction.
- Whether the user expects this to be Pro-only or partially available in Lite.
- Whether one JSON should represent a full project package, a reusable template preset, or only a style preset plus card text.
- Whether uploaded reference images should be kept as background images, converted to decorative layers, or used only for AI analysis.
- Whether logo/eye assets should be embedded as image files, SVG-like shapes, or approximated with built-in layers.

## Decision-Boundary Unknowns
- Minimum acceptable similarity target.
- Which elements must be editable after import.
- Which elements may remain raster images.
- Whether legal/safety guardrails should block importing third-party logos or just warn.
- How much the app may decide automatically versus asking the user during import.

## Likely Codebase Touchpoints
- `src/render-engine/customStyles.ts`
- `src/domain/types.ts`
- `src/domain/deckImporter.ts`
- `src/storage/deckStore.ts`
- `src/storage/projectArchive.ts`
- `src/ui/App.tsx`
- `electron/main.ts`
- `electron/lite-main.ts`
- `src/domain/editionFilter.ts`

## Prompt-Safe Initial-Context Summary Status
not_needed
