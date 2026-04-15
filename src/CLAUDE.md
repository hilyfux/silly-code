# src/ — Legacy v1 Reference
## Prohibitions
- Editing src/ to fix runtime bugs → runtime binary is pipeline/build/cli-patched.js; patches in pipeline/patches/ own behaviour.
- Treating src/services/provider as the live contract → Copilot was dropped on 960bac2; tests/provider/ is canonical now.
## When Changing
- Runtime behaviour → @pipeline/patches/CLAUDE.md
- Provider contract → @tests/provider/CLAUDE.md
- Launcher surface → @bin/CLAUDE.md
## Conventions
- Read-only historical reference; contributions go through the patch pipeline instead.
