# V6 M21 Canva-like Editor and Template-bound Bulk Context

Generated: 2026-07-14T11:36:19Z
Mode: `$ralplan` planning only
Workspace: `C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto`

## User outcome

Plan, but do not yet implement, the following improvements:

1. Let the title reach the full top area of the card instead of stopping at the current `-20` vertical limit.
2. Let the footer move on both X and Y axes.
3. Replace the limited point/accent swatches with arbitrary color selection comparable to text color controls.
4. Fix custom text-layer editing so the rendered text and editing text do not overlap and transparent text boxes do not become white while editing.
5. Redesign bulk generation so templates made from custom text boxes can be driven from CSV/Excel, not only fixed header/title/card columns.
6. Add a right-click page menu to the left thumbnail rail for duplicate/delete and related page operations.
7. Add Canva-like `Ctrl+C`, `Ctrl+X`, and `Ctrl+V` behavior for selected text, shape, line, and image layers while preserving normal copy/paste inside text inputs.
8. Add text opacity controls for text-bearing content, with text opacity distinct from whole-element/background opacity.
9. Use Canva's editing flow as an interaction reference without cloning its visual identity.

## Current code facts

### Layout, chrome, layers

- `src/domain/types.ts:77-82`: `CardLayoutOverride.offsetY` is a single content-block Y delta.
- `src/domain/types.ts:94-102`: `ChromeSlotStyle` already has `offsetX` and `offsetY`; footer X is a missing UI surface, not a missing renderer model.
- `src/domain/types.ts:114-133`: every layer already supports whole-layer `opacity`; text layers do not have independent `textOpacity`.
- `src/render-engine/cardTemplate.ts:243-248`: chrome slots render both X and Y transforms.
- `src/render-engine/cardTemplate.ts:323-331`: the full `.content` block uses `translateY(layout.offsetY%)`.
- `src/render-engine/cardTemplate.ts:868-874`: normalization hard-clamps layout Y to `-20..20`.
- `src/ui/App.tsx:3946-3956`: the inspector exposes the same hard-coded `-20..20` slider under the ambiguous label `세로 위치`.

### Text edit defect

- `src/ui/App.tsx:796-807`: the rendered iframe remains visible under the edit overlay.
- `src/ui/App.tsx:826-889`: text-layer selection boxes deliberately render no overlay text, leaving iframe text visible.
- `src/ui/App.tsx:890-917`: text editing adds a textarea over the still-visible iframe text.
- `src/ui/styles.css:741-750`: the textarea forces `rgba(255,255,255,0.92)`, producing the white box in the supplied screenshot.
- `src/render-engine/cardTemplate.ts:513-523`: the production text layer is transparent by default, so edit and render surfaces currently disagree.

### Toolbar and colors

- `src/ui/App.tsx:2994-3099`: M15 already supplies a floating toolbar for selected text layers and card typography. Extend this surface rather than creating a second toolbar.
- `src/ui/App.tsx:3158-3175`: point color only exposes fixed swatches plus reset; arbitrary color input and validated hex entry are absent.
- `src/ui/App.tsx:4020-4032`: selected layers have whole-element opacity, currently limited to 10-100 percent.

### Pages and clipboard

- `src/ui/App.tsx:754-785`: edit-mode keyboard handling supports delete, escape, and arrow nudging only.
- `src/ui/App.tsx:2552-2574`: page add/remove operations are local state mutations and need a shared reindexing transaction before duplicate/insert/delete are expanded.
- `src/ui/App.tsx:2919-2953`: thumbnails have left-click selection only and no context menu or keyboard menu equivalent.

### Bulk generation and edition boundary

- `src/domain/csvBulk.ts:10-33`: CSV v1 is a fixed schema with `header_label`, `footer_account`, `card_01..card_10`, and deck-level style columns.
- `src/domain/csvBulk.ts:35-48`: the sample template is static.
- `src/domain/csvBulk.ts:93-149`: each row creates raw card text and cannot bind a CSV column to an arbitrary layer.
- `src/ui/App.tsx:4608-4647`: bulk generation remains a Pro-only surface.
- Existing V6 product boundary is preserved: manual editing/design improvements are shared by Lite and Pro; bulk generation remains Pro-only and must remain locked/stripped in Lite.

