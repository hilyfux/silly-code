# silly-code Harness Architecture

> **Harness = everything around the patched `cli.js` that makes silly-code operable.**
> Not the upstream binary itself — the install, launch, auth, upgrade, build, release, and CI surface that wraps it.

Upstream Claude Code ships as a single minified `cli.js`. silly-code does **not** fork the source — it patches the binary via a deterministic pipeline and wraps it in a multi-platform harness that preserves three invariants: **zero telemetry (隐私)**, **zero tier gating (技术平权)**, **identity purity per provider**.

This document describes how the harness is organized today, the invariants it enforces, the coupling hotspots to watch, and the redesign principles that guide future change.

---

## 1. Layered map

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Layer 0 — Distribution                                                  │
│    installer/install.sh, install.ps1, uninstall.sh, uninstall.ps1        │
│    → download release tarball, place in ~/.local/share/silly-code,       │
│      symlink (unix) or wrap (windows) binaries, install ripgrep.         │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 1 — Entry points (bash + node dual stack)                         │
│    bin/silly, sillyx, sillye, sillyes, sillyxs    (bash wrappers, *nix)  │
│    bin/silly.js, sillyx.js, sillye.js, …          (node shims, xplat)    │
│    bin/silly-launcher.js                          (Windows Node dispatch)│
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 2 — Shared launcher contract                                      │
│    bin/silly-common.sh   — bash helpers, PATCHED resolution, auth probe  │
│    bin/silly-auth.js     — canonical auth file manifest (codex/claude)   │
│    bin/lib-deps.sh       — ripgrep vendor resolver                       │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 3 — Management CLI                                                │
│    bin/silly             — status / login / logout / models / doctor /   │
│                            cron / update / report / uninstall            │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 4 — Auto-upgrade daemon                                           │
│    bin/install-upgrade-cron.sh  → launchd (macOS) / crontab (Linux)      │
│    bin/upgrade-check.sh         → fires ci-upgrade + privacy-audit       │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 5 — Build pipeline                                                │
│    pipeline/patch.cjs               (orchestrator, 129 patches)          │
│    pipeline/match-registry.cjs      (MATCH + Layer-3 structural guards)  │
│    pipeline/bun-extract.cjs         (cli.js from bun binary)             │
│    pipeline/upgrade-probe.cjs       (4-tier anchor pre-flight)           │
│    pipeline/upgrade.cjs             (landmark-based rename scanner)      │
│    pipeline/ci-upgrade.cjs          (unattended upgrade runner)          │
│    pipeline/privacy-audit.cjs       (runtime telemetry scan)             │
│    pipeline/package-release.cjs     (tarball packer)                     │
│    pipeline/patches/*.cjs           (branding, provider-engine, equality,│
│                                      privacy, auth-bypass)               │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 6 — Release & CI                                                  │
│    .github/workflows/ci.yml              (3-OS matrix: ubuntu/mac/win)   │
│    .github/workflows/release.yml         (tag + tarball → public mirror) │
│    .github/workflows/upstream-upgrade.yml (nightly auto-upgrade attempt) │
│    .github/workflows/sync-installer.yml  (push installer/ to public)     │
└──────────────────────────────────────────────────────────────────────────┘
```

The patched `cli.js` (**pipeline/build/cli-patched.js**) is the only runtime artifact. Everything else is harness.

---

## 2. User command → runtime data flow

```
user: sillyx "…"
  ↓
bin/sillyx   (bash)                             ← Layer 1
  ├─ source silly-common.sh                     ← Layer 2
  ├─ ensure_patched_binary()  → PATCHED=…       ← Layer 2
  ├─ codex auth probe (dual -auth.json/-oauth.json)
  ├─ export CLAUDE_CODE_USE_OPENAI=1            (provider select)
  └─ exec node "$PATCHED" "$@"
       ↓
pipeline/build/cli-patched.js                   ← upstream 2.1.114 + 129 patches
       ├─ provider-core patch (10, 11-12, 15) intercepts API client factory
       ├─ provider-ux (50-55) adjusts model menu + context
       ├─ provider-identity (60-67) injects non-Claude identity strings
       ├─ equality (20-28) clamps tier to "max", disables loop resurrection
       ├─ privacy (30-48) blocks 10 telemetry endpoints
       └─ branding (01-14) rewrites URLs, names, cache dir
       ↓
   openai/codex adapter (pipeline/patches/providers/openai.cjs)
       → chatgpt.com/backend-api/codex/responses (stream=true)
       → SSE → msgFromOai translator → upstream Claude message shape
       → TUI renders exactly as if from Anthropic API
```

On Windows the bash wrapper is replaced by `bin/silly-launcher.js`, which re-implements the same contract in pure Node.

---

## 3. Invariants the harness guarantees

Three invariants define the product. Each is enforced by a specific patch family and must be verifiable at build time by `tests/build-integrity.test.cjs`.

| Invariant | Enforced by | Verified by |
|-----------|-------------|-------------|
| **Privacy** — zero telemetry, 10 endpoints blocked | `patches/privacy.cjs` (30-48) | `tests/build-integrity.test.cjs` §12 (replacement present + upstream host absent), `pipeline/privacy-audit.cjs` runtime scan, `tests/compat.test.cjs` |
| **Equality** — no tier gating, all users get "max" | `patches/equality.cjs` (20-28) | `tests/build-integrity.test.cjs` §13 (gate bodies rewritten), `tests/compat.test.cjs` |
| **Identity purity** — each provider has its own identity string, no cross-bleed | `patches/provider-identity.cjs` (60-67) | `tests/build-integrity.test.cjs` §14 (IIFE shape + per-provider branch), `tests/providers.test.cjs` |

Additional guarantees:
- **No autonomous persistence** — patches 28a/28b/28c/28d close all three `/loop` cron survival paths (durable JSON, in-memory /clear, session resume td5).
- **No hidden doors** — adapter functions are string-injected into client factory scope; `checkSerialization()` in `provider-core.cjs:16-31` enforces a four-layer build-time block: (a) bare `require()` calls → throw, (b) `module`/`exports`/`__dirname`/`__filename` references → throw, (c) dynamic `import()` of non-`node:` specifiers → throw (only `await import('node:…')` allowed), (d) synthetic `new Function('fetch', code)(mockFetch)` execution catches `SyntaxError` and `TypeError` at build so malformed adapters fail CI red, not at runtime. (ReferenceError from unbound client-scope vars is intentionally not caught — the sandbox cannot bind the live client factory's locals.)
- **No require-time detonation** — all 5 side-effecting entry-point scripts in `pipeline/` carry a require-main guard: `ci-upgrade.cjs` (Iter 80), `patch.cjs` / `upgrade-probe.cjs` / `package-release.cjs` / `privacy-audit.cjs` (Iter 83); `bun-extract.cjs` and `upgrade.cjs` use the older `if (require.main === module) { ... }` wrapper. Locked by `testCiUpgradeRequireGuard` + `testPipelineEntryPointGuards`. A stray `require('./pipeline/ci-upgrade.cjs')` from any diagnostic or test returns in <10ms with zero side effects — the Iter 72-73 incident class is closed at the directory level.
- **No account-state reads** — patch 52 clamp is env-opt-in only; reads no subscription/tier state from the account.

---

## 4. Upstream upgrade anchor model (4 tiers)

The hardest part of the harness is staying aligned with upstream minified renames. Every identifier our patches touch belongs to exactly one tier:

| Tier | Location | Upgrade behavior | Failure mode |
|------|----------|------------------|--------------|
| **1 — varmap** | `pipeline/varmap-<ver>.json` | `ci-upgrade.cjs` auto-diffs + rewrites patch files | Builds fine when mapping updates |
| **2 — content-anchor** | MATCH entries shaped `Tb1="literal tail"` | Auto re-anchor by tail-string search | Loud fail if literal drifts |
| **2b — self-anchored** | `function xW(…)` / `class qh extends …` in MATCH FIND | Rename → patch-time failure | Loud fail (not silent) |
| **3 — bare inject** | Identifiers written only into REPLACEMENT side | **Must be in `BARE_INJECT_TOKENS`** with a structural regex guard | **Silent** if unguarded — build passes, runtime crashes |

Current Layer 3 tokens (2.1.114 baseline): `kV, Qi, YU, Yh`.
`node pipeline/upgrade-probe.cjs` MUST be run before any upgrade attempt — it is the only loud signal for Layer 3 silent-coupling failures.

---

## 4a. Per-platform bundle divergence — **mangling is not shared across OSes**

Since upstream 2.1.113, Anthropic ships `@anthropic-ai/claude-code` as three per-platform optional-dep npm subpackages (`-darwin-arm64`, `-linux-x64`, `-win32-x64`), each embedding a separately `bun --compile`d native binary with its own independently-mangled `cli.js`. Verified on 2.1.117: darwin-arm64 and linux-x64 bundles differ in **5102 source lines and every single-letter mangled identifier** — same AST, different name pool.

**Implication for patches:** a FIND regex that hardcodes single-letter vars (`_`, `$`, `T`, `M`, `O`, `A`, `K`) works on the authoring platform but silently fails (or worse, injects a `ReferenceError`-prone replacement) on the other two. Bun's compile seeds its name pool per-invocation — there is no way to predict which letter a second parameter gets on a different host.

**Discipline (enforced in every regex-FIND patch since Iter 20):**

1. Every mangled identifier in the FIND regex must be captured via `([\w$]+)` — no literal single letters.
2. Every captured name must be threaded through the replacer using `${captured}` / `\N` backreferences — never rewrite a hardcoded letter in the replacement.
3. Before declaring any new regex patch cross-platform ready, probe it against a non-authoring bundle (cached at `/tmp/silly-2.1.117/cli-extracted-linux.js`) and assert **exactly one match on both platforms** via `src.match(new RegExp(re.source, 'g'))?.length === 1`.
4. When a probe shows structural divergence, first assume "missed capture" — use a `/tmp/struct-probe.cjs`-style body dump to confirm AST identity before rewriting anchors. `bun --compile` from identical TypeScript source varies names, not structure; true structural divergence is rare.
5. CI extraction is pinned to one platform via the `silly-code:platform` field in `pipeline/upstream/package/package.json` (written by `bun-extract.cjs::fetchAndStageFromBunBinary` at staging time). `detectPlatform()` infers the staging host's triple (`darwin-arm64`, `linux-x64`, `linux-x64-musl`, `win32-x64`, …); overriding for cross-platform stage uses the explicit `platform` option of `fetchAndStageFromBunBinary()`.
6. Every `varmap-<ver>[-<platform>].json` carries a `platform` key naming the bundle it was drafted against. **Iter 72 hardened `ci-upgrade.cjs::applyVarRenames()` with a two-stage guard** that runs BEFORE any word-boundary rewrite touches patch source:
   - (a) If both `oldMap.platform` and `newMap.platform` are present and differ → throw. Cross-platform rename pairs silently corrupt (Iter 23: `Kd` means `providerFamily` on darwin but `sessionCronTasks_remover` on linux).
   - (b) If `newMap.platform` is present and disagrees with `upstream/package/package.json::silly-code:platform` → throw. The staged upstream bundle and the candidate varmap must describe the same platform.
   - (c) Missing `platform` on either side → soft-skip (back-compat with legacy single-platform varmaps). `varmap-2.1.114.json` was backfilled with `"platform": "darwin-arm64"` by Iter 72 to enable the hard check going forward.

   Prior versions of this doc (pre-Iter-72) claimed the guard read `process.env.SILLY_UPSTREAM_PLATFORM` — that env variable was never consulted by any code path. The actual source of truth is the staged `upstream/package.json`, which is written by `bun-extract.cjs` at extract time and cannot be out of sync with the staged `cli.js`.

**Why this works despite per-platform mangling:** the distributed artifact is `pipeline/build/cli-patched.js` — a single patched JS run under Node. Only the BUILD input is platform-dependent; end users all execute the same patched file. Pinning the build platform + capturing all mangled names in regex patches ensures patches written against one platform's bundle keep applying cleanly even when a future upgrade runs against a different platform's upstream (e.g. CI on linux-x64 while author is on darwin-arm64).

**Varmap schema contract (Iter 71).** Three consumers iterate `varmap-<ver>[-<platform>].json`: `ci-upgrade.cjs::applyVarRenames` (cross-patch word-boundary rewrite), `upgrade-probe.cjs` (classifier), `tests/match-token-drift.test.cjs` (ASYM/COLLISION scanner). All three skip by identical rules:

| Key shape | Meaning | Rewriter behavior |
|-----------|---------|-------------------|
| `platform` | Reserved string meta — pinned build host | Skipped |
| `version` | Reserved string meta — upstream pin | Skipped |
| `_<anything>` | Reserved opaque meta slot (any JSON value) | Skipped |
| everything else | Semantic-key → mangled-name string pair | Participates in rename logic |

`tests/varmap-parity.test.cjs` (gated) asserts this shape: `platform`/`version` must be non-empty strings, `_`-prefixed keys are ignored, all other keys must map to non-empty mangled-name strings. The `_`-prefix reservation future-proofs the "layer-classified varmap" principle (§7 #6) — a future `_layers: { <semKey>: 1|2|2b|3 }` annotation can land without any rewriter change. Non-string values on semantic keys are caught loud, not corrupted silently.

---

## 5. Cross-platform matrix

| Concern | macOS | Linux | Windows | Parity status |
|---------|-------|-------|---------|---------------|
| Installer | `install.sh` | `install.sh` | `install.ps1` | OK |
| Install dir | `~/.local/share/silly-code` | `~/.local/share/silly-code` | `%USERPROFILE%/.local/share/silly-code` | OK (POSIX-style on Win) |
| Launcher | bash wrapper | bash wrapper | Node `silly-launcher.js` | dual-stack duplication — watch drift |
| PATH install | `~/.bashrc` / `~/.zshrc` | `~/.bashrc` / `~/.zshrc` | `.cmd` wrapper + User PATH | OK |
| Auth file | `~/.silly-code/codex-oauth.json` + `-auth.json` | same | `%USERPROFILE%/.silly-code/…` | OK |
| Ripgrep vendor | symlink from system `rg` | symlink from system `rg` | bundled `rg.exe` copy | asymmetric — rename risk on Windows |
| Auto-upgrade trigger | launchd plist (06:07 + 14:07) | crontab entry | `silly cron install` (manual) | Windows user-initiated |
| CI test coverage | `macos-latest` | `ubuntu-latest` | `windows-latest` | OK (2026-04-22) |
| Line endings | LF | LF | LF (enforced via `.gitattributes`) | OK (2026-04-22) |
| Reports (`silly report`) | node impl | node impl | node impl | OK (2026-04-22) |

Known remaining gaps — tracked but not blocking:
1. `install.ps1` does not persist `SILLY_INSTALL_DIR` to User env — relies on `.cmd` wrapper only.
2. `silly-launcher.js` duplicates `silly-common.sh` auth/PATCHED resolution — single source of truth would reduce drift risk.

---

## 6. Coupling hotspots (known, acknowledged)

| # | Location | Risk | Mitigation today |
|---|----------|------|------------------|
| 1 | `silly-launcher.js` walks up 5 parents searching for `versions/` or `pipeline/` | Ambiguous if both exist | Prefer dist path. Dev warning in both doctor implementations: `bin/silly` (`Layout ambiguous: both versions/ and pipeline/ exist`) and `bin/silly-launcher.js::cmdDoctor` (symmetric Node-side check). Both flagged (not fatal — diagnostic). Covered by `tests/install-mode-parity.test.cjs` (Iter 44 added 2 assertions that both doctors emit the warning). |
| 2 | `upgrade-check.sh` spawns `sillyx` on ci-upgrade failure | Potential agent loop | **Current (HEAD):** exit codes 0 (no-op / fast-path / clean / registry-unreachable / missing-sillyx-privacy-only / dedup_skip-privacy-clean) and 1 (unexpected `ci-upgrade.cjs` exit, or `needs_agent` with no sillyx binary); WIP guard protects uncommitted work. **Iter 63** landed the formal EXIT-CODE CONTRACT docstring at the top of the script, locked by `tests/upgrade-check.test.cjs::exit-code contract docstring present`. **Iter 64** landed the KG dedup stamp: a `needs_agent` invocation writes `.knowledge-graph/.upgrade-check-agent-stamp` (format `version\|epoch`) before `exec sillyx`; the next slot checks this file and downgrades `needs_agent → dedup_skip` when the same LATEST is within a 6h window (tunable via `SILLY_UPGRADE_CHECK_DEDUP_WINDOW`). Privacy findings still flow through — each new endpoint always gets eyes. Locked by three new test cases: `dedup skips fresh stamp`, `dedup ignores stale stamp and re-stamps`, `needs_agent run writes stamp before exec`. Test file now carries 6 assertions (was 3 pre-Iter 64). |
| 3 | Bash + Node dual stacks duplicate auth filenames, keychain path, env flag, PATCHED-path resolution | Drift between OSes | **String-level parity tests**: `tests/launcher-parity.test.cjs` (auth filenames + `.credentials.json`), `tests/provider-flag-parity.test.cjs` (`CLAUDE_CODE_USE_*` across bash/Node/PS1/adapter), `tests/install-mode-parity.test.cjs` (dist/dev mode selection + `versions/` listing + PATCHED path shape), `tests/gen-auth-files.test.cjs` (SSoT regenerator idempotency: `bin/silly-auth.js` → `bin/auth-files.sh` via `pipeline/gen-auth-files.cjs`). Bidirectional drift simulations verified. See `memory/project-dual-stack-drift-surfaces.md` for the full taxonomy. |
| 4 | `deps.json` version ↔ `match-registry.cjs` VERSION comment | Manual sync | `ci-upgrade.cjs` bumps both |
| 5 | Windows ripgrep is copy, Unix is symlink | Rename breaks Windows | `silly doctor` resolves both paths — bash side `command -v rg` (POSIX), Node side (`silly-launcher.js::cmdDoctor`, Iter 85) probes `where rg` → falls back to `~/.local/bin/rg.exe` (the installer-shipped copy) → prints warning with install guidance if neither present. |
| 6 | Launchd TCC sandbox rejects `~/Desktop/Documents/Downloads` | User dev tree can't schedule | Guard in `install-upgrade-cron.sh` + explicit error |
| 7 | Auth file schism (`-oauth.json` vs `-auth.json`) | Race during refresh | Dual-name probe in launcher **AND** adapter-side parity check in `tests/launcher-parity.test.cjs` (asserts every filename in `AUTH_FILES.codex` appears in `openai.cjs` adapter body) |
| 8 | `ci.yml` skips `upgrade-check.test.cjs` on Windows (bash-only) | WSL users hit untested path | Documented in ci.yml comment |
| 9 | varmap `platform` key vs `upstream/package/package.json::silly-code:platform` source of truth | Silent corruption if CI switches platform without regenerating varmap | `ci-upgrade.cjs::applyVarRenames` throws on mismatch (Iter 72). `varmap-2.1.114.json` carries `"platform": "darwin-arm64"` (Iter 72 backfill); `2.1.117` drafts ship as `-linux-x64` + `-win32-x64` while darwin regeneration is pending (Iter 74 deleted the ci-upgrade-auto-regenerated 8-key regression — see `memory/project-darwin-2.1.117-varmap-regression.md`). `tests/varmap-parity.test.cjs` (now inline in `npm test` via Iter 74) asserts per-platform semantic-keyset parity *and* `platform` header consistency, detecting both the *sibling* drift (darwin gains a key linux/win32 don't mirror) and the *auto-regen regression* (Layer-3 keys silently stripped). `match-registry.cjs::latestVarmap` filters platform-suffixed drafts so the sort fallback cannot pick a cross-platform varmap in darwin default context. |
| 10 | Release tarball shape (`pipeline/package-release.cjs::{launchers, libFromBin}` + scatter cps) | New `bin/` files silently dropped from tarball, or listed entries silently missing on disk | Bidirectional lock by `tests/release-manifest.test.cjs` (Iter 49/50): **forward** — every listed file + 4 scatter refs must exist, load-bearing subset enforced, duplicates rejected; **reverse** — every regular file in `bin/` must land in `launchers`, `libFromBin`, or an explicit `devOnlyAllowlist` (currently: `CLAUDE.md` only). Stale allowlist entries also rejected. Adds/removes require either a ship path or an explicit reason, no silent gaps. |

---

## 7. Redesign principles (for future iterations)

These are aspirational — the current harness works, but deliberate refactors should follow these principles:

1. **Single source of truth per concern.** Auth file names, PATCHED path resolution, provider env flags — each should live in exactly one module. Bash and Node entry points import it; no duplicated logic. *Current state:* `bin/silly-auth.js` is the canonical manifest for auth filenames + macOS keychain path; `pipeline/gen-auth-files.cjs` derives `bin/auth-files.sh` from it; `bin/silly-common.sh` sources the generated shim (with hardcoded fallback for zero-regression back-compat); `tests/gen-auth-files.test.cjs` asserts byte-equal idempotency, and the installer packaging (`pipeline/package-release.cjs::libFromBin`) ships the shim alongside other bash helpers. PowerShell installer does not encode auth filenames (verified Iter 42). Next step: once the sourced path has stabilized across a release cycle, retire the hardcoded fallback in `silly-common.sh` so the shim is the only path. PATCHED-path resolution still dual-stacks between `bin/silly-launcher.js` (Windows Node) and `bin/silly-common.sh` (bash) — contract enforced by `tests/install-mode-parity.test.cjs` (Iter 43); genuine unification would require a bash-safe config format shared with Node (deferred until demand justifies the complexity).
2. **Explicit install-mode contract.** Replace 5-level path walk with `SILLY_INSTALL_DIR` env + a `.silly-install-root` marker file. Dev vs dist is explicit, never inferred. *Current state:* `SILLY_INSTALL_DIR` is already consulted by `bin/silly-launcher.js::getInstallRoot` (Windows `.cmd` wrappers set it); bash launchers still 5-level walk. Dev/dist ambiguity is partially mitigated today via doctor warnings (`bin/silly` + `silly-launcher.js::cmdDoctor` both flag `Layout ambiguous: both versions/ and pipeline/ exist`) and PATCHED path contract test (`tests/install-mode-parity.test.cjs`, Iter 43). No `.silly-install-root` marker file yet — deferred until demand justifies touching three installer scripts.
3. **Build-time invariant verification.** `tests/build-integrity.test.cjs` should assert presence of every privacy block, every tier-bypass, every identity injection. Invariants regressing = CI red, not a field incident.
4. **Platform-specific modules with identical exports.** `platform/unix.js` + `platform/windows.js` share one interface (`installDeps`, `scheduleUpgradeCheck`, `getAuthDir`, …). No `if (isWin)` in main launchers. *Current state:* not landed. `bin/silly-launcher.js:13,57` still gates on `isWindows = process.platform === 'win32'` inline; a dedicated `platform/` module tree does not exist. Low priority — the current branching is small (≤5 sites, all in silly-launcher.js) and covered by `tests/install-mode-parity.test.cjs` + `tests/launcher-parity.test.cjs`. Refactor only when branching count grows beyond a review-at-a-glance threshold.
5. **Stateless upgrade coordination.** Separate "is there a new version?" and "can patches auto-fix?" from "run tests + commit + push". Dry-run mode first-class. No infinite retry loops. *Current state:* partial. `pipeline/upgrade-probe.cjs` gives "is there a new version?" + "can patches auto-fix?" as a standalone pre-flight; `pipeline/ci-upgrade.cjs` still bundles stage + test + commit + push as a top-level IIFE (`ci-upgrade.cjs:596`) — **Iter 80 landed the `require.main === module` guard** at line 603 + **Iter 81 locked it at build-integrity level**, so `require('./ci-upgrade.cjs')` is now a safe no-op and removal trips CI red (blocks the Iter 72-73 incident class). **Iter 82 landed dry-run v1**: `SILLY_CI_UPGRADE_DRY_RUN=1` env flag short-circuits main() after version diagnostics and before any mutation stage, printing the 7-stage plan and exiting 0 cleanly; build-integrity-locked via two extra assertions in `testCiUpgradeRequireGuard` (DRY_RUN const declaration + branch with process.exit). Smoke-verified zero git-status diff vs. baseline. **Iter 83 generalized the guard discipline to the whole `pipeline/` directory**: added the same `if (require.main !== module) return;` guard + 4–6 line rationale comment to `pipeline/patch.cjs`, `pipeline/upgrade-probe.cjs`, `pipeline/package-release.cjs`, `pipeline/privacy-audit.cjs` (the four remaining side-effecting entry points), and locked all four in `tests/build-integrity.test.cjs::testPipelineEntryPointGuards` via a single shared-regex loop. Smoke test: require() of each returns in ≤7ms with zero git-status diff. `pipeline/bun-extract.cjs` and `pipeline/upgrade.cjs` were already wrapped in the older `if (require.main === module) { ... }` idiom pre-Iter-83. Result: all 5 side-effecting entry points in `pipeline/` are now defence-in-depth against accidental require-edge detonation — see `memory/project-pipeline-require-time-audit.md` for per-file audit status. Remaining future work in §7 (per `memory/project-ci-upgrade-dry-run-gap.md`): (a) **v2 per-stage dry-run** — thread dry-run through `applyVarRenames` + `applyRenamesAcrossPatches` so diagnostic runs print the rename table + per-file hunks (not just the 7-stage plan), useful as a review artifact before a real 2.1.117 upgrade commit; (b) split commit/push into a separate stage invoked only after local rebuild + test pass.
6. **Layer-classified varmap.** Extend `varmap-<ver>.json` entries with `{layer: 1|2|2b|3}` so `ci-upgrade.cjs` can differentiate auto-safe from human-required attention. *Iter 71 landed the schema foundation:* all three varmap consumers (`applyVarRenames`, `upgrade-probe`, `match-token-drift`) now skip `_`-prefixed reserved meta keys and non-string values; `varmap-parity.test.cjs` asserts the shape. A future `_layers: { <semKey>: 1|2|2b|3 }` annotation can land as a pure-additive JSON change with zero rewriter edits — the rewriter will ignore it while `upgrade-probe.cjs` gains a new read path to raise human-attention flags on Layer-3 renames.
7. **Harness integration tests.** Docker containers with fresh `HOME` dirs exercising `silly login`, `silly doctor`, `silly cron install`. Path-discovery bugs caught pre-release. *Current state:* weak form landed via GitHub Actions matrix (`macos-latest` + `ubuntu-latest` + `windows-latest` runners have fresh `HOME` each run), but no explicit Docker fixtures or end-to-end `silly login`/`doctor`/`cron install` exercise. The matrix catches patch-level breakage but does not exercise the user-facing auth/cron commands. Blocker for full landing: `silly login` needs OAuth flow which cannot run unattended; mitigation is to mock the browser callback in a Docker fixture (deferred — demand not yet justified).
8. **Fail loud, never silent.** Every Layer-3 bare-inject token MUST have a structural guard in `BARE_INJECT_TOKENS`. If a rename could pass patch-time and break at runtime, the guard is missing. *Additional discipline (Iter 20+):* every single-letter mangled var referenced in a patch FIND regex MUST be captured via `([\w$]+)` and threaded to the replacer — never hardcoded. Cross-platform failures in practice trace to missed single-letter captures, not to structural AST divergence (bun `--compile` mangles names without rewriting AST). *Patch-body token scan (Iter 57/61):* `tests/match-token-drift.test.cjs` now scans every `.cjs` under `pipeline/patches/**` for bare identifiers that collide with a varmap value on any platform — `BODY_COLLISION_CEILING=0` and `BODY_ASYM_CEILING=0` actively defend against re-introduction of hardcoded mangled tokens like the Iter 61-fixed `auth-bypass.cjs` patch 70 (`Zi5`/`t8`, refactored into a 4-capture structural regex).

---

## 8. Change contract

When editing any harness layer, verify both silly-code tracks (Claude / Codex) remain green:

```bash
node pipeline/patch.cjs                    # must print "129 OK, 0 FAIL" (was 131 pre-Iter 69; patches 13+14 removed as verified dead no-ops)
npm test                                   # full suite (16 scripts, all must PASS — Iter 86 folded 3 orphan tests into the chain):
#   tests/base.test.cjs              — protocol functions (mapModel, msgToOai, SSE)
#   tests/agent-core.test.cjs        — P0 budget tracker unit tests (Iter 86 added)
#   tests/schema.test.cjs            — provider config validation
#   tests/providers.test.cjs         — end-to-end adapter sandbox (Claude + OpenAI)
#   tests/compat.test.cjs            — Claude Code feature × sillyx adapter compat matrix (locked evaluator; invoked by silly-launcher.js::cmdDoctor) (Iter 86 added)
#   tests/build-integrity.test.cjs   — build-time invariants (privacy/equality/identity/BARE_INJECT guards)
#   tests/build-invariants.test.cjs  — runtime-size / structural invariants on pipeline/build/cli-patched.js
#   tests/match-token-drift.test.cjs — MATCH + patch-body scan for cross-platform varmap ASYM/COLLISION (ceilings: MATCH 0/0 post-Iter 69, BODY 0/0 post-Iter 61)
#   tests/varmap-parity.test.cjs     — per-platform varmap triple semantic-keyset + `platform` header parity (Iter 23 silent-corrupt canal; Iter 74 promoted inline to block auto-regen regressions)
#   tests/gen-auth-files.test.cjs    — SSoT regenerator idempotency (bin/silly-auth.js → bin/auth-files.sh) + --check CLI exit-code contract (0 synced / 1 drift / 2 unknown-arg)
#   tests/install-mode-parity.test.cjs — silly-launcher.js ↔ silly-common.sh PATCHED path contract + doctor layout-ambiguity warning parity
#   tests/launcher-parity.test.cjs   — bash ↔ Node auth filenames + keychain path + adapter coverage
#   tests/provider-flag-parity.test.cjs — bash ↔ Node ↔ PowerShell ↔ adapter env-flag dispatch
#   tests/release-manifest.test.cjs  — bidirectional release tarball coverage (forward: listed files exist; reverse: every bin/ file is shipped or explicitly dev-only)
#   tests/upgrade-check.test.cjs     — daily-check script exit-code contract (docstring lock + fallback uses sillyx only + missing-sillyx hard stop)
#   tests/ci-upgrade-kg.test.cjs     — knowledge-graph event emission from ci-upgrade.cjs TEST_MODE runs (Iter 86 added)

npm run test:full                          # alias for `npm test` (Iter 74 collapsed the split — all gated tests promoted inline)
```

A change that passes patch + schema but fails providers is a provider-semantics regression — debug adapter, not patch strings.

A change that passes patch + compat but fails build-integrity has silently relaxed a privacy/equality/identity invariant — reject and diagnose before proceeding.

A change that passes everything locally but fails CI on Windows or macOS is a cross-platform drift — the 3-OS matrix exists exactly to catch these.

---

## 10. 取长补短 — strengths we keep from each upstream, and what silly-code adds

Silly-code bridges two production-grade agents over a shared Anthropic-shaped wire. Each has a domain where it is objectively better; the harness's job is to keep the strength, neutralise the friction, and add the invariants neither upstream guarantees.

| Axis | Claude Code strength (kept) | Codex strength (ported into adapter) | Silly-code add-on (beyond either) |
|------|----------------------------|---------------------------------------|-----------------------------------|
| **Tool-use protocol** | Anthropic content blocks + `input_json_delta` streaming (rendered natively by the upstream TUI) | `response.custom_tool_call_input.delta` for apply_patch-style custom tools | `_base.cjs` bridges: `custom_tool_call` emerges as a native Anthropic `tool_use` block (`_base.cjs:498-509`) so the same TUI renderer works for both. |
| **Session resume** | Anthropic conversation-history replay | Responses API `previous_response_id` chain (stateful server-side) | Provider-aware resume: Claude branch replays locally, OpenAI branch threads `previous_response_id` via adapter — user sees one UX. |
| **Long-context** | Prompt caching with `beta:prompt-caching-*` headers (1h TTL post-patch 48/48b) | GPT-5's server-side continuation / incomplete-with-continuation | Patch 52 1M clamp is env-opt-in (`SILLY_ENABLE_1M_CONTEXT`) and never reads account state; patch 48/48b guarantees 1h TTL independent of overage flag. |
| **Error surfacing** | HTTP-level error envelope | SSE `response.failed` / `response.error` / `response.incomplete` events | `_base.cjs:520-530` surfaces all three SSE failure modes as `ctrl.error(…)` so the agent loop never silently hangs (historical pitfall — see `memory/project-hard-lessons.md`). |
| **Identity / branding** | Claude identity strings | GPT/Codex identity strings | Patches 60-67 inject per-provider identity so firstParty never leaks GPT naming and openai never leaks Claude naming — enforced by `tests/build-integrity.test.cjs §14`. |
| **Model selection UX** | Claude's `/model` picker with availability filtering (MqH) | Codex CLI's implicit model pin | Patch 53b/53g/53h: read-side filter, write-side scrub, MqH whitelist — the three pieces needed for a provider-pure menu without Claude-Code-side pollution into `settings.json`. |
| **Tool-input hygiene** | Anthropic permits `{}` empty inputs | GPT emits `""` for optional string params that upstream backend then rejects | `_cleanToolArgs` in `_base.cjs` strips GPT-empty-string optionals before the `input_json_delta` flush — the fix only shipped in our adapter. |
| **Continuation discipline** | Anthropic natural stop | GPT tends to narrate instead of continuing | `tameSkillPrompts` + `enforceContinuation` in adapter prompt-surgery layer. Narration-streak detection was tested 2026-04-20 (commit `6e15231`) and reverted 11 minutes later (`e01a648`) after live validation showed no improvement against GPT loop narration; do not re-attempt without a concrete reproduction (see `pipeline/patches/CLAUDE.md` prohibition). |
| **Telemetry** | Anthropic default = on (statsig/metrics/feedback/event_logging/growthbook/…) | Codex CLI: rich local telemetry | **Silly-code: zero.** Patches 30-40 block 10 endpoints + patch 45-47 neutralize geo-fingerprinting (timezone + apostrophe steganography + date-separator leak). Verified by `tests/build-integrity.test.cjs §12` + `pipeline/privacy-audit.cjs` runtime scan. |
| **Tier gating** | Claude Code checks account tier before exposing models | Codex CLI: ChatGPT Pro sub gates models server-side | **Silly-code: none.** Patches 20-28 strip all client-side gates; patch 52 clamp is env-opt-in and reads no account state. `tests/build-integrity.test.cjs §13` asserts every gate body is rewritten. |
| **Autonomous persistence** | `/loop` cron, durable `scheduled_tasks.json`, session-resume `td5()` resurrection | Codex CLI background scheduling | **Silly-code: all three paths closed** (patches 28a/28b/28c/28d). /loop crons do not survive `/clear` or session restart; nothing runs except what the user just typed. |
| **Upgrade automation** | Claude Code auto-update to `storage.googleapis.com/…-releases` | Codex CLI: manual npm bump | `pipeline/ci-upgrade.cjs` + 4-tier anchor model (see §4) + nightly `upstream-upgrade.yml`. Silent upgrades are blocked (patch 37); our upgrade is explicit, tested, committed. |
| **Cross-platform** | Anthropic ships per-OS optional-dep npm subpackages | Codex: rust-compiled per-platform | Harness pins build platform via `SILLY_UPSTREAM_PLATFORM` + Layer-3 structural guards (see §4a). Users on all three OSes run the same patched JS. |

**What we deliberately do NOT port:**
- Claude Code's telemetry SDK, feature-flag fetches, shared-session transcripts, or "plugin-install" ingestion — all blocked.
- Codex CLI's sandbox-approvals UX — that's TUI-internal and doesn't cross our wire; adding it would fork source, not patch binary.
- Either upstream's auto-update self-replacement — our `silly update` is a discrete user action running `ci-upgrade.cjs`, not a silent binary swap.

**Guiding principle:** every strength either upstream has that can be expressed at the Anthropic wire shape (tool_use / content_block_delta / previous_response_id in metadata) is portable and belongs in `_base.cjs`. Everything that requires in-TUI behavior changes (slash-commands, sandbox approvals, session UI) stays upstream and we do not touch it — the patch pipeline's contract is "modify the minified binary's decision functions, never its rendering layer." Anything outside that contract is a different project.

---

## 11. References

- `CLAUDE.md` — project root; two-track doctrine + architecture overview.
- `pipeline/CLAUDE.md` — patch pipeline conventions, anchor model.
- `pipeline/patches/CLAUDE.md` — patch module conventions + prohibitions.
- `bin/CLAUDE.md` — launcher prohibitions + auth file manifest.
- `skills/upstream-upgrade.md` — upgrade workflow + probe-first discipline.
- `.knowledge-graph/graph-events.jsonl` — per-upgrade attempt log.
