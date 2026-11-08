# Critic Review: V6 M20 Windows DPI-safe PNG Rendering, Iteration 1

Verdict: ITERATE

## Must-Fix Findings

1. Define a packaged Pro DPI verification path without re-enabling production smoke hooks.
2. Resolve the historical `paint`-event contract versus the current `capturePage()` implementation.
3. State the render-only offscreen `deviceScaleFactor` policy explicitly.
4. Use concrete ratio ids: `4:5`, `1:1`, `16:9`, and `4:3`.
5. Attach or reference the existing packaged Lite 150% baseline evidence.

## Resolution Applied

- The PRD now restores offscreen `paint` as the primary production PNG path and explicitly supersedes current whole-page `capturePage()`.
- The render-only offscreen surface requests `deviceScaleFactor: 1`; visible editor/global Windows scaling is unchanged.
- Packaged Pro uses an external QA-only CDP driver and remains free of internal smoke code.
- The test spec uses the actual ratio ids.
- A durable planning baseline records results, source paths, and SHA-256 hashes.

Iteration 2 review is required before implementation handoff.
