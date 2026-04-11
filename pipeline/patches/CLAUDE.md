# pipeline/patches/ — Patch Modules
## Prohibitions
- Using triple-backslash escapes (\\') in MATCH strings → use standard JS escape (\') to match binary content (f3ed5f9)
- Referencing outer-scope variables in adapter/auth functions → they're .toString()'d and injected into minified binary
- Using require()/module/exports/__dirname in serialized functions → only await import('node:...') allowed
## When Changing
- MATCH constants → grep upstream binary first; upstream updates break match strings
- Provider configs → @pipeline/patches/providers/CLAUDE.md
- Patch numbering → check for ordering conflicts in provider-engine.cjs
## Conventions
- Each .cjs exports function({patch, patchAll}) → void
- provider-engine.cjs replaces old providers.cjs + identity.cjs + platform.cjs
- checkSerialization() validates injected code: static scan + execution verification
- MATCH object centralizes all upstream binary match strings for easy upgrade
