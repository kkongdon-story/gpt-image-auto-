# Architect Review: V6 M13 Lite Template Pack GPTs, Iteration 2

Date: 2026-07-09
Reviewer role: Architect
Verdict: APPROVE

## Summary

Iteration 1 concerns are resolved. The plan now keeps Lite on manual content/design, workspace, presets, and template-pack flows while keeping full project archive import/export Pro-only. It also separates pure domain parsing from Electron/storage asset internalization and adds the missing security, guide-packaging, and external-link-policy requirements.

## Approved Boundaries

1. Lite scope is narrowed correctly:
   - Lite gets workspace persistence, deck presets, and template-pack import/export.
   - Full project archive import/export remains Pro-only.

2. Domain parser purity is explicit:
   - `src/domain/templatePack.ts` validates and normalizes schema only.
   - Electron/storage owns extraction, decode validation, durable copy, internal ID assignment, and deck/workspace mapping.

3. Archive safety coverage is explicit:
   - zip-slip
   - traversal
   - entry count
   - total uncompressed bytes
   - per-file bytes
   - image decode failure
   - MIME/extension mismatch
   - duplicate names
   - cleanup after failure

4. Guide packaging behavior is explicit:
   - If linked from the app, the guide must be packaged or routed through an already packaged help/manual surface.

5. GPTs shortcut policy is explicit:
   - Reuse existing external-link URL policy.
   - If the GPTs host is not allowed yet, extend the centralized allow-list rather than adding a direct opener.

## Strongest Steelman Antithesis

Option A is still larger than a minimal M13. A safer, faster milestone could open Lite content/design, fix typography grouping, clarify 양식/스타일 labels, and add the GPTs guide as style/template JSON documentation only, deferring zip-based asset import until a later security-focused milestone.

## Tradeoff Tension

The template-pack path is the right product fit for high-fidelity reference reuse, but it creates an untrusted archive boundary. The revised plan mitigates this with parser purity, storage-owned internalization, zip-slip/size/decode/cleanup tests, and no Lite AI/bulk exposure.

## Synthesis

Proceed with Option A, but keep implementation disciplined around:

- pure manifest parser
- centralized Electron/storage import pipeline
- bounded asset import
- existing external-link policy reuse
- Lite-only manual/template flows

## Remaining Required Changes

None for the Architect gate. Ready for Critic review.
