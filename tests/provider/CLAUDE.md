# provider
## Prohibitions
- Reintroducing removed provider expectations in provider registry tests → diverges from the current two-provider product surface and causes false failures.
- Asserting provider order loosely when the contract is exact → misses accidental registry drift.
## When Changing
- Changing supported provider ids or descriptors → @tests/CLAUDE.md
- Changing legacy reference-layer provider tests in this folder → @tests/CLAUDE.md
## Conventions
- These tests track the current supported provider contract in `src/services/provider`: `claude` and `codex` only.
