# pipeline/patches/ — Patch Modules
## Prohibitions
- Using triple-backslash escapes (\\') in MATCH strings → use standard JS escape (\') to match upstream minified content (f3ed5f9)
- Referencing outer-scope variables (closures) in adapter/auth functions → they're serialized via .toString() and injected as string literals into the minified binary; checkSerialization() in provider-core.cjs will throw if require/module/exports/__dirname leak through
- Using require()/module/exports/__dirname/__filename in serialized adapter functions → only `await import('node:...')` is allowed; checkSerialization() enforces this at build time
- Reading `pipeline/patches/providers` as a file path → it is a directory; use `pipeline/patches/providers/<file>.cjs` or list contents first (EISDIR observed)
- Editing MATCH constants directly in patch modules → all MATCH strings live in `pipeline/match-registry.cjs`; patch modules import them read-only
- Injecting bare upstream symbols (Si, Ci, nL, hv, etc.) into REPLACEMENT side without echoing them in FIND string → patch passes at build, crashes silently at runtime when upstream renames; MUST register in BARE_INJECT_TOKENS in match-registry.cjs with a structural regex guard (063f22d)
- Leaving durable scheduled-task persistence (`.claude/scheduled_tasks.json`) enabled → tasks armed in one project auto-resume in fresh sessions of unrelated projects after `/clear`; autonomous work the user didn't schedule. Patches 28a/28b neuter Qy6 (read) and UR8 (write) to session-only
- Patching only one of the three loop cron survival paths → the other two leak: (1) durable json (28a/28b), (2) in-memory crons surviving /clear (28c), (3) td5() resurrecting crons from conversation history on resume (28d). All three must be blocked together or the loop self-replicates
- Gating isLoopDynamicEnabled() (J91) behind an env var to suppress ScheduleWakeup → breaks /loop entirely because the tool is deregistered; the correct fix is patch 28d (neuter td5 resurrection) + patch 28c (/clear cleanup)
- Adding narration-streak detection to enforceContinuation() in _base.cjs → validated ineffective for GPT loop narration; reverted. Do not re-attempt without a concrete reproduction showing it works
- Patching only the additionalModelOptionsCache READ side (53b) → sillyx still writes gpt-* models into settings.json, polluting the real claude code picker; must also patch WRITE side (53g) to emit [] for openai provider
- Adding a model to the menu via _sO47 when it's fast-mode-only (e.g. claude-opus-4-6) → MqH availability filter strips it from BMH output; must also whitelist it in MqH (patch 53h)
## When Changing
- MATCH constants → edit pipeline/match-registry.cjs (shared by patch modules + upgrade tools)
- Provider configs → @pipeline/patches/providers/CLAUDE.md
- Patch numbering → check ordering: provider-core(10-15) → provider-ux(50-55b/53g/53h) → provider-identity(60-67); equality(20-28): 27 shutdown-cancel, 28a/28b durable-scheduler-disable, 28c clear-cancels-loop, 28d no-cron-resurrect
- Adding new provider → update _providers.cjs loader + provider-core.cjs
## Conventions
- Each .cjs exports function({patch, patchAll}) → void
- Provider patches split by change vector: core (detection/injection), ux (menu/context), identity (display/prompts)
- provider-engine.cjs is a thin wrapper delegating to core → ux → identity
- _providers.cjs loads and validates all provider configs once (shared state)
- checkSerialization() in provider-core.cjs validates injected code
- MATCH object in pipeline/match-registry.cjs centralizes all upstream binary match strings
