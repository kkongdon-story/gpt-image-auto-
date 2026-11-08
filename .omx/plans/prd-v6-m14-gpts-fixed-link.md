# PRD: V6 M14 Fixed GPTs Shortcut Link

## 1. Goal

Replace the configurable GPTs URL workflow with a centrally maintained fixed GPTs shortcut.

Production GPTs URL:

`https://chatgpt.com/g/g-6a4fafccfdd48191a110d48ee497b52a-kadeunyuseu-tempeulrispaeg-jejaggi-by-kkongdon`

The user no longer wants an in-app URL input or save button. The app should simply link to the official GPTs.

## 2. Non-Goals

- Do not change the template-pack import format.
- Do not change Lite/Pro feature boundaries except this shared GPTs shortcut UI.
- Do not add in-app GPTs creation or in-app image analysis.
- Do not package EXEs unless a follow-up execution request explicitly asks for packaging.

## 3. RALPLAN-DR Summary

### Principles

1. One source of truth for the GPTs URL.
2. No user-maintained URL state for a fixed official link.
3. Preserve external-link allow-list safety.
4. Keep Lite and Pro behavior identical for this shortcut.
5. Keep old settings harmless without blocking app startup.

### Decision Drivers

1. Maintainability: the link must be easy to update in one file.
2. UX clarity: users should click "GPTs 열기", not paste a URL.
3. Regression safety: existing settings, AI provider settings, and Lite/Pro checks must not break.

### Viable Options

#### Option A: Central fixed URL constant, remove URL setting and input

Pros:
- Fully matches user request.
- Simplest user experience.
- Centralized maintenance.
- Avoids invalid user-entered links.

Cons:
- Users cannot override the GPTs link inside the app.
- Changing the GPTs link requires a code update.

#### Option B: Keep hidden configurable setting but remove visible input

Pros:
- Allows future override without schema change.
- Less code removal.

Cons:
- Violates the spirit of "기존 입력하는건 없애".
- Leaves unused state and settings complexity.
- Future maintainers may be confused about whether the link is fixed or configurable.

#### Option C: Keep input but prefill official URL

Pros:
- Minimal change.

Cons:
- Directly contradicts the request.
- Still invites broken user-entered URLs.

### Chosen Option

Option A.

## 4. Functional Requirements

### R1. Central URL constant

Add a central exported constant for the official GPTs URL.

Recommended owner:

- `src/domain/externalLinks.ts`

Suggested name:

- `gptsTemplateBuilderUrl`

Acceptance:

- The literal GPTs URL appears in one source file only, excluding tests/docs/plans.
- UI and tests import/use the constant rather than duplicating the string.
- Existing `isAllowedGptsTemplateBuilderUrl` may remain as a host allow-list helper for external-link safety, but runtime GPTs shortcut behavior must use the central fixed URL constant.

### R2. Remove visible URL input flow

Remove the GPTs URL input and save button from the style management UI.

Acceptance:

- No visible `https://chatgpt.com/g/...` input field.
- No `링크 저장` button for GPTs.
- No empty-link disabled state.
- The `GPTs 열기` button is always available.

### R3. Open fixed URL

`GPTs 열기` opens the central fixed URL.

Acceptance:

- Button calls existing external-link opening surface.
- Link still passes GPTs host allow-listing.
- Failure still appears as a status message if external open fails.

### R4. Remove settings field from app model

Remove `gptsTemplateBuilderUrl` from `AppSettings` as active state.

Acceptance:

- `AppSettings` contains only settings still edited or used by the app.
- UI no longer initializes or stores `gptsTemplateBuilderUrlDraft`.
- `saveSettings` calls preserve other settings such as `pixabayApiKey` and `aiDefaultProviderId`.
- `savePixabayKey` and `selectAiProvider` no longer preserve, rewrite, or depend on `gptsTemplateBuilderUrl`.
- If an old `settings.json` contains `gptsTemplateBuilderUrl`, the field does not affect the `GPTs 열기` target.

Implementation note:

