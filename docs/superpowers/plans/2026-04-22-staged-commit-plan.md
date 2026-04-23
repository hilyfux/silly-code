# 2026-04-22 — staged commit plan for Iter 20-28 accumulated work

Work from this session accumulated across ~28 /loop iterations and 4 logical themes. Each commit below is self-contained: files + test invariants + a single intent. Commit order matters because later commits depend on earlier ones (parity tests assume the cross-platform capture discipline is in place).

**Before committing anything**: run `npm test` once to confirm the current tree is all-green (6 suites).

---

## Commit 1 — cross-platform patch hardening (Iter 20-21)

Replaces hardcoded single-letter mangled names (`q`, `T`, `M`, `_`, `$`) in FIND regexes with `([\w$]+)` captures threaded through function-replacers. Root cause: per-platform bun bundles mangle names independently — `darwin-arm64` uses one letter, `linux-x64` another, and hardcoding either pins the patch to one platform.

**Files:**
- `pipeline/patches/auth-bypass.cjs`
- `pipeline/patches/branding.cjs`
- `pipeline/patches/equality.cjs`
- `pipeline/patches/privacy.cjs`
- `pipeline/patches/provider-identity.cjs`
- `pipeline/patches/provider-ux.cjs`
- `pipeline/upgrade.cjs` (same discipline applied to LANDMARKS regex)

**Invariant to verify:** `node pipeline/patch.cjs` reports `131 OK, 0 FAIL` on darwin; regex bodies pass dual-platform probe (see `project-upgrade-2.1.117-blocker.md`).

**Suggested message:**
```
fix(patches): capture single-letter mangled vars in FIND regex for cross-platform parity

Per-platform bun bundles mangle identifiers independently — hardcoding any
single-letter var (q, T, M, _, $) in a FIND string pins the patch to one
OS. Every such ident is now captured via ([\w$]+) and threaded through
the replacer via a function, so the replacement mirrors whatever the
upstream bundle happened to assign on each platform.
```

---

## Commit 2 — varmap platform-pin + 2.1.117 draft + rename-sweep scope fix (Iter 23-24)

Adds a `platform` key to varmap files (darwin-arm64 pin today), extends `ci-upgrade.cjs` to throw on platform mismatch, expands Layer-1 coverage with new identifiers (statsigTransport, AnthropicSDK, configVar, defaultContextWindow, etc.), drafts `varmap-2.1.117.json` for the upcoming upstream bump, and includes `match-registry.cjs` in the rename sweep (was previously omitted, causing MATCH.CONSTRUCTOR to stay stale across bumps).

**Files:**
- `pipeline/varmap-2.1.114.json` (platform key + 15+ new Layer-1 entries)
- `pipeline/varmap-2.1.117.json` (new — darwin-arm64 draft, 2.1.117 upstream swap)
- `pipeline/ci-upgrade.cjs` (MATCH_REGISTRY added to PATCH_FILES sweep; platform assertion; stageUpstream enforces pinned platform)
- `pipeline/upgrade-probe.cjs` (skip `platform` key when mapping values)
- `pipeline/match-registry.cjs` (`latestVarmap` prefers varmap matching checked-in upstream version; falls back to highest semver)

**Invariant to verify:** `npm test` all green; `node pipeline/upgrade-probe.cjs` reports `0 unguarded missing`; `SILLY_UPSTREAM_PLATFORM=linux-x64 node pipeline/ci-upgrade.cjs` throws the platform-mismatch error cleanly.

**Suggested message:**
```
feat(ci-upgrade): varmap platform-pin + 2.1.117 draft

varmap identifier mangling is platform-specific (darwin-arm64 vs linux-x64
differ for every Layer-3 name). A `platform` key now marks each varmap;
ci-upgrade.cjs throws if SILLY_UPSTREAM_PLATFORM disagrees with the
resolved bundle, preventing silent patch corruption. match-registry.cjs
is added to the rename sweep so MATCH constants track upstream bumps.
Draft varmap-2.1.117.json lands the identifier set for the next swap.
```

