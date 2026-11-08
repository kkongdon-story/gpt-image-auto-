# PRD: V6 M13 Lite Open Design + GPTs Template Pack

Status: Approved by RALPLAN consensus
Date: 2026-07-09
Planning mode: `$ralplan`
Implementation scope: Not started

## 1. Requirements Summary

### R1. Lite opens content and design editing

Lite and Pro should share the same card creation surface for content and design:

- Content tab editing
- Design tab controls
- Header/footer/page number controls
- Badge controls
- Next hint controls
- Typography controls
- Background selection
- Layer controls for text, shape, line, and image
- Template/style import where the imported artifact is not AI execution or bulk generation

Lite remains locked for:

- AI provider discovery and AI chat/run flows
- Bulk CSV/template generation and bulk rendering
- Any future automated AI image generation or automated background removal unless explicitly reclassified

Product rule: Lite is a manual editor plus template importer. Pro is Lite plus AI and production-scale automation.

### R2. Move shared design capabilities out of Pro-only API boundaries

The current API split blocks several design features in Lite. The edition API should be reclassified:

- Common/Lite API should include image import/list/preview where needed for backgrounds, badges, next hints, and image layers.
- Common/Lite API should include workspace persistence, deck presets, and template-pack import.
- Full project archive import/export remains Pro-only unless the product explicitly reclassifies it in a later plan.
- Pro-only API should keep AI, bulk, and automated background-removal actions.

The implementation must update edition stripping so Lite preserves design state:

- Preserve `chrome`
- Preserve `nextHint`
- Preserve `overrides`
- Preserve card layers
- Preserve background, badge, and next-hint image references when they point to internally stored app assets

### R3. Add GPTs template-pack workflow

The app should support a new external-GPT workflow:

1. User gives one or more reference carousel images to a custom GPTs.
2. GPTs analyzes visual structure and writes an app-compatible template pack.
3. GPTs also produces text-removed clean background images for each referenced card when needed.
4. User imports the pack into Lite or Pro.
5. App creates an editable deck with real text fields, badges, backgrounds, style settings, and layer positions.

This is not "upload an image and OCR it inside the app". The app consumes a deterministic package produced outside the app.

Recommended package shape:

```text
kkongdon-template-pack.zip
  template.json
  backgrounds/
    card-01-clean.png
    card-02-clean.png
  assets/
    eye-mark.png
    tape-corner.png
```

Recommended `template.json` shape:

```json
{
  "schema": "kkongdon.cardnews.template-pack.v1",
  "name": "Reference Style Recruit Cards",
  "source": {
    "kind": "reference-carousel",
    "cardCount": 2,
    "notes": "Clean backgrounds generated externally."
  },
  "style": {
    "name": "Black Yellow Recruit",
    "usesPhoto": true,
    "pageBackground": "#111111",
    "ink": "#ffffff",
    "inkSub": "#f5f5f5",
    "accentDefault": "#ffd23c",
    "fontTitle": "\"Pretendard\", \"Noto Sans KR\", sans-serif",
    "fontBody": "\"Pretendard\", \"Noto Sans KR\", sans-serif"
  },
  "chrome": {
    "header": "MONEY NOTE",
    "footer": "kkongdon_story",
    "pageFormat": "{n} / {total}"
  },
  "cards": [
    {
      "type": "cover",
      "backgroundImage": "backgrounds/card-01-clean.png",
      "badge": "looking for",
      "title": "모집 타이틀",
      "subtitle": "함께 성장할 사람을 찾습니다.",
      "layers": [
        {
          "kind": "shape",
          "role": "corner-tape",
          "x": 0,
          "y": 0,
          "width": 24,
          "height": 8,
          "color": "#ffd23c",
          "rotation": -18
        }
      ]
    },
    {
      "type": "body",
      "backgroundImage": "backgrounds/card-02-clean.png",
      "title": "모집요강",
      "body": [
        "모집분야 | 함께 나누고 성장할 사람",
        "모집대상 | 관심 있는 누구나"
      ]
    }
  ]
}
```

Implementation may refine field names, but it must keep the same product contract:

