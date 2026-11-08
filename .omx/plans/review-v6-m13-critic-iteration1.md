# Critic Review: V6 M13 Lite Template Pack GPTs, Iteration 1

Date: 2026-07-09
Reviewer role: Critic
Verdict: ITERATE

## Blocking Issues

1. Archive safety limits are not concrete enough for execution.
   - The PRD requires bounded entry count, total uncompressed size, and per-file size, but it does not set actual values.
   - Required fix: define exact constants before implementation.

2. GPTs shortcut URL policy is internally inconsistent.
   - The PRD says valid HTTPS opens externally, but also says to reuse the existing allow-list.
   - Current code only allows Kakao and Threads URLs.
   - Required fix: define one central policy for GPTs shortcut URLs.

3. Template-pack export is introduced but not specified.
   - The PRD mentions import/export, but the implementation and tests only define import.
   - Required fix: remove export from M13 or fully specify export behavior.

## Architect Concerns Review

- Lite scope/full project archive: resolved.
- Parser purity versus storage internalization: resolved.
- Archive safety: partially resolved, but missing numeric limits.
- Guide packaging: resolved enough.
- GPTs shortcut policy: not resolved until URL policy contradiction is removed.

## Summary

The direction is strong and product-aligned. The plan needs one more revision to remove implementation guesses around import bounds, URL allow-listing, and template-pack export scope.
