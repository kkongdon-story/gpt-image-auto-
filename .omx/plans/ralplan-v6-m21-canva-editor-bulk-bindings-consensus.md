# RALPLAN Consensus: V6 M21 Canva-like Editor Controls and Template-bound Bulk

Status: APPROVED FOR IMPLEMENTATION

```yaml
ralplan_consensus_gate.complete: true
```

## Approved Artifacts

- Context: `.omx/context/v6-m21-canva-editor-bulk-bindings-20260714T113619Z.md`
- PRD: `.omx/plans/prd-v6-m21-canva-editor-bulk-bindings.md`
- Test spec: `.omx/plans/test-spec-v6-m21-canva-editor-bulk-bindings.md`
- Architect review: `.omx/plans/review-v6-m21-architect.md`
- Critic review: `.omx/plans/review-v6-m21-critic-iteration1.md`

## Consensus Decision

1. 기존 `offsetY`를 확대하지 않는다. `CardLayoutOverride.titlePlacement`를 선택적으로 추가하고 기존 필드는 `콘텐츠 묶음 위치`로 유지한다.
2. 제목 직접 위치 y는 `0..100` normalized travel이다. `top: y%` + `translateY(-y%)`로 제목 높이를 자동 반영하고 downstream 콘텐츠는 placeholder로 고정한다.
3. 푸터 X는 기존 renderer/model의 `ChromeSlotStyle.offsetX`를 UI에 연결한다.
4. 포인트 색상은 스와치 + native picker + 검증된 hex + reset의 공용 컨트롤을 사용한다.
5. custom text layer는 outer box와 inner foreground를 분리한다. 이 wrapper가 인라인 편집 중 원문 숨김과 글자 전용 투명도를 함께 해결한다.
6. 페이지 명령은 0-based UI index와 1-based override key 매핑표를 따르는 pure transaction으로 구현한다. 복제 시 layer ID/key는 새로 만들고 asset reference는 유지한다.
7. layer copy/cut/paste는 앱 내부 clipboard를 사용하며 input/textarea/contenteditable/IME의 기본 클립보드를 침범하지 않는다.
8. Pro bulk v2는 템플릿이 stable binding keys를 선언하고 CSV가 값을 제공한다. CSV v1은 유지한다.
9. `bulkBindings`는 WorkspaceState/DeckPreset/archive에서 inert metadata로 Lite에도 보존되지만 bulk UI/handler/materialization은 Pro에서만 존재한다.
10. M21에는 undo/redo와 EXE 패키징을 포함하지 않는다. 마지막 페이지 삭제 차단, 내용 페이지 확인, cut clipboard 보존, 상태 메시지로 위험을 완화한다.

## RALPLAN-DR Summary

### Chosen

- compatibility-preserving optional contracts;
- one renderer for preview and PNG;
- pure domain transactions before UI wiring;
- template-bound bulk data;
- manual editor parity across Lite/Pro.

### Rejected

- widening the existing Y magic range;
- converting every standard slot into a freeform layer in M21;
- endlessly extending fixed CSV columns;
- OS clipboard-only layer serialization;
- putting bulk metadata only in transient dialog state.

### Revisit triggers

- repeated index-rekey defects trigger a future stable page-id ADR;
- image bulk replacement requires a separate asset/security milestone;
- title direct mode that cannot pass all four ratio geometry gates is narrowed before release rather than shipped with clipping.

## ADR Summary

M21 adds five optional/testable contracts: title placement, text foreground opacity, page transactions, internal layer clipboard, and template bulk bindings. Undefined fields preserve old output. Shared sanitizers may exist in Lite, but Pro execution imports and user-facing bulk surfaces remain edition-gated and strip-verified.

## Required Execution Order

1. M21-0 RED baseline.
2. M21-1 domain contracts, sanitizers, storage, page/binding helpers.
3. M21-2 shared renderer and editor controls.
4. M21-3 page context menu and layer clipboard.
5. M21-4 Pro bulk v2 with CSV v1 compatibility.
6. M21-5 typecheck/tests/builds/edition strip/visual and PNG parity/evidence/HANDOFF.

Do not package EXEs during this milestone.

## Verification Gate

Minimum required commands after targeted tests:

```powershell
npm run typecheck
npm test
npm run build:lite
node scripts/verify-edition.mjs --edition lite --scan dist dist-electron
npm run build:pro
```

In addition, the test spec requires the M21 preview/PNG geometry matrix, manual Lite/Pro flows, CSV v1/v2 tests, storage/archive compatibility, security limits, and complete `.meta.json` evidence.

## Agent Roster

- Domain/persistence executor: types, validators, page operations, binding model.
- Renderer/UI executor: `cardTemplate`, toolbar, inline editor, context menu, shortcuts. Own `App.tsx` exclusively during integration.
- Test engineer: RED fixtures, domain/DOM/security/edition tests.
- Verifier: Lite/Pro source gates, geometry/PNG/manual QA, evidence audit.
- Read-only critic: edition boundary and bulk v2 safety review.

## Suggested Follow-up Command

```text
$ultrawork
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m21-canva-editor-bulk-bindings.md 와
.omx/plans/test-spec-v6-m21-canva-editor-bulk-bindings.md 기준으로 M21-0부터 순서대로 구현해.
먼저 기존 제목 범위/인라인 텍스트 중복/흰 배경/고정 CSV/페이지·클립보드 부재를 RED로 고정하고,
Lite/Pro 공통 수동 편집 기능과 Pro 전용 bulk v2 경계를 계획대로 지켜.
각 gate의 로그와 .meta.json을 .omc/evidence/v6/m21-canva-editor-bulk-bindings/에 남기고,
preview/PNG 4개 비율 parity와 Lite verify-edition까지 통과시켜.
HANDOFF.md는 append-only로 갱신하고 EXE 패키징은 하지 마.
```

