# Evals (v1 — Deprecated)

> **These eval files are from the v1 source-code architecture and cannot run under the current v2 patch pipeline.**
> They use `bun:test` imports and reference v1 modules that no longer exist at runtime.
> Kept as design references for future eval framework migration to Node.js + assert style.

## Current test runner

```bash
# v2 tests (working)
node tests/base.test.cjs && node tests/schema.test.cjs
```

## Original v1 eval categories (for reference)

| Category | Tests | What it measures |
|----------|:-----:|-----------------|
| provider-routing | 3 | Correct model selection per task type |
| provider-fallback | — | Fallback engine decision logic |
| fallback-integration | — | Fallback wired into hot path |
| computer-use-safety | 6 | All 6 security gates fire correctly |
