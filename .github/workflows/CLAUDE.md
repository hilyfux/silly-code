# .github/workflows/ — CI Workflow
## Prohibitions
- Pinning action SHA without verifying it resolves → 11 consecutive CI failures (1674a8e)
- Referencing src/ or bun test → project uses patch pipeline (@.github/CLAUDE.md)
## When Changing
- Action version → prefer `@v4` major-version tag over unverified SHA
- Test/build commands → @.github/CLAUDE.md (must match tests/ runner)
## Conventions
- Node 20, ubuntu-latest runner
- Two steps: unit tests (base + schema) then build patched binary
