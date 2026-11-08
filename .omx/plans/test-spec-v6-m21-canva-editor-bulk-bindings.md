# Test Spec: V6 M21 Canva-like Editor Controls and Template-bound Bulk Generation

## 1. Scope and Gate Rule

이 명세는 M21 PRD의 R1-R9를 Lite/Pro, 저장/복원, 미리보기/PNG까지 검증한다.

Evidence root:

```text
.omc/evidence/v6/m21-canva-editor-bulk-bindings/
```

Gate order:

1. T1 RED baseline.
2. T2-T8 targeted unit/integration.
3. T9-T12 storage, bulk, edition.
4. T13 typecheck/full test.
5. T14-T16 Lite/Pro builds and visual/PNG smoke.
6. T17 evidence audit/HANDOFF.

앞 gate가 실패하면 뒤 build/release gate를 진행하지 않는다. M21에서는 EXE를 패키징하지 않는다.

## 2. Required Test Fixtures

### Aspect ratios

| Ratio | Output contract |
| --- | --- |
| 4:5 | 1080x1350 |
| 1:1 | 1080x1080 |
| 16:9 | 1920x1080 |
| 4:3 | 1440x1080 |

### Content fixtures

1. 기존 프로젝트: 새 M21 필드가 없음.
2. 제목 직접 배치: y 0/50/100 normalized travel.
3. 투명 배경 custom text layer.
4. 불투명 배경 custom text layer.
5. 한글 IME 입력 문자열과 줄바꿈.
6. text/shape/line/image layer가 모두 있는 카드.
7. 3페이지 deck, 각 페이지별 overrides/background/image/bulk bindings.
8. CSV v1 fixed-column sample.
9. CSV v2 standard slots + two custom text bindings.
10. Lite와 Pro 동일 수동 편집 fixture.

## T1. RED baseline

목적: 코드 변경 전에 사용자가 보고한 결함을 고정한다.

Assertions before fix:

- 인라인 textarea와 iframe 글자가 동시에 보인다.
- 투명 텍스트 레이어 편집 배경이 흰색이다.
- 제목/콘텐츠 Y가 `-20..20`으로 제한된다.
- footer inspector에 X control이 없다.
- point color에 임의 hex 입력이 없다.
- CSV sample은 custom text binding을 표현하지 못한다.
- 썸네일 우클릭과 Ctrl+C/X/V layer 명령이 없다.

Evidence:

- `t01-red-baseline.log`
- `t01-red-baseline.meta.json`
- `t01-inline-edit-before.png`
- `t01-controls-before.png`

## T2. Title placement contract

Target tests:

```text
src/render-engine/cardTemplate.test.ts
src/storage/deckStore.test.ts
```

Assertions:

- `titlePlacement` 미지정/flow는 기존 HTML/CSS와 동등하다.
- `card-y` + y 0/50/100이 각각 `top = (cardHeight - titleHeight) * y / 100` 계약을 만족한다.
- `NaN`, Infinity, 음수, 100 초과 값은 정규화된다.
- 4개 비율에서 제목 box가 카드 경계 안에 있다.
- 직접 제목 배치가 콘텐츠 묶음 `offsetY` 값을 변경하지 않는다.
- 직접 제목 배치가 남긴 placeholder 때문에 소제목/본문 flow 좌표가 변하지 않는다.
- 저장/복원 후 값이 유지된다.

Command:

```powershell
npx vitest run src/render-engine/cardTemplate.test.ts src/storage/deckStore.test.ts
```

Evidence:

- `t02-title-placement.log`
- `t02-title-placement.meta.json`

## T3. Footer X/Y and arbitrary accent color

Target tests:

```text
src/domain/chromeConfig.test.ts
src/ui/editorToolbar.test.ts
src/render-engine/cardTemplate.test.ts
```

Assertions:

- footer offsetX/offsetY가 독립적으로 serialize/render된다.
- offset 0/0은 기존 renderer output과 동등하다.
- valid `#RRGGBB`는 accent에 적용된다.
- invalid, partial, blank hex는 commit되지 않는다.
- reset은 style default를 복원한다.
- picker와 hex input이 같은 상태를 사용한다.

