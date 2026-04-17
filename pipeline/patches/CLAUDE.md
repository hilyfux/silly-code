# pipeline/patches/ — Patch Modules
## Prohibitions
- Using triple-backslash escapes (\\') in MATCH strings → use standard JS escape (\') to match binary content (f3ed5f9)
- Referencing outer-scope variables in adapter/auth functions → they're .toString()'d and injected into minified binary
- Using require()/module/exports/__dirname in serialized functions → only await import('node:...') allowed
## When Changing
- MATCH constants → edit pipeline/match-registry.cjs (shared by patch modules + upgrade tools)
- Provider configs → @pipeline/patches/providers/CLAUDE.md
- Patch numbering → check ordering: provider-core(10-15) → provider-ux(50-55) → provider-identity(60-67)
- Adding new provider → update _providers.cjs loader + provider-core.cjs
## Conventions
- Each .cjs exports function({patch, patchAll}) → void
- Provider patches split by change vector: core (detection/injection), ux (menu/context), identity (display/prompts)
- provider-engine.cjs is a thin wrapper delegating to core → ux → identity
- _providers.cjs loads and validates all provider configs once (shared state)
- checkSerialization() in provider-core.cjs validates injected code
- MATCH object in pipeline/match-registry.cjs centralizes all upstream binary match strings
