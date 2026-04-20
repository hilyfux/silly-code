# /upstream-upgrade

Use this workflow when `@anthropic-ai/claude-code` releases a new version and silly-code needs to absorb the upgrade without regressing the three synchronized tracks.

## Before touching code
Read these first:
- `.knowledge-graph/work-snapshot.md`
- the most recent `upstream_upgrade_attempt` entries in `.knowledge-graph/graph-events.jsonl`
- `CLAUDE.md`
- `pipeline/CLAUDE.md`
- `pipeline/patches/CLAUDE.md`
- `bin/CLAUDE.md` when the scheduled entrypoint is involved

## What to extract from the knowledge graph
Prioritize these signals before debugging:
- repeated failing patch modules
- whether `content-anchor` recovery worked recently
- whether recent failures were `broken` builds or `tests-failed`
- the recommended next recovery step from the latest snapshot

## Standard workflow
1. Confirm current vs target upstream version.
2. **Run `node pipeline/upgrade-probe.cjs` FIRST** — pre-flight diagnostic. Classifies every identifier our patches reference into the four anchor tiers (varmap / content-anchor / self-anchored / bare-inject) and exits nonzero if an unguarded bare token has gone missing. This is the only loud signal we get for layer-3 silent-coupling failures (Si, Ci, nL, qh, uvK and friends — see `pipeline/match-registry.cjs`).
3. Inspect `pipeline/varmap-<current>.json` and `pipeline/varmap-<target>.json` if the target varmap exists.
4. Re-run the pipeline in the smallest useful loop:
   - `node pipeline/ci-upgrade.cjs` for the unattended path
   - `node pipeline/upgrade.cjs` for manual diagnosis helpers
   - `node pipeline/patch.cjs` for build verification
5. Fix the smallest set of fragile patch anchors needed. If the probe flagged a bare-inject token, update `pipeline/match-registry.cjs` BARE_INJECT_TOKENS — the structural regex is the only guard against silent runtime breakage.
6. Re-run verification:
   - `node tests/base.test.cjs`
   - `node tests/schema.test.cjs`
   - `node tests/providers.test.cjs`
7. Confirm the terminal result is reflected in the knowledge graph.

## Interpretation rules
- `broken` means patch/build automation still failed after auto-fix attempts.
- `tests-failed` means string-level patching may have succeeded but runtime/provider semantics regressed.
- If `provider-engine` appears repeatedly in failures, inspect that module first.
- If `tests/providers.test.cjs` fails after a green build, debug provider semantics before touching unrelated patch modules.
- If `upgrade-probe.cjs` exits clean but a runtime command (e.g. `/loop`, `/exit`, `/model`) misbehaves silently, suspect a layer-3 bare-inject token whose guard regex is too loose — review the BARE_INJECT_TOKENS regexes against the new minified source.

## Completion checklist
- upgrade result is recorded in `.knowledge-graph/graph-events.jsonl`
- `.knowledge-graph/work-snapshot.md` reflects the latest state
- any newly discovered recurring pattern is captured in the event lessons or snapshot summary
- if the upgrade cannot be completed confidently, open/update the GitHub issue instead of guessing