- `style` is visual theme.
- `cards[]` is editable content and per-card layout.
- local package asset paths are relative to the zip root.
- no absolute paths or `..` traversal are accepted.
- missing or oversized assets fail with a user-facing error.
- archive entry count, total uncompressed size, and per-file size are bounded.
- zip-slip entries and path traversal are rejected before extraction/copy.
- image files are decoded and validated before being stored.
- MIME/extension mismatches and duplicate asset names fail with a clear error.
- failed imports clean temporary extraction/copy state.

Template-pack v1 limits:

- `MAX_CARDS`: 50
- `MAX_ARCHIVE_ENTRIES`: 200
- `MAX_TEMPLATE_JSON_BYTES`: 512 KiB
- `MAX_TOTAL_UNCOMPRESSED_BYTES`: 120 MiB
- `MAX_ASSET_BYTES`: 20 MiB per image/asset file
- `MAX_IMAGE_PIXELS`: 36,000,000 decoded pixels per image
- `MAX_IMAGE_SIDE`: 8,000 px per width or height
- `ALLOWED_MANIFEST_PATH`: exactly `template.json`
- `ALLOWED_ASSET_ROOTS`: `backgrounds/`, `assets/`
- `ALLOWED_IMAGE_EXTENSIONS`: `.png`, `.jpg`, `.jpeg`, `.webp`

### R4. Create GPTs builder guide

Add a complete guide for creating the external GPTs. The guide must include:

- GPTs purpose and exact user flow
- Inputs the GPTs should accept: one image, many images, optional notes, optional brand values
- Reference analysis checklist: layout, hierarchy, color, typography, spacing, recurring symbols, page count logic
- Text-removal background generation instructions
- App JSON/template-pack schema
- Quality rules: editable text must stay text, decorative elements should become app layers when possible, complex visual decorations can become clean background assets
- Asset naming rules
- Safety and copyright caution: similar structure, not exact unauthorized asset reproduction
- Example prompt a user can paste into GPTs
- Example output package manifest
- How Lite and Pro import the result

The guide should be a user-facing HTML file or a linked HTML page in the docs/manual area, because the user asked for guide material that can be consumed outside the codebase.

### R5. Fix "넘김 기호" UI grouping

The controls currently shown under "넘김 기호" include `텍스트 크기`, `굵기`, and `기울임`, but these controls update main typography. The UI must make the grouping clear:

- `넘김 기호` section only controls next-hint display mode, image asset, and image height.
- Main typography controls move under a visible `타이포그래피` section or an equivalent label.
- Labels must match behavior.
- If any next-hint text styling exists later, it must be clearly labeled as next-hint styling and wired to next-hint state.

### R6. Clarify "양식 관리" vs "스타일 관리"

The app should explain this distinction through labels, section headings, helper text, and import affordances:

- `양식 관리`: card count, card type, title/subtitle/body/badge/source, page structure, clean background assignment, layer placement, reusable template-pack import.
- `스타일 관리`: color palette, typography mood, font family, accent, background mood, border/chrome visual style, style JSON import/export, GPTs shortcut link.

The UI should not imply that style JSON changes card text. Style JSON changes visual rules. Template-pack JSON changes card structure and content.

### R7. Add configurable GPTs shortcut URL

Add an app setting for the future GPTs shortcut URL.

Suggested setting:

```ts
gptsTemplateBuilderUrl?: string
```

Requirements:

- Default is empty.
- Style management tab shows a GPTs shortcut area.
- If URL is empty, button is disabled or shows "GPTs 링크 미설정".
- If URL is a valid allow-listed HTTPS URL, the button opens it through the existing external-link mechanism.
- Invalid, non-HTTPS, or non-allow-listed URLs are rejected or not persisted.
- Works in Lite and Pro.

## 2. Non-goals

- Do not package EXE files in M13.
- Do not add in-app GPT image generation in M13.
- Do not add in-app OCR of source screenshots in M13.
- Do not promise exact clone fidelity from a copyrighted reference.
- Do not make AI available in Lite.
- Do not make bulk CSV generation/rendering available in Lite.

## 3. RALPLAN-DR Summary

### Principles

1. Edition clarity: Lite is manual creation plus template import; Pro adds AI and scale automation.
2. Editable output first: text should become editable fields, not baked into images.
3. Safe import: all external packages are validated, bounded, and copied into app-controlled storage.
4. User-facing clarity: labels must describe what the control actually changes.
5. GPTs separation: GPTs prepares structured assets; the app imports and renders deterministically.

### Decision Drivers

