# pipeline/ — Patch Pipeline
## Prohibitions
- Modifying upstream/ contents → pristine upstream binary, never touch
- Adding patch modules without updating modules array in patch.cjs → silently skipped
## When Changing
- Patch module interface → patch(name, find, replace) and patchAll(name, find, replace)
- Provider patches → @pipeline/patches/CLAUDE.md
## Conventions
- patch.cjs is the orchestrator: loads upstream cli.js, runs modules, writes output
- Modules array order matters: branding → provider-engine → equality → privacy
- Exit code 1 if any patch fails (pattern not found)
- Input: pipeline/upstream/package/cli.js, Output: pipeline/build/cli-patched.js

## Upgrade Anchor Model (tri-layer)
Every upstream-minified identifier our patches touch belongs to exactly one layer. Knowing which layer matters on upgrade day — only layer 3 needs manual attention.
- **Layer 1 — varmap** (`pipeline/varmap-<ver>.json`): ci-upgrade.cjs diffs old vs new varmap and rewrites patch files. Adding a new entry here means the next bump auto-renames it everywhere. Current coverage: S6, pq, KA, $Q, YM, DR1, plus a few unused-by-MATCH ones.
- **Layer 2 — content-anchor** (auto): ci-upgrade.cjs re-anchors MATCH entries shaped like `Tb1="literal…"` by searching new upstream for the same string tail preceded by a different identifier. Free coverage for identity-style vars (Tb1, pq4, Fq4, wB).
- **Layer 2b — self-anchored** (patch-time fail): MATCH values declared `function xW(…)` or `class qh extends …` will FAIL the build if renamed — loud, not silent.
- **Layer 3 — bare inject** (manual guard required): identifiers we write into the REPLACEMENT side of a patch with no echo in the FIND string. A rename passes patch-time and crashes at runtime. Must be listed in `BARE_INJECT_TOKENS` inside `match-registry.cjs` with a structural regex guard.

## Upgrade Tooling
- `node pipeline/upgrade-probe.cjs` — pre-flight diagnostic. Classifies every identifier our patches reference into the four tiers above, checks upstream presence, exits nonzero when an unguarded bare token has gone missing. Run this FIRST on any upstream bump, before `patch.cjs`.
- `node pipeline/ci-upgrade.cjs` — unattended upgrade path (layer 1 + 2 auto-rename, patch, test, commit).
