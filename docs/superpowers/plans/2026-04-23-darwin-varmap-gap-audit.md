# 2026-04-23 — darwin varmap gap audit (Iter 56)

## Context

`pipeline/varmap-2.1.117.json` (darwin-arm64 default) contains **8 semantic keys** while its per-platform peers `pipeline/varmap-2.1.117-linux-x64.json` and `pipeline/varmap-2.1.117-win32-x64.json` each contain **31**. The gap is 21 semantic keys — and Iter 55's `tests/match-token-drift.test.cjs` already surfaced one concrete silent-corrupt landmine born of that gap (see "Known MATCH collision" below).

On upstream bump 2.1.117→next, `ci-upgrade.cjs` walks the varmap to rename minified identifiers inside every patch module and inside `match-registry.cjs`. Any semantic key missing from darwin's varmap means ci-upgrade on darwin **does not rewrite** that identifier, while ci-upgrade on linux/win32 **does**. The same patch source then produces platform-divergent binaries — silently, unless a patch happens to fail at build time.

This doc freezes the gap as a punch list so a future unguarded iteration can close it deterministically, without having to re-derive which keys are missing or how to discover the darwin minified value.

## The 21 missing keys (darwin)

Grouped by anchor layer (see `pipeline/CLAUDE.md` tri-layer anchor model). Layer-1 keys auto-renamed by ci-upgrade on future bumps; Layer-3 keys require `BARE_INJECT_TOKENS` structural guards in `match-registry.cjs`. Layer `?` keys are varmap entries whose call sites don't surface in `MATCH` constants directly — likely used by individual patch modules (`provider-core.cjs`, `provider-ux.cjs`, `privacy.cjs`, etc.) via other anchor mechanisms. Classify them by grep-auditing patch modules before backfilling.

### Layer 1 — provider resolution chain (4 keys)

| Semantic key | linux | win32 | darwin (TBD) | Probe hint |
|---|---|---|---|---|
| `isEnvTruthy` | `VH` | `kH` | ? | `grep -oE 'function [A-Za-z_$]+\(H,z=process\.env\)\{' upstream` |
| `isFirstParty` | `P5` | `J9` | ? | `grep -oE 'function [A-Za-z_$]+\(\)\{return [A-Za-z_$]+\(\)==="firstParty"\}' upstream` |
| `providerFamily` | `Ey` | `hE` | `Kd` (see collision note) | `function <X>(H=uq())\{return H==="firstParty"\|\|H==="anthropicAws"\|\|H==="foundry"\|\|H==="mantle"\}` |
| `subscriptionTier` | `G7` | `Z_` | ? | `grep` around `case"max":return"Claude Max"` |

### Layer 3 — bare-inject targets (5 keys)

All five are targets we write into REPLACEMENT side of a patch without echoing in FIND. Each MUST also have a structural regex in `BARE_INJECT_TOKENS`. Three are already guarded (`Qi`, `YU`, `Yh`); the rest need `match-registry.cjs` extension after backfill.

| Semantic key | linux | win32 | darwin (TBD) | Structural anchor |
|---|---|---|---|---|
| `scheduledTasksEnabled_setter` | `ir` | `rr` | ? | `function <X>\(H\)\{<state_holder>\.scheduledTasksEnabled=H\}` |
| `state_holder` | `x$` | `x8` | ? | the object literal whose fields include `scheduledTasksEnabled` + `sessionCronTasks` |
| `sessionCronTasks_getter` | `aN` | `sN` | ? | `function <X>\(\)\{return <state_holder>\.sessionCronTasks\}` |
| `sessionCronTasks_remover` | `Kd` | `Kd` | ? | `function <X>\(H\)\{if\(H\.length===0\)return 0;[^{}]*<state_holder>\.sessionCronTasks` |
| `AnthropicSDK_class` | `tN` | `eN` | ? | `class <X> extends[^{]*\{[^}]*this\.messages\s*=\s*new` (note `MATCH.CONSTRUCTOR='kV'` already covers darwin 2.1.114; 2.1.117 name unknown) |

### Layer ? — patch-local, needs classification (12 keys)

Probe each by grep-auditing which patch module references it (e.g. `grep -rn 'statsigFlag\|isLoopDynamicEnabled' pipeline/patches/`). Do not blindly copy linux values — darwin mangling is independent.

- `statsigFlag`, `statsigFlag3`
- `isLoopDynamicEnabled_func`, `isLoopPromptEnabled_func`, `isCronEnabled_func`
- `cnTimezoneDetector`
- `cronResurrect_handler`
- `is1mContextVariant`
- `reactLaneNode`
- `filterModelsByAvailability`
- `buildSubscriberMenu`
- `defaultModelResolver_haikuBranch`

## Known MATCH collision — RESOLVED Iter 69 (2026-04-23)

**Status: closed by deletion, not backfill.**

Iter 68 discovered that patches 13 (model-resolution) and 14 (provider-family), the sole consumers of `MATCH.RESOLVE` and `MATCH.FAMILY`, were silent no-ops since inception: their `.replace('q==="foundry"||q==="mantle"}', ...)` literal targeted `q===` but the MATCH strings use `H===`. The `replace()` returned the input unchanged → `find === replace` → `patch.cjs` reported OK while the binary was byte-identical. Product behavior was unaffected because patch 10 (provider-detection) intercepts our runtimeIds before the unmodified `$T`/`Kd` helpers are consulted.

