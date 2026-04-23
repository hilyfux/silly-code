# .github/workflows/ — CI Workflows
## Prohibitions
- Pinning action SHA without verifying it resolves → 11 consecutive CI failures (1674a8e)
- Referencing src/ or bun test → project uses patch pipeline (@.github/CLAUDE.md)
- Omitting git identity before annotated tag in workflows → task fails with "empty ident name" (7293857)
- `gh issue create --label X` without the label existing on repo → workflow red (6d32082)
- Reintroducing release.yml / dist-tarball publishing → retired in Iter 101 source-install pivot; install is now git clone + patch.cjs, no tarballs
## When Changing
- Action version → prefer `@v4` major-version tag over unverified SHA
- Test/build commands → @.github/CLAUDE.md (must match tests/ runner)
- Upgrade schedule → aligned to upstream release waves: 06:07 + 22:07 UTC (3506336)
- installer/ files → sync-installer.yml mirrors to repo root so install URL works
## Conventions
- Node 20, ubuntu-latest runner
- ci.yml = push/PR gate: unit tests (base + schema + providers) + build patched binary
- upstream-upgrade.yml = 06:07 + 22:07 UTC cron watchdog; opens PR on clean upgrade, Issue on failure. Fallback only — local launchd is primary iteration path.
- sync-installer.yml = fires on push when installer/install.{sh,ps1} or installer/uninstall.{sh,ps1} change; copies them to repo root so raw.githubusercontent.com/.../main/install.sh remains valid
