# Architect Review: V6 M21 Canva-like Editor and Template-bound Bulk

STATUS: REVISE

## Major Findings

The draft chooses the right high-level architecture, but several contracts are still too implicit for implementation handoff. Optional `titlePlacement` is the right minimal direction: current `offsetY` moves the whole `.content` block, not just the title (`src/domain/types.ts:77-82`, `src/render-engine/cardTemplate.ts:323-331`), and both UI/render normalization clamp it to `-20..20` (`src/ui/App.tsx:3946-3956`, `src/render-engine/cardTemplate.ts:868-874`). Do not widen `offsetY`.

The foreground-wrapper plan is also correct. The current iframe remains visible under the edit overlay (`src/ui/App.tsx:796-807`), text boxes render no overlay text while editing (`src/ui/App.tsx:826-889`), the textarea is placed over the rendered glyphs (`src/ui/App.tsx:890-917`), and CSS forces a white background (`src/ui/styles.css:741-750`). The PRD's wrapper approach (`.layer` outer + `[data-layer-text]` inner) is the right joint fix for duplicate text and text-only opacity.

The main blocker is bulk/page metadata precision. Current persistence validates exact `WorkspaceState` and `DeckPreset` shapes (`src/storage/deckStore.ts:1480-1502`, `src/storage/deckStore.ts:1529-1552`), project archives serialize workspace/presets directly (`src/storage/projectArchive.ts:198-201`), and Lite stripping reconstructs allowed fields explicitly (`src/domain/editionFilter.ts:40-74`). A vague "bulk metadata" field will either be dropped, leak, or become untestable.

## Required Revisions

1. Define the exact placement location under `CardLayoutOverride`, preserve `undefined | flow`, and specify card-relative normalization/clamp math.
2. Define `BulkBindingMetadata` with template identity/revision, ordered bindings, stable key, display label, required/default behavior, and typed targets.
3. Preserve inert bulk metadata through Lite load/save while stripping executable Pro UI/handlers.
4. Add an explicit 1-based override/binding reindex table for every page operation and inject deterministic ID/key factories.
5. State that M21 does not implement undo/redo and specify destructive-action mitigation.
6. Define exact CSV row/column/cell/file limits and formula-safe export/import handling.

## Recommended Refinements

- Test storage validators for `titlePlacement`, `textOpacity`, and `bulkBindings`.
- Extend editor toolbar patch types for `textOpacity`.
- Keep binding metadata/sanitization shared while keeping Pro execution imports edition-gated.
- Restore hidden text foreground on blur, cancel, unmount, and selection change.

## Architecture Verdict

REVISE, but the direction is close. Widening `offsetY` and extending CSV v1 would be faster, but both would preserve the structural limitations. Freeze the exact persistence/page/bulk contracts before implementation so they are not improvised inside `App.tsx`.