1. The user wants Lite to feel useful without exposing Pro AI/bulk value.
2. Reference carousel reuse needs higher visual quality than shape-only reconstruction can provide.
3. The current UI/API split creates confusion because design controls and fields are partly locked or mislabeled.

### Viable Options

#### Option A: Template-pack import plus external GPTs guide

Approach: Build a safe import format for `template.json` plus clean background/assets, expose it in both Lite and Pro, and document how GPTs should generate it.

Pros:

- Solves the quality bottleneck by allowing complex decorations to come in as clean backgrounds/assets.
- Keeps text editable in the app.
- Works in Lite without enabling AI in Lite.
- Keeps implementation deterministic and testable.

Cons:

- Requires the user to create or use a GPTs outside the app.
- Quality depends on the GPTs' ability to create clean backgrounds.
- Needs careful validation and error messages.

#### Option B: Pure JSON only, no image assets

Approach: GPTs produces only style/theme JSON and the app recreates all decoration using shapes, lines, and text layers.

Pros:

- Simpler import format.
- Lower security surface because no binary assets are imported.

Cons:

- Decorative fidelity will often be poor.
- Complex visual motifs such as tape, marks, cutouts, and photo-like backgrounds cannot be reproduced well.
- Does not address the user's quality concern.

#### Option C: In-app AI reference analysis and background generation

Approach: Add AI/image-generation directly to Pro and generate template JSON plus clean backgrounds inside the app.

Pros:

- Most integrated user experience.
- Could automate more steps later.

Cons:

- Much larger scope.
- Requires model credentials, long-running job UX, cost controls, and more safety work.
- Not suitable for Lite under the current edition policy.

Chosen direction: Option A.

## 4. Acceptance Criteria

### AC1. Lite content/design parity

- In Lite, content and design tabs are usable without Pro lock overlays.
- In Lite, `chrome`, `nextHint`, `overrides`, and layers survive save/load/import.
- In Lite, workspace persistence, deck presets, and template-pack import are usable where they support manual creation.
- In Lite, full project archive import/export remains Pro-only.
- In Lite, AI and bulk controls remain locked or hidden with a clear Pro-only label.
- Pro behavior remains unchanged or superset-compatible.

### AC2. Edition filter updated safely

- Lite strip/verify logic no longer removes manual design fields.
- Lite strip/verify logic still removes or blocks AI, bulk, and full project archive runtime APIs.
- `scripts/verify-edition.mjs --edition lite` proves Pro-only AI/bulk/project-archive paths are not bundled or callable in Lite.

### AC3. Template-pack import works in Lite and Pro

- A one-card template pack imports successfully.
- A multi-card template pack imports successfully.
- Imported backgrounds/assets are copied to app-controlled storage and referenced by internal IDs.
- Imported text, badge, footer, header, style, backgrounds, and layers render in preview.

### AC4. Template-pack import is safe

- Reject package paths containing `..`, absolute paths, or unsupported file extensions.
- Reject missing referenced assets.
- Reject packages above configured size limits.
- Reject invalid schema versions with a clear error.
- No imported path is read from outside the zip/package root.
- Entry count, manifest size, total uncompressed size, per-file size, image pixel, and image side limits are enforced with the constants in R3.
- Zip-slip paths are rejected before extraction/copy.
- Image decode validation is required before storing assets.
- Temporary files and partial copied files are cleaned after failed validation.

### AC5. GPTs builder guide exists

- Guide is available as an HTML document or linked docs artifact.
- Guide contains reference analysis, text-removal background generation, app JSON schema, packaging, examples, quality rules, and Lite/Pro usage.
- Guide explicitly says editable text should stay out of background images.
- If linked from inside the app, the guide is included in packaged app resources or routed through an already packaged help/manual surface.

### AC6. Next-hint and typography controls are visually separated

- `넘김 기호` controls only affect next-hint state.
- `텍스트 크기`, `굵기`, `기울임`, `자간`, `행간`, and `타이포 적용 범위` appear under `타이포그래피` or equivalent.
- Automated UI test verifies the grouping text and state update target.

### AC7. 양식 관리 and 스타일 관리 are distinct

- UI copy explains what each manager changes.
- Template-pack JSON import is surfaced as `양식` or `템플릿` import.
- Style JSON import remains under style management.
- User can tell which GPT output belongs where.

### AC8. GPTs shortcut URL setting

