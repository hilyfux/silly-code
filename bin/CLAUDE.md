# bin/ — Launcher Scripts
## Prohibitions
- Hardcoding single auth filename → breaks detection when adapter writes refreshed token to -auth.json (a3e93f1)
- Duplicating color/logging vars → source silly-common.sh instead (4e77469)
- Spawning python3 for timestamp checks → use pure bash stat (4e77469)
## When Changing
- Auth file naming → @pipeline/patches/providers/CLAUDE.md (adapter writes -auth.json on refresh)
- Build/patch logic → @pipeline/CLAUDE.md
## Conventions
- silly = management CLI (status/login/logout/doctor/update)
- sillyx/sillyt/sillye = provider launchers, source silly-common.sh
- Shared functions go in silly-common.sh (ensure_patched_binary, logging)
- All launchers check both -auth.json and -oauth.json for login detection