Command:

```powershell
npx vitest run src/domain/chromeConfig.test.ts src/ui/editorToolbar.test.ts src/render-engine/cardTemplate.test.ts
```

Evidence:

- `t03-footer-color.log`
- `t03-footer-color.meta.json`

## T4. Inline text editing and Korean IME

새 DOM/interaction 테스트는 iframe fixture에서 실제 편집 상태를 검증한다.

Assertions:

- 편집 시작 시 matching `[data-layer-text]`만 숨는다.
- 다른 레이어와 outer background/border는 보인다.
- textarea가 투명 layer에서 흰 배경을 강제하지 않는다.
- colored background layer는 해당 배경을 유지한다.
- textarea box size/alignment/font/line-height가 layer geometry와 일치한다.
- `compositionstart` 이후 Enter/Escape는 commit/cancel하지 않는다.
- `compositionend` 이후 정상 commit/cancel한다.
- blur/selection change/unmount에서 iframe foreground visibility가 복원된다.

Suggested test files:

```text
src/ui/inlineTextEditing.test.ts
src/render-engine/cardTemplate.test.ts
```

Command:

```powershell
npx vitest run src/ui/inlineTextEditing.test.ts src/render-engine/cardTemplate.test.ts
```

Evidence:

- `t04-inline-edit-ime.log`
- `t04-inline-edit-ime.meta.json`
- `t04-inline-edit-transparent.png`
- `t04-inline-edit-filled.png`

## T5. Text opacity separation

Assertions:

- custom layer `textOpacity=0` hides glyphs but preserves background/border.
- layer `opacity=0` hides foreground/background/border as before.
- textOpacity 0/1/50/100 is normalized as documented; choose one internal scale and enforce it consistently.
- standard scope `title`, `body`, `all` affects only intended text groups.
- badge remains outside typography scope unless separately configured.
- preview HTML and PNG fixture use the same opacity output.
- old projects with undefined textOpacity render at 100%.

Command:

```powershell
npx vitest run src/render-engine/cardTemplate.test.ts src/storage/deckStore.test.ts src/ui/editorToolbar.test.ts
```

Evidence:

- `t05-text-opacity.log`
- `t05-text-opacity.meta.json`
- `t05-opacity-parity.png`

## T6. Page operation transaction

New tests:

```text
src/domain/pageOperations.test.ts
```

Cases:

1. insert before first/middle/last.
2. insert after first/middle/last.
3. duplicate page with all four layer types.
4. delete first/middle/last.
5. attempt to delete last remaining page.
6. selected index before/at/after changed page.
7. cards with missing sparse overrides.
8. page with background/image asset references.
9. page with bulk binding keys.

Assertions:

- cards and override numeric keys remain aligned.
- moved page layer IDs and asset IDs are preserved.
- duplicated page layer IDs are all new.
- duplicated page asset references remain valid without binary duplication.
- duplicated binding keys are unique/deterministic.
- insert-before/after, duplicate, delete가 PRD의 1-based key mapping table와 정확히 일치한다.
- injected `idFactory`/`bindingKeyFactory`로 동일 입력이 동일 테스트 결과를 만든다.
- no source objects are mutated.

Command:

```powershell
npx vitest run src/domain/pageOperations.test.ts
```

Evidence:

- `t06-page-operations.log`
- `t06-page-operations.meta.json`

## T7. Thumbnail context menu and accessibility

Assertions:

- right-click opens menu for the clicked page and does not silently select a different target.
- menu contains insert before/after, duplicate, delete.
- `Shift+F10` and Menu key open the same actions.
- Escape/outside click closes the menu.
- menu is clamped to viewport.
- disabled delete state for the final page is announced.
- non-empty page delete requires confirmation and reports that no undo history exists in M21.
- focus returns to the invoking thumbnail after close/action.

Suggested test:

```text
src/ui/pageContextMenu.test.ts
```

Command:

```powershell
npx vitest run src/ui/pageContextMenu.test.ts src/domain/pageOperations.test.ts
```

Evidence:

- `t07-page-context-menu.log`
- `t07-page-context-menu.meta.json`
- `t07-page-context-menu.png`

