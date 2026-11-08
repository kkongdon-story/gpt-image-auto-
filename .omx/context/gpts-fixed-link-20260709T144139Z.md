# Context Snapshot: GPTs Fixed Link

## Task Statement

User provided the production GPTs URL:

`https://chatgpt.com/g/g-6a4fafccfdd48191a110d48ee497b52a-kadeunyuseu-tempeulrispaeg-jejaggi-by-kkongdon`

Requested change:

- Do not ask users to type/save the GPTs URL in the program.
- Remove the existing GPTs URL input UI.
- Link directly to the provided GPTs URL.
- Maintain the URL as a central variable so future maintenance is easy.

## Desired Outcome

Cardnews Studio Lite/Pro should show a simple GPTs shortcut action. Clicking it opens the fixed GPTs URL. There should be no visible URL input or "link save" flow.

## Known Facts / Evidence

- Current UI stores a configurable URL in `AppSettings.gptsTemplateBuilderUrl`.
- Current UI state in `src/ui/App.tsx` includes `gptsTemplateBuilderUrlDraft`.
- Current UI section `data-smoke-role="gpts-shortcut"` includes:
  - URL input
  - `링크 저장` button
  - `GPTs 열기` button
- Current `openGptsTemplateBuilder()` reads `settings.gptsTemplateBuilderUrl`.
- `src/domain/externalLinks.ts` owns URL allow-listing for GPTs/external links.
- `AppSettings` currently includes optional `gptsTemplateBuilderUrl`.
- Storage and Electron main/lite validators currently accept `gptsTemplateBuilderUrl`.

## Constraints

- Lite and Pro should share the same fixed GPTs link behavior.
- Existing AI/bulk/project-archive Lite/Pro separation must remain unchanged.
- Do not weaken external-link safety.
- Keep the change narrow; this is a fixed-link cleanup, not a new GPTs workflow.
- Avoid scattering the URL string across UI, Electron, tests, and docs.

## Unknowns / Open Questions

- Whether old `settings.json` files already containing `gptsTemplateBuilderUrl` should be actively cleaned. Recommended: ignore old field rather than writing a migration for this small change.

## Likely Codebase Touchpoints

- `src/domain/externalLinks.ts`
- `src/domain/externalLinks.test.ts`
- `src/domain/types.ts`
- `src/storage/deckStore.ts`
- `electron/main.ts`
- `electron/lite-main.ts`
- `src/ui/App.tsx`
- `src/ui/m13UiContract.test.ts`
- Possible smoke coverage in `electron/main.ts` / `electron/lite-main.ts` if current smoke asserts the old UI.

