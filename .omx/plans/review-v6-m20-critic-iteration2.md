# Critic Review: V6 M20 Windows DPI-safe PNG Rendering, Iteration 2

Verdict: APPROVE

## Resolved Checks

- Production PNG rendering is explicitly restored to offscreen `paint` frames; whole-page `capturePage()` is superseded.
- The render-only offscreen surface explicitly requests `deviceScaleFactor: 1` and does not alter visible editor scaling.
- Test ratio ids match the repository: `4:5`, `1:1`, `16:9`, and `4:3`.
- Durable baseline artifacts and SHA-256 hashes are recorded under the M20 evidence root.
- Packaged Pro verification is external and black-box; it does not reintroduce `CARDNEWS_SMOKE_ACTION`, mocks, or hidden QA routes into `app.asar`.
- The plan clearly answers the product question: users do not manually adjust canvas pixels; 4:5 exports automatically as `1080x1350`.

## Final Review Result

- Clarity: PASS
- Verifiability: PASS
- Completeness: PASS
- Scope control: PASS
- Implementation readiness: PASS

Remaining blockers: none.
