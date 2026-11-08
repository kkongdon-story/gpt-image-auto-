# Architect Review: V6 M20 Windows DPI-safe PNG Rendering

Verdict: APPROVE WITH REQUIRED BOUNDARIES

## Confirmed Architecture

The renderer should treat the DOM `.card` element as the canonical render surface:

1. establish deterministic hidden-window content dimensions;
2. query and validate `.card.getBoundingClientRect()` after readiness gates;
3. capture only that rectangle;
4. normalize the card-only `NativeImage` from device pixels to the ratio contract;
5. retain exact final dimension validation.

This aligns with the current system because the card template already resolves its width and height from the centralized aspect-ratio contract, while the current failure occurs after whole-viewport `capturePage()`.

## Required Boundaries

- Keep the primary implementation in `src/render-engine/offscreenRenderer.ts` plus a small pure geometry/normalization helper.
- Do not multiply slot or quality-gate CSS coordinates by device pixel ratio.
- Do not weaken `qualityGates.ts`; output validation is correct and should run on the final normalized image.
- Avoid changing `cardTemplate.ts` unless a stable render-root selector or body sizing rule is demonstrably required.
- Keep Lite and Pro on the same `renderDeckOffscreen()` path.
- Do not introduce an app-wide `force-device-scale-factor` workaround.
- Never normalize a full-viewport or wrong-aspect image.

## Edge Cases That Must Be Covered

- fractional scale factors, especially 1.25, 1.5, and 1.75;
- fractional DOM rectangle coordinates and one-pixel edge loss;
- BrowserWindow outer bounds differing from content bounds;
- scrollbar, document overflow, or compositor padding entering the capture;
- font/image readiness completing after initial layout;
- multi-monitor scale changes;
- blank-frame detection after card-only normalization;
- preservation of CSS-pixel slot metrics used by quality gates.

## Acceptance Gate Additions

- Packaged Lite at `--force-device-scale-factor=1.5` must produce exactly `1080x1350` for 4:5.
- All four centralized ratios must be verified in decoded PNG files.
- Existing slots/quality-gate metrics must remain in CSS-card coordinates.
- Blank-frame detection must run on the final card-only image.
- Invalid card geometry and wrong-aspect captures must continue to fail.

## Conclusion

The PRD direction is technically sound. The permanent fix is card-boundary capture plus guarded DPI normalization, not user-entered sizing, global display-scale forcing, relaxed validation, or blind viewport resizing.