- Old on-disk settings may contain `gptsTemplateBuilderUrl`. The app can ignore unknown fields by sanitizing settings on load or by accepting the old field but not exposing it. Prefer sanitizing to a known settings shape if the current storage helper can do so safely.

### R5. Preserve Lite/Pro shared behavior

The shortcut appears in both Lite and Pro if the style management panel appears in both editions.

Acceptance:

- Lite edition stripping does not remove the GPTs shortcut.
- Pro behavior matches Lite behavior for this shortcut.

## 5. UX Copy

Replace configurable-link copy with fixed-link copy:

- Section title/hint: `GPTs 템플릿팩 제작기`
- Help text: `레퍼런스 이미지를 템플릿팩 ZIP으로 바꾸는 공식 GPTs를 엽니다.`
- Button: `GPTs 열기`

No URL input should be shown.

## 6. Test Requirements

Covered in:

- `.omx/plans/test-spec-v6-m14-gpts-fixed-link.md`

Minimum verification:

- Typecheck
- Targeted tests for external link constant/allow-list
- UI contract test that no GPTs input/save button remains
- Static check that the official URL literal appears in exactly one production source file
- Regression check that old `gptsTemplateBuilderUrl` settings cannot influence the runtime shortcut target
- Lite edition verification
- Lite and Pro smoke or targeted DOM smoke if available

Evidence convention:

- This project uses `.omc/evidence/...` for verification logs, while `.omx/...` stores plans/context/runtime state. M14 evidence should therefore be stored under `.omc/evidence/v6/m14-gpts-fixed-link/`.

## 7. ADR

### Decision

Use a fixed, centrally exported GPTs URL and remove user-configurable GPTs URL settings from active UI/state.

### Drivers

- User explicitly provided a final GPTs URL.
- User requested link connection, not in-app URL entry.
- Central variable reduces maintenance cost.

### Alternatives Considered

- Hidden configurable setting: rejected because it preserves obsolete state and ambiguity.
- Prefilled input: rejected because it keeps the input flow the user asked to remove.

### Consequences

- Future GPTs URL changes require editing the central constant and rebuilding.
- Existing old settings files may contain a stale GPTs URL, but it should no longer affect runtime behavior.

### Follow-ups

- After implementation and verification, update `HANDOFF.md`.
- If release distribution is needed, run the existing Lite/Pro release gates after this change.

## 8. Suggested Follow-up Command

```text
[$ultragoal]
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m14-gpts-fixed-link.md 와
.omx/plans/test-spec-v6-m14-gpts-fixed-link.md 기준으로 구현해.
GPTs URL은 src/domain/externalLinks.ts 같은 중앙 상수로 유지하고,
스타일 관리의 GPTs URL 입력/저장 UI와 AppSettings 저장 흐름을 제거해.
Lite/Pro 검증과 HANDOFF.md append-only 갱신까지 완료하고, EXE 패키징은 하지 마.
```

## 9. RALPLAN Consensus Gate

Status: complete.

Planning artifacts:

- Context snapshot: `.omx/context/gpts-fixed-link-20260709T144139Z.md`
- PRD: `.omx/plans/prd-v6-m14-gpts-fixed-link.md`
- Test spec: `.omx/plans/test-spec-v6-m14-gpts-fixed-link.md`

Architect review:

- Verdict: APPROVE
- Summary: Option A is architecturally sound because the user wants a fixed official GPTs shortcut. Centralizing the URL in `src/domain/externalLinks.ts`, removing mutable app URL state, and routing through the existing external-link IPC preserves safety. Architect requested sharper checks for single production literal, legacy settings non-influence, and save-setting flows; those were added.

Critic review:

- Verdict: APPROVE
- Summary: No must-fix issue found. The plan is clear, scoped, verifiable, covers Lite/Pro behavior, legacy settings risk, `savePixabayKey`, `selectAiProvider`, storage/Electron validators, and avoids EXE packaging.

Consensus decision:

- Proceed with Option A: fixed central GPTs URL, no visible URL input/save flow, old settings harmless and ignored.
