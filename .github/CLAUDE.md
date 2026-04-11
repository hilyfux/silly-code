# .github/ — GitHub Configuration
## Prohibitions
- Referencing src/ entrypoints or bun test → project uses patch pipeline, not source build
## When Changing
- CI test commands → must match tests/ runner: node tests/base.test.cjs && node tests/schema.test.cjs
- Build step → node pipeline/patch.cjs
## Conventions
- CI runs on Node 20 (no bun runtime needed for tests/build)
- Tests are plain Node assert-style .cjs files
