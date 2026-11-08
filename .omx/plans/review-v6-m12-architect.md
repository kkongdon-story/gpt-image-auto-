# Architect Review: V6 M12 Lite/Pro EXE Release Gates

Verdict: ITERATE

Reviewer: Architect subagent
Date: 2026-07-09

## Summary

The plan is architecturally sound and correctly avoids the known OneDrive `release/` packaging failure by using `%LOCALAPPDATA%` isolated outputs first. Lite/Pro separation is well-framed and the planned package-level Lite `app.asar` scan is the right release bar.

## Required Changes Applied

1. Added first-class exit-code evidence requirement for mandatory gate commands.
2. Added `ai-provider-command-regression` to the security/debugging gate.
3. Added `@electron/asar` preflight gate because `verify-edition.mjs` imports it directly.
4. Explicitly rejected direct `npm run dist:win:*` scripts as the M12 release path because they use shared `release/` output.
5. Added post-release `npm run build:pro` restore so the workspace is not left in Lite build state after packaging.

## Architect Recommendation

Proceed to Critic review after the narrow iteration above. Do not redesign the release plan.