## T8. Layer clipboard and shortcut arbitration

New test:

```text
src/ui/layerClipboard.test.ts
```

Assertions:

- copy is non-mutating.
- cut removes only after clipboard snapshot succeeds.
- paste creates a new id and offsets/clamps geometry.
- repeated paste produces unique IDs and predictable offsets.
- copy on page A, paste on page B works.
- text/shape/line/image preserve subtype properties.
- `input`, `textarea`, `select`, contenteditable, inline edit, IME composition retain browser copy/cut/paste.
- no selection and stale/deleted selection are safe no-ops.
- Ctrl/Cmd variants follow the same command helper.

Command:

```powershell
npx vitest run src/ui/layerClipboard.test.ts
```

Evidence:

- `t08-layer-clipboard.log`
- `t08-layer-clipboard.meta.json`

## T9. CSV v2 bindings and v1 compatibility

Target/new tests:

```text
src/domain/csvBulk.test.ts
src/domain/templateBulkBindings.test.ts
```

Assertions:

- generated v2 sample starts with reserved columns and stable binding order.
- Korean display labels do not replace ASCII keys.
- standard title/subtitle/body/bullets/source/emphasis bindings populate correct cards.
- custom text layer `.text` bindings populate correct layer IDs.
- one CSV row creates one independent deck without mutating template state.
- two rows produce independent outputs.
- CSV v1 fixture still parses exactly as before.
- duplicate/invalid/reserved binding keys fail preflight.
- template id/revision mismatch fails before deck creation.
- missing required columns, file over 10 MiB, more than 300 rows, more than 150 total columns, cell over 20,000 characters or 64 KiB fail with user-facing errors.
- path traversal and invalid output names fail.
- output names over 120 characters, Windows reserved names, and formula-leading names fail.
- sample/export values beginning with formula prefixes are apostrophe-escaped; import never evaluates formulas.

Command:

```powershell
npx vitest run src/domain/csvBulk.test.ts src/domain/templateBulkBindings.test.ts
```

Evidence:

- `t09-bulk-v2.log`
- `t09-bulk-v2.meta.json`
- `t09-sample-v2.csv`
- `t09-v1-compat.csv`

## T10. Persistence and archive compatibility

Assertions:

- old WorkspaceState/DeckPreset fixtures load with defaults.
- titlePlacement/textOpacity/bulkBindings round-trip in current storage.
- project archive imports both old and new optional fields.
- unknown/corrupt fields are sanitized without dropping valid design data.
- Lite opening a Pro-authored archive preserves manual design data and does not execute bulk metadata.
- Lite save/reopen preserves inert `bulkBindings` byte-for-byte after sanitizer normalization while still exposing no bulk command.

Command:

```powershell
npx vitest run src/storage/deckStore.test.ts src/storage/projectArchive.test.ts
```

Evidence:

- `t10-persistence.log`
- `t10-persistence.meta.json`

## T11. Edition boundary

Assertions:

- title/footer/color/inline edit/page/clipboard/text opacity code and UI remain in Lite.
- bulk variable editor, sample generator, importer, execution commands remain Pro-only.
- Lite feature locks are explicit and no dead clickable bulk buttons remain.
- Pro retains v1 and v2 bulk.

Commands:

```powershell
npx vitest run src/domain/editionFilter.test.ts
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
```

If the repository has a current Lite regression script, run it in addition and record the exact command rather than substituting an obsolete script name.

Evidence:

- `t11-edition-tests.log`
- `t11-build-lite.log`
- `t11-verify-edition-lite.log`
- matching `.meta.json` files

## T12. Security and abuse cases

Assertions:

- CSV cell text is treated as content, not executable HTML/script.
- layer text remains escaped in renderer output.
- output names cannot escape the selected output directory.
- malformed deeply nested project metadata is bounded/sanitized.
- context menu and clipboard do not expose filesystem paths or secrets.
- bulk row/column/cell limits prevent accidental memory exhaustion.

Evidence:

- `t12-security.log`
- `t12-security.meta.json`

## T13. Typecheck and complete automated tests

Commands:

```powershell
npm run typecheck
npm test
```

Assertions:

