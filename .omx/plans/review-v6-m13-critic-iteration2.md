# Critic Review: V6 M13 Lite Template Pack GPTs, Iteration 2

Date: 2026-07-09
Reviewer role: Critic
Verdict: APPROVE

## Blocking Issues

None.

## Resolved Previous Blockers

1. Archive safety now has exact constants:
   - `MAX_CARDS`: 50
   - `MAX_ARCHIVE_ENTRIES`: 200
   - `MAX_TEMPLATE_JSON_BYTES`: 512 KiB
   - `MAX_TOTAL_UNCOMPRESSED_BYTES`: 120 MiB
   - `MAX_ASSET_BYTES`: 20 MiB
   - `MAX_IMAGE_PIXELS`: 36,000,000
   - `MAX_IMAGE_SIDE`: 8,000
   - manifest/root/extension allow-lists

2. GPTs shortcut policy is no longer contradictory:
   - allow-listed HTTPS only
   - centralized through existing external-link policy
   - M13 GPTs hosts: `chatgpt.com`, `chat.openai.com`

3. Template-pack scope is import-only:
   - template-pack export is deferred
   - full project archive import/export stays Pro-only

## Ralplan Criteria

Pass.

The plan has clear principles, real alternatives, documented tradeoff against the safer no-zip option, concrete risk mitigations for untrusted archive/image import, and testable acceptance criteria. The test spec covers unit, integration, UI/e2e, docs validation, Lite/Pro edition verification, and full build/test commands.

## Nonblocking Improvements

- Centralize duplicated `isAllowedExternalUrl` implementations from `electron/main.ts` and `electron/lite-main.ts` during execution.
- Make duplicate asset-name checks explicit after path normalization, including case-normalization behavior on Windows.
- Keep guide-link packaging tests mandatory if the app links to the HTML guide.

## Final Consensus Gate Statement

Architect iteration 3 is approved. Critic iteration 2 is approved. The V6 M13 Lite Template Pack GPTs plan is ready for execution handoff.