Iter 69 removed the dead code: deleted patches 13+14 from `pipeline/patches/provider-core.cjs`, deleted `MATCH.RESOLVE` + `MATCH.FAMILY` from `pipeline/match-registry.cjs`, and dropped `'RESOLVE'`/`'FAMILY'` from `tests/build-integrity.test.cjs::criticalKeys`. `node pipeline/patch.cjs` now produces cli-patched.js with SHA256 `947cb207ee7f66b2f7d5e2aa8a15f12fe98db27eab2590fbc6bf516c9a88e1f8` — byte-identical to the pre-deletion baseline. 131 OK → 129 OK. `tests/match-token-drift.test.cjs::ASYM_CEILING` lowered 1→0.

Historical cross-wire table (retained for archival context):

- **Darwin 2.1.114 today:** `Kd` was matched correctly by the no-op patch; outcome was unchanged whether patch was applied or not.
- **Darwin 2.1.117 future (if `providerFamily` stays `Kd`):** n/a — patch no longer exists.
- **Linux 2.1.117 today:** ci-upgrade's rewrite of `Kd` using `sessionCronTasks_remover`'s linux value would have produced a nonexistent signature; now there's no MATCH string carrying `Kd` for ci-upgrade to corrupt.

Backfilling `providerFamily=Kd` into darwin varmap would have created a **COLLISION** (`Kd` → two different semantic keys across platforms) — strictly worse than the ASYM that deletion resolved. See `memory/project-darwin-varmap-gap.md` and `memory/project-patches-13-14-noop.md` for the full post-mortem.

## Recommended workflow for the close-out iteration

1. Fetch darwin 2.1.117's upstream bundle: `npm pack @anthropic-ai/claude-code@2.1.117` → extract `package/cli.js` into a scratch path. Do NOT overwrite `pipeline/upstream/package/cli.js` (still pinned to 2.1.114 for current patch set).
2. Run `node pipeline/upgrade-probe.cjs --upstream <scratch>/cli.js` to classify identifiers.
3. For each missing semantic key in the tables above, grep the darwin 2.1.117 bundle using the probe hint to discover its darwin minified value.
4. Extend `pipeline/varmap-2.1.117.json` with the new keys (preserve alphabetical order for diff readability); add `"platform": "darwin-arm64"` metadata while at it (unblocks `tests/varmap-parity.test.cjs`).
5. Extend `BARE_INJECT_TOKENS` in `match-registry.cjs` with structural guards for any new Layer-3 keys.
6. Re-run `node tests/varmap-parity.test.cjs && node tests/match-token-drift.test.cjs && node pipeline/upgrade-probe.cjs`. match-token-drift's `ASYM_CEILING` should drop from 1 to 0; varmap-parity should go green.
7. Do NOT attempt to wire new tests into `package.json` inside the current workspace session — that path is guarded (see `memory/project-guarded-paths.md`); wire in a fresh session or via direct repo commit.

## Iter 57 addendum — Layer-? minified-value audit against patch bodies

Of the 12 Layer-? semantic keys, two have live collisions in patch source when we bare-token-match against their linux/win32 values:

- `isCronEnabled_func` linux-value `B2` collides with `pipeline/patches/branding.cjs:343` `const B2 = '#f97316'` (local color constant). A linux-path ci-upgrade would silently rewrite our own variable. Fix: rename the const (e.g. to `BODY_BLOCK_2`).
- `reactLaneNode` linux-value `t8` collides with `pipeline/patches/auth-bypass.cjs:21-22` `t8()` which is darwin's `isSubscriber` function call. Cross-platform semantic collision — t8 means different things on different platforms. Fix: capture via `([\w$]+)` and thread through replacer (same discipline as Iter 20's patch hardening).

The other 10 Layer-? keys (statsigFlag/statsigFlag3, cnTimezoneDetector, cronResurrect_handler, is1mContextVariant, filterModelsByAvailability, buildSubscriberMenu, defaultModelResolver_haikuBranch, isLoopDynamicEnabled_func, isLoopPromptEnabled_func) have NO patch-source references under either linux or win32 minified values — they're linux/win32-specific additions that darwin can safely ignore at patch-time, but darwin varmap still needs their darwin-minified value for ci-upgrade parity on future bumps.

This addendum was generated by a bare-token sweep using the regex `(?<![\w$])VALUE(?![\w$])` over `pipeline/patches/**/*.cjs` and `pipeline/match-registry.cjs`. See `memory/project-patch-source-token-collisions.md` for the durable record.

## Open questions

- Is `sessionCronTasks_remover = Kd` on both linux AND win32 a coincidence of bun's mangling or a bundle-metadata leak? Worth checking one-more-version to see if both platforms continue to track identical minified names for this identifier — if so, cross-platform parity checks could leverage it as a stable anchor.
- `MATCH.CONSTRUCTOR` currently hardcodes `kV` as the darwin 2.1.114 AnthropicSDK-class minified name. The varmap has `AnthropicSDK_class` on linux/win32 2.1.117 but nothing on darwin. When darwin bumps to 2.1.117, is `kV` still stable, or does it drift? Probe at step 3 before assuming.