---

## Commit 3 — launcher parity tests (Iter 25-27)

Two new tests guarding string-level duplication between bash launchers, Node launcher, PowerShell installer, and adapter code. Bidirectional drift simulations verify each assertion fires. Closes harness §6 row 3.

**Files:**
- `tests/launcher-parity.test.cjs` (new) — auth filenames + keychain path + adapter coverage
- `tests/provider-flag-parity.test.cjs` (new) — `CLAUDE_CODE_USE_*` across bash/Node/PS/adapter
- `package.json` (wire both into `npm test`)

**Invariant to verify:** `npm test` shows `launcher-parity: PASS` + `provider-flag-parity: PASS`; drift simulation (rename a filename in any one file) fires the assertion.

**Suggested message:**
```
test(parity): guard bash/Node/PS/adapter string duplication

Adapter functions are .toString()-serialized into the minified binary
and can't require/import at runtime, so every constant they reference
must be independently hardcoded in each launcher surface (bash, Node,
PowerShell). The parity tests parse all four surfaces and assert
equality; drift in any one now fails CI instead of silently breaking
login detection or env-flag dispatch.
```

---

## Commit 4 — harness architecture documentation (Iter 22-28)

New `docs/harness-architecture.md` (227 lines: layered map, data flow, invariants, anchor model, per-platform divergence, coupling hotspots, redesign principles, change contract) and a matching `docs/CLAUDE.md` node for the knowledge graph. Captures the actual shape of the harness rather than the legacy v1 docs.

**Files:**
- `docs/CLAUDE.md` (new)
- `docs/harness-architecture.md` (new)

**Invariant to verify:** `wc -l docs/harness-architecture.md` ≥ 220; cross-links to `memory/project-dual-stack-drift-surfaces.md`, `pipeline/CLAUDE.md`, `skills/upstream-upgrade.md` all resolve.

**Suggested message:**
```
docs(harness): architecture map, invariants, per-platform divergence

Captures the actual harness — not the legacy vitepress docs. Layered
map (install → launcher → patch → runtime), invariants (privacy +
equality + identity), tri-layer varmap anchor model, per-platform
bundle divergence, coupling hotspots with current mitigations,
redesign principles distinguishing shipped work from aspirations.
```

---

## Commit 5 — repo-split design + migration plan

Drafted earlier in the session, unrelated to the upstream-upgrade hardening. Can ship separately or together with harness docs depending on preference.

**Files:**
- `docs/superpowers/specs/2026-04-22-repo-split-design.md`
- `docs/superpowers/plans/2026-04-22-repo-split-migration.md`

**Suggested message:**
```
docs(plans): two-repo split design + migration plan

Private silly-code-src for development + public silly-code for
installer/releases bridged via PUBLIC_REPO_PAT. Reference:
memory/project-repo-split.md.
```

---

## Files to NOT commit

- `.knowledge-graph/graph-events.jsonl` — per-session activity log; cleared by `/knowledge-graph update`.
- `.knowledge-graph/work-snapshot.md` — session snapshot.

These are session-local state, not project state.

## Files needing a policy decision

- `package-lock.json` — 244 KB, never committed before, not in `.gitignore`. Two options:
  1. **Commit it** — standard Node practice, guarantees reproducible installs.
  2. **Gitignore it** — some projects prefer this for library-like packages. Add `package-lock.json` to `.gitignore` instead.
- `tests/build-integrity.test.cjs` — 149-line net addition. Verified: adds three invariant blocks asserting that after build, the binary contains replacement markers for all 10 privacy endpoints + the telemetry hosts are gone, tier-bypass patches 20-28 all fired, and identity injection 61/62/63/65/67 + per-provider branches all present. These pair naturally with Commit 1 (patch hardening) since they're the post-build acceptance criteria for those patches. Either fold into Commit 1 OR ship as its own commit:
  ```
  test(integrity): privacy/equality/identity build-time invariant coverage

  Proves after-build that all 10 privacy blocks have their replacement
  markers, upstream telemetry hosts are fully removed, every tier gate
  is bypassed, and identity injection fires for all patched branches.
  Invariant regression = CI red, not a field incident.
  ```