- no TypeScript errors.
- all prior and M21 tests pass.
- no storage, render, image, typography, edition, CSV, project archive regression.

Evidence:

- `t13-typecheck.log`
- `t13-test.log`
- matching `.meta.json` files

## T14. Lite and Pro source builds

Commands:

```powershell
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
npm run build:pro
```

Assertions:

- both builds exit 0.
- Lite strip verification passes.
- Pro contains bulk v1/v2 UI and execution path.
- no packaging command is run.

Evidence:

- `t14-build-lite.log`
- `t14-verify-lite.log`
- `t14-build-pro.log`
- matching `.meta.json` files

## T15. Preview/PNG geometry parity

Use the current production render smoke harness. If it cannot inspect M21 geometry, extend it rather than creating a second renderer.

Matrix:

- 4 ratios.
- title y = 0, 50, 100 normalized travel.
- footer X/Y negative, zero, positive.
- arbitrary accent color.
- text opacity 0, 50, 100.
- transparent and filled custom text layer.

Assertions:

- preview slot geometry를 output canvas 좌표로 투영했을 때 title/footer/custom-layer 각 edge 오차가 최대 2 output pixels다. 글리프 raster 자체가 아니라 layout box를 비교한다.
- title is not clipped at card top/bottom.
- footer stays at configured X/Y.
- custom text background remains unchanged by text opacity.
- output dimensions remain the M20 exact contracts.

Evidence:

- `t15-render-parity.log`
- `t15-render-parity.meta.json`
- per-ratio preview screenshots and PNGs
- expected/actual geometry JSON

## T16. Manual Canva-flow QA

Run in both Lite and Pro development builds.

Scenario A: text edit

1. Add a text box with transparent background.
2. Double-click/edit Korean text, spaces, line breaks.
3. Change color and text opacity from floating toolbar.
4. Confirm once and export PNG.

Scenario B: page operations

1. Right-click page 2, duplicate.
2. Insert before/after.
3. Delete one page.
4. Use keyboard menu and Escape.
5. Confirm final-page delete is disabled and content-page delete asks for confirmation because M21 has no undo stack.

Scenario C: clipboard

1. Copy/paste each layer type.
2. Cut a layer and paste to another page.
3. Copy text inside textarea and confirm only selected characters are copied.

Scenario D: Pro bulk

1. Assign bindings to a standard title and two custom text layers.
2. Export sample CSV.
3. Fill two rows in Excel and save UTF-8 CSV.
4. Import/preflight/generate.
5. Confirm each row's values and template geometry.

Scenario E: Lite boundary

1. Repeat A-C successfully.
2. Confirm D is unavailable/locked with clear edition text and no hidden executable path.

Scenario F: Canva reference boundary

1. Confirm interactions use familiar selection/toolbar/menu semantics only.
2. Confirm no Canva name, logo, trademark asset, copied toolbar skin, or page layout appears in Cardnews Studio UI.
3. Confirm existing Cardnews Studio naming, colors, icon library, and layout conventions remain the visual source of truth.

Evidence:

- `t16-manual-qa-lite.md`
- `t16-manual-qa-pro.md`
- screenshots for each scenario
- generated Pro bulk output contact sheet

## T17. Evidence audit and handoff

Assertions:

- every T1-T16 gate has log and valid `.meta.json`.
- each meta records command, timestamps, exit code, edition, commit/dirty state, and artifact paths.
- known limitations are listed; no blocker is hidden as warning.
- HANDOFF.md is append-only and names the next release step.
- no EXE/installer/release artifact was generated by M21.

Evidence:

- `t17-evidence-audit.log`
- `t17-evidence-audit.meta.json`

## 3. Release Blockers

Any of the following blocks M21 completion:

- old project layout changes without user action;
- title clipped at any supported ratio edge;
- duplicate inline text or forced white edit background remains;
- page operation loses/misassigns override or asset reference;
- layer shortcut intercepts normal text editing;
- text opacity changes the text box background unexpectedly;
- CSV v1 regression or v2 silent template mismatch;
- Lite exposes executable bulk functionality;
- preview/PNG geometry mismatch;
- typecheck, tests, build, or edition strip failure;
- missing evidence metadata.