## Recommended product decisions for consensus review

1. Do not merely widen `offsetY` to a larger magic number. Introduce a card-relative position contract with migration from legacy `offsetY`, preserve preview/PNG parity, and label whole-content versus title-only movement explicitly.
2. Add footer X in the inspector using the existing `ChromeSlotStyle.offsetX`; keep old saved projects compatible.
3. Use one reusable color control: preset swatches, native picker, validated `#RRGGBB`, recent colors, and style-default reset.
4. During inline text editing, hide the corresponding iframe text only, match the layer's actual transparent/configured background, and keep Korean IME composition safe. Do not hide all layers or replace the renderer with a second rendering implementation.
5. Introduce template-bound bulk schema v2. A saved template declares stable bindings to standard text slots and arbitrary layer IDs; generated CSV headers come from those bindings. Preserve CSV v1 import as legacy compatibility.
6. Centralize page operations so insert/duplicate/delete atomically reindex card-indexed overrides, preserve stable layer IDs where appropriate, clone layer IDs when duplicating, and keep selection valid.
7. Use an internal layer clipboard. Copy/cut/paste must clone immutable layer data, mint new IDs on paste, offset pasted geometry, clamp to the card, and not intercept keystrokes in textarea/input/contenteditable controls.
8. Add `textOpacity` separately from whole-layer `opacity`; allow 0-100 percent and expose it in the existing floating toolbar and inspector. Standard card typography needs a compatible opacity override with `all/title/body` scope.

## Canva official reference findings

- Add/edit text: selected text boxes use a floating toolbar; duplicate is available from the toolbar and `Ctrl+C`/`Ctrl+V` works after selecting a text box. Source: https://www.canva.com/help/add-and-edit-text/
- Keyboard shortcuts: selected elements support deletion, arrow nudging, arranging, and text formatting. Source: https://www.canva.com/help/canva-keyboard-shortcuts/
- Transparency: transparency applies to text and other selected elements via a toolbar slider/value field. Source: https://www.canva.com/en_gb/help/transparency/
- Page management: page thumbnails support duplicate/delete and page copy/paste behavior. Source: https://www.canva.com/pt_br/help/manage-pages/
- Bulk create: CSV/Excel data updates text, images, and graphics across designs; the useful model is data connected to a designed template rather than fixed app-specific card columns. Sources: https://www.canva.com/fr_be/help/bulk-create-data-autofill/ and https://www.canva.com/newsroom/news/canva-for-work/

## Constraints and non-goals

- Planning artifacts only in this turn. Do not change product code, run packaging, or stage release artifacts.
- Preserve the dirty worktree and all existing user/agent changes.
- No new dependency unless a later approved implementation proves it necessary; native React/DOM controls and current utilities are preferred.
- Do not turn standard title/body slots into freeform layers in this milestone unless review proves that migration is safer than extending their current override model.
- Do not expose Pro bulk behavior in the Lite package. Shared editor features must still pass Lite stripping verification.
- Do not copy Canva branding or layout; only borrow familiar interaction semantics.

## Expected plan artifacts

- `.omx/plans/prd-v6-m21-canva-editor-bulk-bindings.md`
- `.omx/plans/test-spec-v6-m21-canva-editor-bulk-bindings.md`
- `.omx/plans/ralplan-v6-m21-canva-editor-bulk-bindings-consensus.md`

## Required verification shape for later implementation

- Targeted unit/integration tests first, then `npm run typecheck`, `npm test`, `npm run build:lite`, Lite `verify-edition` and regression gates, `npm run build:pro`, Pro regressions, and preview/PNG parity smoke across supported aspect ratios.
- No EXE packaging is part of M21 implementation unless separately requested after source gates pass.
