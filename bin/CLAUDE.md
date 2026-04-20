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
