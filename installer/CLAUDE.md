# installer/ — Open-source install scripts
## Prohibitions
- Reintroducing curl-tarball download → caused Iter 100 Windows TLS cascade + bin\.lib\ relocation bugs; install.{sh,ps1} must use `git clone` only
- Running ANY `npm install` (Iter 102): the install must be complete after git clone + patch.cjs. ws is vendored at `vendor/ws/`; patch.cjs deploys it. Reintroducing runtime fetches resurrects the Iter 101 ESM crash class.
- Deleting `pipeline/build/package.json` after patch.cjs writes it → Node walks up to repo root, finds upstream `{type:module}`, treats cli-patched.js as ESM, crashes on `exports is not defined` (Iter 101 root-cause)
- Editing `install.sh` or `install.ps1` and forgetting `installer/uninstall.{sh,ps1}` parity → install/uninstall must touch the same paths
- PowerShell 5.x: calling `Invoke-WebRequest` before forcing TLS 1.2 → defaults reject GitHub TLS, "基础连接已经关闭" (kept here in case any optional download path returns)
## When Changing
- Runtime dep model → @pipeline/CLAUDE.md (cli-patched.js externally requires `ws`; resolution walks up from pipeline/build/)
- Test parity → tests/install-mode-parity.test.cjs locks the vendored-ws contract: vendor/ws/ committed, patch.cjs deploys, install scripts run zero npm-install commands
## Conventions
- Source-install model: git clone → node pipeline/patch.cjs (deploys vendored ws) → ~/.local/bin wrappers. Zero downloads at install or runtime.
- All Windows path joins use `Join-Path` (forward/backslash drift)
- .cmd wrappers just call `node "<install>\bin\<cmd>.js"` directly — no SILLY_INSTALL_DIR threading, no NODE_PATH, no double-spawn (eliminates Iter 100 class)
- Public repo is hilyfux/silly-code; install URL is `raw.githubusercontent.com/hilyfux/silly-code/main/install.{sh,ps1}` (root, not under /installer/)
