# Architect Review: V6 M15 Editor UX + Image Library M1

Verdict: ITERATE

## Strengths

- The plan correctly identifies the structural typography gap: `CardTypographyOverride` has no `color`, while `CardTextBoxLayer` already has layer-level color.
- Renderer direction aligns with current architecture because generated title/body colors flow through `--ink-title` and `--ink-body`.
- Lite/Pro separation is mostly right: image list/add/preview are shared, while background removal remains Pro-only/locked.
- Button layout diagnosis is grounded: affected sections use generic `.row`, which can wrap into the visible gaps.

## Must-Fix Gaps

1. Define the image delete API boundary precisely.
   - Shared deletion belongs in `LiteCardnewsApi`.
   - It must be wired through both preloads, both Electron mains, and both edition adapters.
2. Split reference-aware deletion into two layers.
   - Storage should own low-level index/file deletion.
   - UI/domain should guard against deleting images referenced by unsaved current editor state.
3. Specify color validation ownership.
   - Accepted format should be explicit, preferably `#RRGGBB`.
   - Storage and renderer must normalize/reject consistently.
4. Strengthen automated tests.
   - Source-string UI contract is not enough.
   - Add tests or helper-level coverage for reference detection and toolbar target semantics.

## Recommended Implementation Sequence

1. Extend domain/API contracts.
2. Add storage primitives.
3. Add renderer color resolution.
4. Add UI controls and toolbar.
5. Replace affected `.row` groups with scoped action grids.
6. Run automated and manual evidence gates.

## Risks

- The toolbar must not imply per-character rich text editing.
- Delete safety depends on unsaved UI state as well as persisted storage.
- Layout tests cannot prove visual spacing alone; manual screenshots remain necessary.
- Lite verification must confirm shared image management remains available while Pro-only features stay locked.
