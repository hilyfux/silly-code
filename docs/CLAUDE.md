# docs/ — Project Documentation
## Prohibitions
- Writing aspirational specs without repo evidence → drift from reality (@docs/superpowers/specs/CLAUDE.md)
- Documenting v1 `src/` structure as current → project is v2 patch pipeline (@docs/reference/CLAUDE.md)
- Treating docs/index.md as canonical → legacy vitepress hero; silly-code truth lives in subsystem CLAUDE.md + specs
## When Changing
- Harness layer → @docs/harness-architecture.md
- Upstream upgrade workflow → @skills/upstream-upgrade.md
- Architecture specs → @docs/superpowers/specs/CLAUDE.md
## Conventions
- Subsystem docs live under docs/<subsystem>/ with their own index.md + CLAUDE.md
- Specs dated YYYY-MM-DD-<topic>-design.md under docs/superpowers/specs/
- Migration plans under docs/superpowers/plans/
- Cross-link via relative paths, not absolute URLs
