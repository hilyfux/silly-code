# pipeline/patches/providers/ — Provider Configs
## Prohibitions
- Adding require() or module-scope refs in adapter/auth functions → serialization safeguard will reject (bf38f75)
- Manually editing sentinel-injected tables in adapter functions → they are auto-generated from file-top constants by provider-core.cjs
- Using bare import() without 'node:' prefix → checkSerialization blocks non-node imports
## When Changing
- Shared protocol functions → @pipeline/patches/providers/_base.cjs has mapModel, msgToOai, flattenSystem, oaiToAnthropicResponse, SSE streams
- Auth file naming → update bin/ launchers too @bin/CLAUDE.md
- Adding new provider → needs unique key, runtimeId, envKey, priority; engine validates schema
- Patch module changes → co-changes frequently with @pipeline/patches/CLAUDE.md (cochange freq 8)
## Conventions
- _base.cjs = shared functions serialized into same scope as adapters
- Each provider .cjs exports: key, runtimeId, envKey, priority, identity, models, contextWindow, tierNames, adapter, auth
- claude.cjs = default/fallback (envKey:null, priority:null, no adapter)
- Auth returns {headers, kind} — not bare token
- Adapter functions named _${key}Adapter, auth named _${key}Auth