---

## Not yet done (deferred to future sessions)

- **Actual 2.1.117 upstream swap (Iter 33 validated, ready to ship)**: `pipeline/upstream/` is TRACKED (not gitignored), so the swap produces a large pre-formed cli.js diff. Read-only validation done in Iter 33 against `/tmp` confirms:
  - `bun-extract.cjs` succeeds on `@anthropic-ai/claude-code-darwin-arm64@2.1.117` → 13.1MB cli.js, 17868 lines (+5102 vs 2.1.114)
  - `varmap-2.1.117.json` (30 identifier entries + platform pin): 28 resolve uniquely in 2.1.117 bundle; 0 missing; 2 (`AnthropicSDK`→`_`, `configVar`→`K`) are single-letter tokens requiring the Iter 20 FIND-side capture discipline (already in place)
  - All 6 probed MATCH content-anchor tails (`RESOLVE`, `FAMILY`, `DETECT`, `IDENTITY`, `SDK_ID`, `AGENT_ID`) present and uniquely anchorable; new identifiers observed (`XO` for `$T`, `Vh` for `Kd`, `gq` for `uq`, `Jp6` for `qI6`, `EH9` for `joq`, `CH9` for `Doq`) — `contentAnchorRename()` in `ci-upgrade.cjs:480` will auto-pick these up
  - Version string: 2.1.117 ×138 hits, 2.1.114 ×0 — clean bump surface for `bumpVersionRefs()`
  - No net-new telemetry host candidates (`beacon.claude-ai.staging.ant.dev`, `http-intake.logs.us5.datadoghq.com`, `mcp.sentry.dev` all pre-existed in 2.1.114)
  - Swap procedure (once accumulated 15+7 pending files per this plan are landed):
    1. `SILLY_UPSTREAM_PLATFORM=darwin-arm64 node pipeline/ci-upgrade.cjs` — orchestrates fetch+stage+varmap-rename+content-anchor+patch+test
    2. OR manual: `node pipeline/bun-extract.cjs 2.1.117 pipeline/upstream/package && node pipeline/patch.cjs && npm test`
    3. Commit as `feat(upstream): upgrade to 2.1.117` — single focused commit.
  - **Do NOT stack swap on current uncommitted tree** — the cli.js diff is ~13MB tracked; mixing with the Iter 25-32 harness work makes the commit unreviewable. Commit the 5 staged commits from this plan first, clean slate, then swap.
