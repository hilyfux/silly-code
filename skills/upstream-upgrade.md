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
3. **Verify varmap parity for all three platforms before invoking ci-upgrade.** Inspect `pipeline/varmap-<target>.json`, `-linux-x64.json`, `-win32-x64.json`. Run `node tests/varmap-parity.test.cjs` — asserts (a) filename↔`platform`-field match, (b) identical semantic keyset across platforms, (c) Iter 71 schema contract. If any platform is missing or has fewer semantic keys than the others, you must hand-curate that platform's varmap before step 4.
4. **`require('./pipeline/ci-upgrade.cjs')` is safe post-Iter-80** — the async IIFE now carries `if (require.main !== module) return;` as its first statement (line 603), so require-time inspection returns in ~16ms with no side effects. Historic hazard preserved in `memory/project-ci-upgrade-no-require-guard.md` as a recurrence playbook; if the guard is ever removed in a diff, block the change. Still never run the full flow against the working copy when investigating — use an `isolation: worktree` subagent or a disposable clone.
5. **Do not let ci-upgrade auto-regenerate a platform varmap that already has a hand-curated draft.** Its auto-detection finds only the baseline ~8 semantic keys (getAPIProvider, isEnvTruthy, modelAwareProviderResolver, isSubscriber, statsigTransport, AnthropicSDK, configVar, defaultContextWindow) — it silently loses the ~21 Layer-3 keys (AnthropicSDK_class, scheduledTasksEnabled_setter, state_holder, sessionCronTasks_*, cronResurrect_handler, is1mContextVariant, etc.). Fingerprint of the regression: a platform varmap with <29 semantic keys or missing `platform` field. See `memory/project-darwin-2.1.117-varmap-regression.md`.
6. Re-run the pipeline in the smallest useful loop:
   - `node pipeline/ci-upgrade.cjs` for the unattended path (run it, don't import it)
   - `node pipeline/upgrade.cjs` for manual diagnosis helpers
   - `node pipeline/patch.cjs` for build verification
7. Fix the smallest set of fragile patch anchors needed. If the probe flagged a bare-inject token, update `pipeline/match-registry.cjs` BARE_INJECT_TOKENS — the structural regex is the only guard against silent runtime breakage.
8. Re-run verification — `npm test` runs all 13 test scripts including varmap-parity and match-token-drift (no more `test:full` split).
9. Confirm the terminal result is reflected in the knowledge graph.

## Interpretation rules
- `broken` means patch/build automation still failed after auto-fix attempts.
- `tests-failed` means string-level patching may have succeeded but runtime/provider semantics regressed.
- If `provider-engine` appears repeatedly in failures, inspect that module first.
- If `tests/providers.test.cjs` fails after a green build, debug provider semantics before touching unrelated patch modules.
- If `upgrade-probe.cjs` exits clean but a runtime command (e.g. `/loop`, `/exit`, `/model`) misbehaves silently, suspect a layer-3 bare-inject token whose guard regex is too loose — review the BARE_INJECT_TOKENS regexes against the new minified source.
- If rebuild produces tokens that look like a future version's varmap values (e.g. `vH`, `bw`, `gq`) while `pipeline/upstream/package/package.json::version` hasn't actually moved, that's the fingerprint of an inadvertent ci-upgrade run mid-session (Iter 72). Revert `pipeline/patches/provider-core.cjs` detection chain + injection prefix first, then check other patches via `git diff HEAD`.

## Completion checklist
- upgrade result is recorded in `.knowledge-graph/graph-events.jsonl`
- `.knowledge-graph/work-snapshot.md` reflects the latest state
- any newly discovered recurring pattern is captured in the event lessons or snapshot summary
- if the upgrade cannot be completed confidently, open/update the GitHub issue instead of guessing
