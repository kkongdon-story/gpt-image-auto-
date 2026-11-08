# Context Snapshot: Lite Open Design + GPTs Template Pack

Date: 2026-07-09
Workflow: $ralplan
Project: gpt-cardnews-auto

## Task Statement

Plan the next change set for:

1. Open all content and design editing features in Lite, while keeping AI and bulk generation locked.
2. Add a complete GPTs creation guide for reference carousel analysis, text-removed background generation, and app-compatible JSON output.
3. Fix the UI grouping bug where controls displayed under "넘김 기호" actually change main card typography.
4. Clarify the roles of "양식 관리" and "스타일 관리".
5. Add a configurable GPTs shortcut URL placeholder in the style management flow.

## Desired Outcome

Users should be able to create/edit cardnews designs in both Lite and Pro with the same content/design UI. Lite remains restricted only for AI-powered workflows and bulk CSV generation/rendering. External GPTs can generate reusable template packs that the app can import safely.

## Grounded Code Facts

- `src/edition/lite/index.tsx:15-19` defines Lite with `editionKind = "lite"`, `hasProTools = false`, and locked message "Pro에서 사용 가능".
- `src/edition/lite/index.tsx:84-100` currently locks image library APIs in Lite.
- `src/edition/lite/index.tsx:103-118` locks bulk CSV functions in Lite.
- `src/edition/lite/index.tsx:120-126` locks project save/load in Lite, which conflicts with "content/design open".
- `src/edition/lite/index.tsx:128-137` locks AI provider/run functions in Lite. This still matches the new product direction.
- `src/domain/cardnews-api.ts:37-72` puts template/style/background/font/workspace operations in `LiteCardnewsApi`.
- `src/domain/cardnews-api.ts:74-89` puts bulk, image library, project import/export, and AI in `ProCardnewsApi`.
- `src/domain/editionFilter.ts:3-63` currently strips `chrome`, `nextHint`, and `overrides` from Lite decks, workspace state, and presets. This conflicts with "content/design open" because these fields carry design controls.
- `src/domain/types.ts:156-205` already models image layers, badge images, next hint images, typography, layers, deck chrome, background images, next hint, and overrides.
- `src/domain/types.ts:320-352` already models deck presets and workspace state with `chrome`, `nextHint`, and `overrides`.
- `src/render-engine/customStyles.ts:33-161` imports style JSON only. It does not import card content/template-pack JSON.
- `src/render-engine/customStyles.ts:169-240` builds a style contract for external AI, but only for style JSON.
- `src/ui/App.tsx:3663-3715` renders the "넘김 기호" controls.
- `src/ui/App.tsx:3716-3781` immediately renders `텍스트 크기`, `굵기`, `기울임`, `자간`, and `행간`, but these call selected card typography update functions, not next-hint update functions.
- `src/domain/types.ts:427-430`, `src/storage/deckStore.ts:1364-1388`, `electron/main.ts:3963-3972`, and `electron/lite-main.ts:456-465` show `AppSettings` currently supports only `pixabayApiKey` and `aiDefaultProviderId`.
- `package.json` scripts include `typecheck`, `test`, `build:lite`, `build:pro`, `dist:win:lite`, and `dist:win:pro`.

## Constraints

- Planning only. Do not implement source changes in this `$ralplan` pass.
- EXE packaging is not requested for this plan.
- Lite/Pro split must stay clear: AI and bulk remain Pro-only; content/design import/edit/export becomes common unless a specific feature is intrinsically AI or bulk.
- Template pack import must not trust arbitrary file paths from JSON.
- External GPTs workflow must not promise exact clone or copyrighted asset extraction. It should produce user-provided or generated clean backgrounds plus structured editable content/style metadata.

## Unknowns

- Final GPTs URL is not available yet. Use a persisted placeholder setting.
- Exact UI label names can be refined during implementation, but the product distinction must be clear:
  - 양식 관리: card structure, text, badges, page count, clean backgrounds, layer placement.
  - 스타일 관리: colors, typography, visual mood, preset theme JSON, GPTs shortcut.

## Likely Touchpoints

- `src/domain/cardnews-api.ts`
- `src/domain/editionFilter.ts`
- `src/domain/types.ts`
- `src/edition/lite/index.tsx`
- `src/edition/pro/index.tsx`
- `electron/lite-main.ts`
- `electron/main.ts`
- `src/storage/deckStore.ts`
- `src/render-engine/customStyles.ts`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `scripts/verify-edition.mjs`
- `.omx/plans/*`
- `docs/*` or a new user-facing guide location
