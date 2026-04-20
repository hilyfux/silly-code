# pipeline/patches/ — Patch Modules
## Prohibitions
- Using triple-backslash escapes (\\') in MATCH strings → use standard JS escape (\') to match upstream minified content (f3ed5f9)
- Referencing outer-scope variables (closures) in adapter/auth functions → they're serialized via .toString() and injected as string literals into the minified binary; checkSerialization() in provider-core.cjs will throw if require/module/exports/__dirname leak through
- Using require()/module/exports/__dirname/__filename in serialized adapter functions → only `await import('node:...')` is allowed; checkSerialization() enforces this at build time
- Reading `pipeline/patches/providers` as a file path → it is a directory; use `pipeline/patches/providers/<file>.cjs` or list contents first (EISDIR observed)
- Editing MATCH constants directly in patch modules → all MATCH strings live in `pipeline/match-registry.cjs`; patch modules import them read-only
- Injecting bare upstream symbols (Si, Ci, nL, hv, etc.) into REPLACEMENT side without echoing them in FIND string → patch passes at build, crashes silently at runtime when upstream renames; MUST register in BARE_INJECT_TOKENS in match-registry.cjs with a structural regex guard (063f22d)
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
