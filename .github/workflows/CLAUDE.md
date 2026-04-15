# .github/workflows/ — CI Workflows
## Prohibitions
- Pinning action SHA without verifying it resolves → 11 consecutive CI failures (1674a8e)
- Referencing src/ or bun test → project uses patch pipeline (@.github/CLAUDE.md)
- Omitting git identity before annotated tag in release workflow → task fails with "empty ident name" (7293857)
- `gh issue create --label X` without the label existing on repo → workflow red (6d32082)
## When Changing
- Action version → prefer `@v4` major-version tag over unverified SHA
- Test/build commands → @.github/CLAUDE.md (must match tests/ runner)
- Upgrade schedule → aligned to upstream release waves: 06:07 + 22:07 UTC (3506336)
## Conventions
- Node 20, ubuntu-latest runner
- ci.yml = push/PR gate: unit tests (base + schema + providers) + build patched binary
- upstream-upgrade.yml = 06:07 + 22:07 UTC cron watchdog; opens PR on clean upgrade, Issue on failure. Fallback only — local launchd is primary iteration path.
- release.yml = fires on main push when deps.json or cli.js changes; tags v<upstream-version> + publishes GitHub release