- Setting persists across app restart.
- Empty URL disables or neutralizes the shortcut button.
- Valid URL opens externally only when it is HTTPS and allowed by the centralized external-link policy.
- M13 extends the centralized policy for GPTs shortcut hosts: `chatgpt.com` and `chat.openai.com`.
- Invalid, non-HTTPS, or non-allow-listed URLs are rejected.
- The shortcut reuses the app's existing external-link URL policy instead of introducing a second allow-list.
- During execution, centralize duplicated external-link URL checks from `electron/main.ts` and `electron/lite-main.ts` into one shared helper if practical.
- Works in Lite and Pro.

## 5. Implementation Plan

### Step 1. Reclassify edition feature matrix

Touchpoints:

- `src/domain/cardnews-api.ts`
- `src/edition/lite/index.tsx`
- `src/edition/pro/index.tsx`
- `src/domain/editionFilter.ts`
- `scripts/verify-edition.mjs`

Actions:

- Define "manual design" APIs as common.
- Keep AI and bulk APIs as Pro-only.
- Move workspace persistence, deck presets, safe image import/list/preview, and template-pack import to common/Lite if they are needed for manual design/template-pack work.
- Keep full project archive import/export Pro-only in M13.
- Template-pack export is out of M13 scope and should be planned separately if needed.
- Keep automatic background removal Pro-only unless product explicitly reclassifies it later.
- Update edition verification fixtures to reflect the new policy.

### Step 2. Add template-pack domain schema and parser

Touchpoints:

- New `src/domain/templatePack.ts`
- New `src/domain/templatePack.test.ts`
- `src/domain/types.ts`

Actions:

- Define `TemplatePackManifest` and validation helpers.
- Support 1..N cards.
- Normalize relative asset paths.
- Validate schema version and bounds.
- Keep this module pure: no filesystem reads, extraction, storage writes, or internal ID assignment.
- Return normalized manifest/card/style/layer references with safe relative asset paths.

### Step 3. Add import pipeline in Electron/storage

Touchpoints:

- `electron/main.ts`
- `electron/lite-main.ts`
- `src/storage/deckStore.ts`
- `src/domain/cardnews-api.ts`

Actions:

- Add `importTemplatePack` IPC/API to Lite and Pro.
- Select `.zip` or folder input.
- Apply archive safety limits before extraction/copy: entry count, total uncompressed bytes, per-file bytes, supported extension list, and duplicate path checks.
- Use the R3 constants for all archive and image bounds.
- Reject zip-slip, absolute, traversal, missing, or unsupported asset paths.
- Extract to a temporary safe location only after initial archive checks.
- Validate manifest before copying.
- Decode images before accepting them.
- Check duplicate asset names after path normalization, including case-normalization behavior on Windows.
- Copy referenced backgrounds/assets into app storage and assign internal IDs in the storage/import layer.
- Map normalized manifest references to `Deck`, `CardContent`, `DeckChrome`, `DeckPreset`, `CardOverride`, and internal background/image IDs after storage succeeds.
- Return imported workspace/deck state.
- Clean temporary extraction directories and partial copied files on failure.

### Step 4. Add UI for 양식 관리 and 스타일 관리

Touchpoints:

- `src/ui/App.tsx`
- `src/ui/styles.css`

Actions:

- Rename or clarify UI areas:
  - `양식 관리`: import template pack, card content structure, clean backgrounds.
  - `스타일 관리`: import/export style JSON, palette/font/mood, GPTs shortcut.
- Add explanatory helper text that is short and concrete.
- Keep Pro-only labels only on AI/bulk features.

### Step 5. Fix next-hint/typography grouping

Touchpoints:

- `src/ui/App.tsx`
- `src/ui/styles.css`
- UI tests/smoke scripts

Actions:

- Close the `넘김 기호` section after display mode/image/image height.
- Introduce an explicit `타이포그래피` group before `텍스트 크기`, `굵기`, `기울임`, `타이포 적용 범위`, `자간`, `행간`, `밝기`, `대비`, and `채도` if those affect typography/render adjustments.
- Ensure next-hint image height remains wired to `updateSelectedNextHint`.
- Ensure main typography sliders remain wired to `updateSelectedTypography`.

### Step 6. Add GPTs shortcut setting

Touchpoints:

