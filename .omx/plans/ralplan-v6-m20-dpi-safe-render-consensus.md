# RALPLAN Consensus: V6 M20 Windows DPI-safe PNG Rendering

Status: APPROVED FOR IMPLEMENTATION

## Approved Artifacts

- PRD: `.omx/plans/prd-v6-m20-dpi-safe-render-dimensions.md`
- Test spec: `.omx/plans/test-spec-v6-m20-dpi-safe-render-dimensions.md`
- Architect review: `.omx/plans/review-v6-m20-architect.md`
- Critic iteration 1: `.omx/plans/review-v6-m20-critic-iteration1.md`
- Critic iteration 2: `.omx/plans/review-v6-m20-critic-iteration2.md`
- Planning baseline: `.omc/evidence/v6/m20-dpi-safe-render-dimensions/planning-baseline.md`

## Final Decision

The defect is a renderer/DPI problem, not a missing user size control.

The approved permanent direction is:

1. preserve the supported ratio contracts, including 4:5 at `1080x1350`;
2. restore offscreen `paint` events as the production PNG source;
3. set `offscreen.deviceScaleFactor: 1` only on the hidden render surface;
4. verify the `.card` fills the deterministic frame;
5. retain blank-frame, readiness, visual, and exact-size gates;
6. permit normalization only for a verified uniformly scaled full-card frame;
7. run the full 4-ratio x 5-scale matrix in Lite and Pro;
8. verify packaged Pro externally without shipping internal smoke code;
9. require clean Windows install/upgrade evidence before public release.

## Suggested Follow-up Command

```text
$ultrawork
프로젝트 루트: C:\Users\js480\OneDrive\바탕 화면\1_Projects\gpt-cardnews-auto

.omx/plans/prd-v6-m20-dpi-safe-render-dimensions.md 와
.omx/plans/test-spec-v6-m20-dpi-safe-render-dimensions.md 기준으로 M20-1부터 순서대로 구현해.
먼저 기존 DPI 실패를 하네스로 RED 재현하고, 제품 PNG 경로를 offscreen paint 이벤트로 복원해.
Lite/Pro 4개 비율 x Windows 배율 5종을 검증하고, Pro 패키지에는 smoke 코드를 다시 넣지 마.
모든 게이트가 통과하기 전에는 EXE를 release/에 배치하지 말고, 증거와 HANDOFF.md까지 갱신해.
```
