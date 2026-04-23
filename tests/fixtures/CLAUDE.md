# fixtures
## Prohibitions
- Adding real credentials, bearer tokens, or production payloads → hermetic adapter tests become unsafe and invalid
- Using live network assumptions or environment-dependent fields → fixture behavior becomes non-deterministic across platforms
## When Changing
- If a fixture shape is used by providers.test.cjs adapter scenarios → @/Users/wanglinqing/Desktop/workspace-desktop/silly-code/tests/CLAUDE.md
- If a fixture encodes provider-system prompt behavior → @/Users/wanglinqing/Desktop/workspace-desktop/silly-code/pipeline/patches/providers/CLAUDE.md
## Conventions
- Fixtures are canonical Anthropic-format JSON bodies consumed by tests/providers.test.cjs
- Keep fixtures minimal, deterministic, and evidence-based
- Prefer one behavior surface per fixture so failing scenarios are easy to localize