- `src/domain/types.ts`
- `src/storage/deckStore.ts`
- `electron/main.ts`
- `electron/lite-main.ts`
- `src/ui/App.tsx`

Actions:

- Add `gptsTemplateBuilderUrl?: string` to `AppSettings`.
- Extend settings validators.
- Add UI input/button in style management.
- Use the existing external URL opener and URL allow-listing policy.
- Persist and reload setting.

### Step 7. Add GPTs builder guide

Touchpoints:

- New `docs/gpts-template-pack-builder-guide.html`
- Optional link from app manual/help area

Actions:

- Write a full guide for custom GPTs creation.
- Include ready-to-copy GPTs instructions.
- Include schema examples for style-only JSON and template-pack JSON.
- Include background generation prompt guidance.
- Include Lite/Pro import instructions.
- If the guide is reachable from the app, update the packaged help/manual resource path so installed Lite/Pro builds can open it.
- If the guide is linked from the app, keep a packaging test mandatory.

### Step 8. Verification and evidence

Touchpoints:

- `.omc/evidence/v6/m13-lite-template-pack-gpts/`
- `HANDOFF.md`

Actions:

- Record command logs and manual QA screenshots.
- Append HANDOFF with changed policy and remaining caveats.

## 6. Verification Commands

Run after implementation:

```bash
npm run typecheck
npm run test -- src/domain/templatePack.test.ts
npm run test
node scripts/verify-edition.mjs --edition lite
npm run build:lite
npm run build:pro
```

Recommended manual smoke:

```bash
npm run dev
```

Manual scenarios:

- Lite: open app, confirm content/design controls are usable.
- Lite: confirm AI and bulk are locked.
- Lite: import one-card template pack.
- Lite: import multi-card template pack.
- Pro: confirm AI/bulk still available.
- Pro: import same template packs.
- Adjust next-hint image height and confirm only next hint changes.
- Adjust typography size/weight and confirm main text changes.
- Set GPTs URL, restart app, confirm shortcut remains.

## 7. Risks and Mitigations

### Risk: Lite accidentally exposes Pro AI/bulk

Mitigation:

- Keep AI and bulk in Pro-only API surfaces.
- Keep full project archive import/export in Pro-only API surfaces for M13.
- Extend `verify-edition.mjs` to scan for AI/bulk/project-archive leakage while allowing common manual design/template-pack APIs.
- Add Lite regression tests.

### Risk: Imported package reads files outside package root

Mitigation:

- Reject absolute paths and traversal.
- Normalize paths before use.
- Copy only validated files from extraction root.
- Check archive entries for zip-slip before extraction/copy.
- Enforce entry count, uncompressed-byte, and per-file limits.
- Decode images before copying them into durable storage.
- Cleanup temp files and partial copies after import failures.

### Risk: Template pack schema becomes too large or vague

Mitigation:

- Start with a small v1 schema.
- Accept `layers` only for known layer kinds.
- Ignore unknown optional fields only when safe.

### Risk: GPTs-generated backgrounds include text

Mitigation:

- Guide instructs GPTs to remove all text from backgrounds.
- App cannot guarantee external image quality, but manual preview makes it visible.
- Keep text editable in `cards[]` as the source of truth.

### Risk: UI labels remain ambiguous

Mitigation:

- Add UI tests and screenshots that show sections.
- Use labels based on behavior, not implementation jargon.

## 8. ADR

### Decision

Adopt an external GPTs-generated template-pack workflow and open Lite content/design editing while keeping AI and bulk generation Pro-only.

### Drivers

- Lite should be useful for manual card creation and template reuse.
- Pro should retain AI and scale automation value.
- Reference carousel recreation needs clean background assets for quality.
- The app should import deterministic data rather than run uncontrolled image generation internally.

### Alternatives Considered

- Pure style JSON only: rejected because it cannot preserve complex visual decoration quality.
- In-app AI image/reference generation: deferred because it is broader, Pro-only by nature, and requires more reliability/cost/safety work.
- Keep Lite design locked: rejected because the user wants Lite to be a real editor and only AI/bulk should be locked.
- Reclassify full project archive import/export as Lite: rejected for M13 because it weakens the current Pro boundary and conflicts with existing edition verification. Lite gets template-pack/workspace/preset flows instead.
- Minimal no-zip M13: deferred because it would not solve the user's visual-fidelity bottleneck; its lower risk is acknowledged, but the chosen v1 keeps zip import bounded with strict constants and tests.
- Template-pack export in M13: deferred because the user needs GPTs-to-app import first, and export needs a separate schema/asset ownership contract.

