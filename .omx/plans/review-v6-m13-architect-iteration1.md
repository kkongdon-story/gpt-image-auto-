# Architect Review: V6 M13 Lite Template Pack GPTs, Iteration 1

Date: 2026-07-09
Reviewer role: Architect
Verdict: ITERATE

## Summary

The product direction is architecturally sound:

- Lite should become a manual editor plus template importer.
- Pro should remain the edition for AI and bulk generation.
- External GPTs should produce deterministic template packs that the app imports.

The plan requires revision before Critic review because two architecture boundaries were too broad:

1. Lite template/workspace import must not be confused with Pro project archive import/export.
2. Pure domain schema parsing must not be confused with storage-owned asset extraction, validation, copying, and internal ID assignment.

## Required Revisions

1. Replace broad "project save/load" wording with workspace persistence, deck presets, and template-pack import/export. Full project archive import/export stays Pro-only unless explicitly reclassified.
2. Split template-pack responsibilities: `src/domain/templatePack.ts` validates and normalizes only; Electron/storage opens packages, validates assets, copies files, assigns internal IDs, and returns workspace/deck updates.
3. Expand import security tests for zip-slip, size limits, entry count, decode failure, MIME/extension mismatch, duplicate asset names, and cleanup after failure.
4. If the GPTs guide is linked from the app, packaging/help-link requirements must be explicit.
5. Reuse the existing external-link URL policy for the GPTs shortcut.

## Strongest Antithesis

Option A may be too much scope for M13. A narrower plan could rename UI sections, unlock Lite design controls, add a GPTs guide that emits existing style JSON plus 양식.md, and defer zip/template-pack import. This would ship faster and avoid a new untrusted binary import surface.

## Tradeoff Tension

The desired visual fidelity needs clean backgrounds and assets, but importing asset packages creates a heavier security and storage boundary than text/style JSON import.

## Synthesis

Keep Option A, but phase it as a minimal v1 template-pack:

- strict schema
- bounded assets
- no full project archive reuse
- no arbitrary paths
- no in-app OCR or AI
- storage-owned asset internalization

This preserves Lite usefulness without exposing AI/bulk or unsafe archive behavior.
