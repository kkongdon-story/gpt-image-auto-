# M24 Planner Draft

Planner agent: `019f6f0b-d1d9-7381-9747-82ab7e2d1def`

## Recommendation

Harden the existing DOM editor, semantic placement contract, compiled timeline, and Electron exporter rather than replacing the editor framework or applying isolated UI patches.

## Primary decisions

1. Use the existing per-card `durationMs` contract and expose it through the timeline and card inspector.
2. Persist an explicit deck-level card/video project mode so photo reels are intentional and timeline visibility is predictable.
3. Give every semantic item one ownership element and one normalized card-coordinate rectangle.
4. Add a click/drag threshold and gesture-scoped history transaction.
5. Separate media import from assignment with an explicit target-selection sheet.
6. Replace separate PNG/MP4 entry points with one Export dialog.
7. Replace export percentages with phase, heartbeat, watchdog, cleanup, and diagnostics.
8. Make CLI installation Pro-only, allowlisted, confirmed, visible, and verifiable.
9. Require Lite/Pro source, portable, installed, and clean-VM evidence before staging.

## Rejected directions

- Retained-mode canvas migration in M24: too broad for a release-blocking hardening milestone.
- Cosmetic control changes without geometry/export root-cause tests: would hide failures without proving correctness.
- Silent CLI installation: unsafe and difficult to support.

## Verification shape

Use T1-T18 and fail-closed gates G0-G13 from the companion test specification. Public-ready labeling is forbidden until all mandatory gate metadata is fresh `pass`.

