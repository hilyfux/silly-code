# pipeline/ — Patch Pipeline
## Prohibitions
- Modifying upstream/ contents → pristine upstream binary, never touch
- Adding patch modules without updating modules array in patch.cjs → silently skipped
## When Changing
- Patch module interface → patch(name, find, replace) and patchAll(name, find, replace)
- Provider patches → @pipeline/patches/CLAUDE.md
## Conventions
- patch.cjs is the orchestrator: loads upstream cli.js, runs modules, writes output
- Modules array order matters: branding → provider-engine → equality → privacy
- Exit code 1 if any patch fails (pattern not found)
- Input: pipeline/upstream/package/cli.js, Output: pipeline/build/cli-patched.js