- **Linux varmap draft (Iter 34 DONE — ready to commit)**: `pipeline/varmap-2.1.117-linux-x64.json` shipped with all 29 Layer-3 identifiers resolved via content-anchored probes against the extracted 2.1.117 linux-x64 bun bundle. Loader made platform-aware — `pipeline/ci-upgrade.cjs:loadVarmap()` prefers `varmap-<ver>-<SILLY_UPSTREAM_PLATFORM>.json` when env ≠ darwin-arm64; `pipeline/match-registry.cjs:latestVarmap()` now filters to pure `varmap-<semver>.json` so platform-suffixed drafts never pollute the sort fallback. All 6 test suites green. Suggested commit: `feat(ci): linux-x64 varmap + platform-aware varmap loader (unblocks linux CI pinning)`. Fold into Commit 2 (varmap platform-pin + 2.1.117 draft) since it's the same topic, or ship as a separate follow-up — both are clean.
- **Win32-x64 varmap draft + bun-extract filename fix (Iter 35 DONE — ready to commit)**: `pipeline/varmap-2.1.117-win32-x64.json` shipped with all 29 Layer-3 identifiers resolved against the extracted win32 claude.exe bundle (13.1MB / 18104 lines). **bun-extract.cjs landmine**: line 117 hardcoded `package/claude` — win32 ships `package/claude.exe`, so any CI job pinned to `SILLY_UPSTREAM_PLATFORM=win32-x64` would have thrown `native binary not found` at stage-upstream time. Fixed to scan `[claude, claude.exe]` agnostically. Combined with the Iter 34 loader change, all three platforms are now wireable in CI without further patch work. All 6 test suites green. Suggested commit (fold into Commit 2 as well): `feat(ci): win32-x64 varmap + bun-extract claude.exe fallback`.
- **upgrade.cjs LANDMARKS hardening (Iter 36 DONE — ready to commit)**: three Layer-1 extractor regexes in `pipeline/upgrade.cjs` still violated Iter 20 discipline (hardcoded single-letter param names / non-unique anchors); fixed so `ci-upgrade --auto` produces correct varmap seeds on any platform without relying on `.match()`-returns-first-hit luck. (1) `defaultContextWindow` — was matching 4 distinct idents on 2.1.114, now anchored on sibling-constant tuple (`var X=200000,Y=20000,Z=32000,W=128000,`); (2) `scheduledTasksEnabled_setter` — replaced hardcoded `\(H\)` with `\(([\w$]+)\)` + backref `\2` and adjusted `state_holder` capture idx from 2 to 3; (3) `sessionCronTasks_remover` — same param-backref transform. Also added a **non-breaking uniqueness warning** in `scan()` that re-runs each landmark regex with `/g` and warns when hits > 1 — future regressions where someone loosens an anchor surface visibly instead of silently picking the wrong match. All captures verified identical to prior behavior on darwin 2.1.114 + darwin 2.1.117 + linux 2.1.117 bundles; `npm test` green. Suggested commit: `refactor(upgrade): harden LANDMARKS extractors + add ambiguity warning` — standalone, since it touches only `pipeline/upgrade.cjs` and is orthogonal to the varmap topic of Commit 2.
- **AnthropicSDK latent correctness bug + match-registry guard hardening (Iter 37 DONE — ready to commit)**: exhaustive cross-platform probe of all 16 LANDMARKS revealed `AnthropicSDK (hL)` was matching TWO classes — the primary OAuth SDK and the AnthropicBedrock wrapper — and `.match()`-returns-first won by luck on every bundle. Tightened to anchor on `apiKey:[\w$]+\.token` (OAuth-only discriminator; Bedrock branch reads `apiKey:process.env.AWS_BEARER_TOKEN_BEDROCK` so it's excluded). Tightened `modelAwareProviderResolver` regex to anchor on `\{let\{AnthropicBedrock` destructure (ambiguous but same-captured previously; now explicit). Also hardened 2 of 4 `BARE_INJECT_TOKENS` guards in `pipeline/match-registry.cjs` (`Qi` setter + `YU` remover) — they hardcoded `\(H\)` param which the ci-upgrade rename sweep does not touch; loosened to `\(([\w$]+)\)` + backref `\1` so a future param-mangling change can't trigger a false-alarm guard failure that blocks upgrade. Verified: all 3 platform bundles produce unique captures; post-rename regexes accept simulated 2.1.117 darwin + linux states; `npm test` green. Suggested commit: fold into the `refactor(upgrade): harden LANDMARKS` commit above OR ship as `refactor(match-registry): capture param names via backref to survive upstream param-rename`.
- **Patch 29a/29b + test + skill doc hardening (Iter 38 DONE — ready to commit)**: finished the Iter 20 discipline sweep. (1) `pipeline/upgrade-probe.cjs` audited clean (tokenizes our patch source, not upstream — no concern). (2) `skills/upstream-upgrade.md` gained an "Anchor authoring rules" section with 5 concrete rules so future authors don't reintroduce the landmine class. (3) Full-repo sweep for `\(H\)` found 7 remaining hardcodings (6 patches + 1 test). Probed all 3 platform bundles — empirically stable on all (bun picks `H` deterministically for 1st param slot across darwin/linux), but still luck. (4) Fixed the highest-visibility pair: `pipeline/patches/equality.cjs` patches 29a + 29b now capture params via `([\w$]+)` + backrefs and switch REPLACE from string literal to function-replacer. Loosened `tests/compat.test.cjs:632` assertions from hardcoded `H`/`H,_` to `[\w$]+` so tests track the patch's param-preserving contract. 131/131 patches applied; 61/61 compat tests pass. (5) Deferred: 4 remaining `\(H\)`-patches (provider-ux:53/109/138, equality:68, provider-identity:116) — document in memory, fix when touching those modules. Suggested commit (fold into the LANDMARKS commit or ship separately): `refactor(patches): thread upstream param names through 29a/29b + loosen test assertions`.
- **Iter 38 deferred `\(H\)` patches (Iter 39 DONE — ready to commit)**: completed the 5-patch deferred list from Iter 38. Patches 52b / 53h / 56 / 26 / 67 in `provider-ux.cjs`, `equality.cjs`, `provider-identity.cjs` now capture the bun-mangled param or local via `([\w$]+)` and thread through function-replacer backrefs. Pre-edit uniqueness probe (`/tmp/iter39-probe.cjs`) caught a landmine on 52b — loose `if\(X(Y)\)Z.push(W);` matched 4 sites in the bundle (the `\(H\)` literal had accidentally hidden 3 ambiguities). Restored uniqueness via zero-width lookahead anchor on `process.env.DISABLE_INTERLEAVED_THINKING` (single-occurrence literal). 131/131 patches + 61/61 compat tests + 4/4 provider tests + 19/19 build-integrity tests all green. **New rule**: after any single-letter→capture generalization, run a uniqueness probe; if >1 hit, anchor with a lookahead on a unique nearby string literal. Landmine-adjacent sites discovered but not yet scheduled: `equality.cjs:80` (28a, REPLACE ignores H, LOW), `equality.cjs:91` (28b, multi-param, MED), `auth-bypass.cjs:21` (70, local H, MED), `privacy.cjs:97` (apostrophe-stego multi-param, MED). Suggested commit: `refactor(patches): finish Iter 20 discipline sweep for remaining \(H\) hardcodes`.
- **Secondary `\(H\)` sweep (Iter 40 DONE — ready to commit)**: finished the full Iter 20 discipline sweep at the production-patch layer. Patches `28a` + `28b` in `equality.cjs`, `70` in `auth-bypass.cjs`, `46` in `privacy.cjs` now capture all bun-mangled params/locals via `([\w$]+)` + backrefs. 28b was the boss — multi-param FIND (`H,_,q,K,_`) required capturing 5 slots and renumbering 11 regex groups. Pre-edit uniqueness probe (`/tmp/iter40-probe-v2.cjs`) applies the same `\uXXXX→char` preprocessing as `pipeline/patch.cjs:59-65` to avoid false-MISS on patch 46's Unicode apostrophe branches. `grep '\(H\)\|\bH\b' pipeline/patches/*.cjs` now returns zero — **production patches 100% discipline-compliant**. 131/131 patches + all test suites green. Suggested commit (merge with Iter 39 or standalone): `refactor(patches): complete Iter 20 discipline sweep (28a/28b/46/70)`.
- **Auth file unification** (harness principle #1 next step): emit `bin/.lib/auth-files.sh` from a canonical JSON source at install time so bash and Node truly share, not just parity-test.
- **Codex 0.121.0 → 0.122.0 verified (Iter 31)**: no model-slug drift. One adapter gap remains: new SSE event `response.custom_tool_call_input.delta` (added in `codex-rs/codex-api/src/sse/responses.rs`) is unhandled in `pipeline/patches/providers/_base.cjs`. Next iter: add parallel handler mirroring the `response.function_call_arguments.delta/done` logic at `_base.cjs:489-496`, using `item_id ?? call_id` as block identifier. Small, isolated patch; folds into a `feat(codex-adapter): custom tool-call delta streaming (0.122.0)` commit. Full diff procedure lives in `memory/project-upstream-version-tracking.md`.
