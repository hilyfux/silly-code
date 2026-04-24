# bin/ — Launcher Scripts
## Prohibitions
- Hardcoding single auth filename → breaks detection when adapter writes refreshed token to -auth.json (a3e93f1)
- Duplicating color/logging vars → source silly-common.sh instead (4e77469)
- Spawning python3 for timestamp checks → use pure bash stat (4e77469)
- Pointing launchd plist at ~/Desktop or ~/Documents → TCC blocks execution, agent never fires (4e573a3)
- upgrade-check.sh running git operations while WIP dirty → clobbers user edits (18ce23d)
## When Changing
- Auth file naming → @pipeline/patches/providers/CLAUDE.md (adapter writes -auth.json on refresh)
- Build/patch logic → @pipeline/CLAUDE.md
- upgrade-check.sh shell fast-path vs agent path → see ci-upgrade.cjs exit codes (f28e5c0)
## Conventions
- silly = management CLI (status/login/logout/doctor/update/report/cron)
- sillyx/sillye = provider launchers, source silly-common.sh
- upgrade-check.sh = launchd/cron trigger; fast-paths clean upgrades, falls back to claude agent
- install-upgrade-cron.sh = writes StartCalendarInterval plist; prefers ~/.local/share/silly-code
- Shared functions go in silly-common.sh (ensure_patched_binary, logging, update banner)
- All launchers check both -auth.json and -oauth.json for login detection
- Local install binary lives at ~/.local/share/silly-code/pipeline/build/cli-patched.js; after rebuild in dev repo, cp pipeline/build/cli-patched.js ~/.local/share/silly-code/pipeline/build/cli-patched.js to update it

## Silent-hang safety net (Windows P0)
Silent hang on Windows = the worst UX class (no output, no exit code, user cannot self-diagnose).
Two env-flag controls in `silly-launcher.js` + every entry shim in `bin/*.js`:

- **`SILLY_TRACE_BOOT=1`** — prints `[silly-boot +Xms] <tag>` to stderr at every boot milestone.
  Use when a user reports "sillye just hangs". They re-run with this and the trace shows exactly
  where time stops advancing (e.g. `spawn cli-patched.js (…)` with no follow-up = hang is in the
  upstream TUI, not the launcher).
  - PowerShell: `$env:SILLY_TRACE_BOOT=1; sillye`
  - cmd.exe:    `set SILLY_TRACE_BOOT=1 && sillye`
  - bash:       `SILLY_TRACE_BOOT=1 sillye`
- **Boot watchdog** — 30s setTimeout (unref'd) that exits 42 with a clear message if the launcher
  never reaches its spawn handoff. Default-on. Opt-out: `SILLY_NO_BOOT_WATCHDOG=1`.
  Override timeout: `SILLY_BOOT_WATCHDOG_MS=60000`.
  Exit code 42 is a stable contract — shell wrappers / Task Scheduler can special-case it for retry.

Both controls have **zero runtime cost** when their env flag is unset (`if (FLAG)` guards).
`tests/boot-watchdog.test.cjs` locks the contract (watchdog default-on, unref'd, exit 42,
every entry shim traces pre-import, live smoke tests).

### Downstream TUI silent-hang safety net (Iter 103)
The boot watchdog only protects the launcher-side startup path — once we hand off to
`spawn(cli-patched.js)`, control transfers to the upstream Ink/React TUI, which on some
Windows terminals (ConEmu, nested shells, unusual raw-mode paths) can block forever on
its first terminal-size query. `launchProvider` in `silly-launcher.js` now extends the
safety net across that handoff:

- Child is spawned with `stdio: ['inherit', 'pipe', 'pipe']` — stdin stays `inherit`
  (TUI reads keyboard directly), stdout/stderr are piped so the launcher can observe
  the first-output event and forward every byte to the user's terminal.
- First output on stdout OR stderr clears the boot watchdog (reason `first-output-<src>`)
  AND disarms the downstream watchdog. Until then, the child is on borrowed time.
- **`SILLY_DOWNSTREAM_WATCHDOG_MS=30000`** — override the default (10000ms). 10s is
  enough for any healthy cold-start TUI (1-3s observed) but short enough that a real
  hang is caught fast.
- **`SILLY_NO_DOWNSTREAM_WATCHDOG=1`** — disable entirely (old/slow machines, CI probes).
- **Exit code 45** — downstream TUI silent hang (stable contract, mirrors 42 for shell
  wrappers / Task Scheduler retry logic). Message names the likely cause (terminal
  raw-mode incompat) and three workarounds (non-TTY `-p` mode, different terminal,
  env override).
- **Exit code 46** — spawn() itself failed (ENOENT etc.). Distinct from 45 so shell
  wrappers can route "binary missing" separately from "TUI stuck".

`tests/downstream-watchdog.test.cjs` locks the contract (env-flag names, exit codes
45/46, stdio shape, first-output clear+forward, unref'd timer, live smoke tests
verifying silent-child → exit 45 / eager-child → exit 0 / non-zero exit propagation).

### Windows shell detection (patches 87-88)
Upstream's shell-detection (`zs1()` in cli.js) scans a hardcoded POSIX candidate
list — `/bin`, `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin` × `bash`, `zsh`.
None of those paths exist on native Windows (non-WSL), and `process.env.SHELL`
is typically unset there. The result is a hard error — `"No suitable shell
found. Claude CLI requires a Posix shell environment."` — at module load,
before any tool can run.

`pipeline/patches/cross-platform.cjs` patches 87-88 handle this:

- **Patch 87** — on `process.platform==="win32"`, prepend Git-for-Windows
  bash.exe paths to the candidate list (checked via `pq8()` executable probe):
  `C:\Program Files\Git\bin\bash.exe`, `C:\Program Files (x86)\Git\bin\bash.exe`,
  `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`, and the `%ProgramW6432%` variant
  (for ARM64 / 32-on-64 Program Files layouts). Git Bash IS bash (MSYS2-compiled)
  so all of upstream's `buildExecCommand`-generated scripts (`; exit $_ec`,
  `$VAR` expansions, heredoc) run unchanged. No Windows-semantics compromise.
- **Patch 88** — replace the hard error string with actionable guidance
  pointing users to Git for Windows (https://git-scm.com/download/win) or WSL.

**Recommended Windows setup:**
1. **Best:** WSL2 — native bash, POSIX paths, full tooling compatibility.
2. **Good:** Git for Windows — auto-detected by patch 87, zero user config.
3. **Unsupported:** pure cmd.exe / PowerShell without bash installed — patch 88
   will print an actionable error pointing to option 1 or 2.

`tests/build-integrity.test.cjs::testWindowsShellFallback` locks the
`_sillyWinBash` marker, at least one `C:\Program Files\Git\bin\bash.exe` baked
path, the new actionable error text, AND the absence of the upstream "Claude
CLI requires a Posix shell environment" string. If upstream renames the `zs1`
detection anchor, the test fails loud with a pointer back to patch 87/88.