### Why Chosen

The template-pack approach preserves editable text while allowing high-quality visual backgrounds and decorations. It is testable, safe to validate, and compatible with both Lite and Pro.

### Consequences

- The app needs a new import schema and validation surface.
- The docs/manual need to teach the user which GPTs output belongs to 양식 versus 스타일.
- Some previously Pro-only APIs must be reclassified as common manual design APIs.
- Full project archive import/export remains Pro-only; Lite gets a narrower template-pack/workspace path.
- Template-pack export is not part of M13.
- Domain parsing stays pure; Electron/storage owns asset internalization.

### Follow-ups

- Later Pro milestone may add in-app AI-assisted template-pack generation.
- Later QA can compare imported template-pack renders against reference images.
- Later guide can include downloadable sample GPTs instructions and sample zip packs.

## 9. Available Agent Types Roster

Recommended roles for execution:

- `executor`: implement API/UI/storage changes.
- `test-engineer`: add schema, edition, and UI tests.
- `designer`: review IA labels for 양식 관리 and 스타일 관리.
- `verifier`: run Lite/Pro gates and validate evidence.
- `critic`: final pre-handoff review.

## 10. Follow-up Staffing Guidance

Recommended default: `$ultragoal` for durable sequential completion.

Recommended for speed: `$ultragoal` plus `$team`.

Team lanes:

- Lane 1, executor, medium reasoning: edition matrix and API reclassification.
- Lane 2, executor, medium reasoning: template-pack parser/storage/import pipeline.
- Lane 3, designer or executor, medium/high reasoning: UI IA, typography grouping, GPTs URL setting.
- Lane 4, test-engineer, medium reasoning: tests, verify-edition, smoke scripts.
- Lane 5, writer, high reasoning: GPTs builder guide and user-facing documentation.

`$ralph` fallback:

- Use only if the user explicitly wants one persistent owner to implement and verify this full plan sequentially.

## 11. Launch Hints

Suggested implementation prompt:

```text
[$ultragoal]
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m13-lite-template-pack-gpts.md 와
.omx/plans/test-spec-v6-m13-lite-template-pack-gpts.md 기준으로 구현해.
Lite는 콘텐츠/디자인 기능을 열고 AI/벌크만 잠가.
템플릿팩 import, GPTs 제작 가이드, 넘김 기호/타이포그래피 UI 분리,
양식/스타일 관리 기능 분류, GPTs URL 설정을 구현해.
EXE 패키징은 하지 말고 Lite/Pro 검증과 HANDOFF.md 갱신까지 완료해.
```

Suggested team prompt:

```text
[$team]
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m13-lite-template-pack-gpts.md 와
.omx/plans/test-spec-v6-m13-lite-template-pack-gpts.md 를 기준으로
edition/API, template-pack import, UI/IA, tests/docs lanes로 나눠 구현하고
팀 검증 후 HANDOFF.md를 갱신해.
```

## 12. Team Verification Path

Before team shutdown:

- Executor lanes report changed files.
- Test lane reports exact command logs.
- Designer lane reports screenshot evidence for section labels.
- Verifier confirms Lite/Pro behavior matrix:
  - Lite: content/design open, AI/bulk locked.
  - Pro: content/design open, AI/bulk available.
- HANDOFF includes final status, commands run, known gaps, and next actions.

## 13. Consensus Changelog

- Initial draft created from user request and code grounding.
- Architect iteration 1 applied: clarified Lite does not get full project archive import/export, split pure parser versus storage asset internalization, expanded archive security requirements, required packaged guide path if app-linked, and required GPTs shortcut to reuse existing external-link policy.
- Critic iteration 1 applied: added exact template-pack v1 archive/image constants, changed GPTs shortcut policy from arbitrary HTTPS to centralized allow-list with `chatgpt.com` and `chat.openai.com`, and narrowed M13 from template-pack import/export to import-only.
- Architect iteration 3 and Critic iteration 2 approved. Nonblocking execution notes added: centralize duplicated external-link policy if practical, normalize duplicate asset-name checks on Windows, and keep guide packaging tests mandatory when app-linked.
