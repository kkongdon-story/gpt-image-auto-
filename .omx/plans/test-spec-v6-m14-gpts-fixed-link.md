# Test Spec: V6 M14 Fixed GPTs Shortcut Link

## Scope

Verify that the app uses the official fixed GPTs shortcut URL and no longer exposes or persists a user-editable GPTs URL.

Official URL:

`https://chatgpt.com/g/g-6a4fafccfdd48191a110d48ee497b52a-kadeunyuseu-tempeulrispaeg-jejaggi-by-kkongdon`

## T1. Central URL contract

Command:

```bash
npm run test -- src/domain/externalLinks.test.ts
```

Assertions:

- `gptsTemplateBuilderUrl` equals the official URL.
- `isAllowedGptsTemplateBuilderUrl(gptsTemplateBuilderUrl)` returns true.
- Non-ChatGPT hosts remain rejected.
- If a stricter fixed-link helper is added, it accepts only `gptsTemplateBuilderUrl`.

## T1B. Single production literal check

Command:

```bash
rg -n "g-6a4fafccfdd48191a110d48ee497b52a" src electron scripts
```

Assertions:

- Exactly one production source file contains the official GPTs id literal.
- Tests may import the constant rather than repeating the full URL.

## T2. UI contract

Command:

```bash
npm run test -- src/ui/m13UiContract.test.ts
```

Assertions:

- `data-smoke-role="gpts-shortcut"` still exists.
- `GPTs 열기` exists.
- GPTs URL input placeholder is gone.
- `링크 저장` is gone from the GPTs shortcut section.
- UI imports or references the central URL constant.

## T3. Typecheck

Command:

```bash
npm run typecheck
```

Assertions:

- No stale `gptsTemplateBuilderUrlDraft` state.
- No `AppSettings.gptsTemplateBuilderUrl` type errors.
- Lite and Pro preload APIs still typecheck.

## T4. Settings model regression

Command:

```bash
npm run test -- src/storage/deckStore.test.ts
```

Assertions:

- App settings load/save still works for `pixabayApiKey`.
- App settings load/save still works for `aiDefaultProviderId`.
- Old `gptsTemplateBuilderUrl` does not control runtime behavior.
- Saving Pixabay/API settings does not preserve or rewrite legacy `gptsTemplateBuilderUrl`.
- Selecting an AI provider does not preserve or rewrite legacy `gptsTemplateBuilderUrl`.

## T5. Lite edition stripping

Command:

```bash
node scripts/verify-edition.mjs --edition lite
```

Assertions:

- Lite still strips AI/bulk/project-archive Pro-only surfaces.
- Lite does not strip the shared GPTs shortcut.

## T6. Lite smoke

Command:

```bash
CARDNEWS_SMOKE_ACTION=edition-lite-regression node node_modules/electron/cli.js .
```

Assertions:

- Lite app starts.
- Shared design/content editing remains usable.
- GPTs shortcut presence does not introduce Pro-only leakage.

## T7. Pro smoke

Command:

```bash
CARDNEWS_SMOKE_ACTION=parse-preview node node_modules/electron/cli.js .
```

Assertions:

- Pro app starts.
- Main editor still renders.
- Fixed GPTs shortcut does not affect card parse/render flow.

## T8. Manual QA

Steps:

1. Start the app in dev or packaged-unpacked mode.
2. Open the design/style management panel.
3. Confirm the GPTs URL input is not visible.
4. Confirm there is no GPTs `링크 저장` button.
5. Click `GPTs 열기`.
6. Confirm the app attempts to open:
   `https://chatgpt.com/g/g-6a4fafccfdd48191a110d48ee497b52a-kadeunyuseu-tempeulrispaeg-jejaggi-by-kkongdon`

Evidence:

- Screenshot or smoke log showing the simplified GPTs shortcut.
- Console/smoke evidence of the fixed URL open call if browser opening is mocked.

## T9. Evidence and handoff

Required evidence root:

`.omc/evidence/v6/m14-gpts-fixed-link/`

Note: `.omc/evidence` is intentional for this project. `.omx` is used for plans/context/runtime state.

Required files:

- `typecheck.log`
- `external-links-test.log`
- `single-url-literal-check.log`
- `ui-contract-test.log`
- `storage-settings-test.log`
- `verify-edition-lite.log`
- `lite-smoke.log`
- `pro-smoke.log`
- `manual-qa.md`

Required handoff:

- Append a V6 M14 section to `HANDOFF.md`.
- Include changed behavior, files touched, tests run, and residual risks.
