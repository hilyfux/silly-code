# installer/ — Open-source install scripts
## Prohibitions
- Reintroducing curl-tarball download → caused Iter 100 Windows TLS cascade + bin\.lib\ relocation bugs; install.{sh,ps1} must use `git clone` only
- Running `npm install` from $INSTALL_DIR root → repo's package.json has 80+ dev deps (646MB); install ws into pipeline/build/node_modules with throwaway package.json instead
- Editing `install.sh` or `install.ps1` and forgetting `installer/uninstall.{sh,ps1}` parity → install/uninstall must touch the same paths
- PowerShell 5.x: calling `Invoke-WebRequest` before forcing TLS 1.2 → defaults reject GitHub TLS, "基础连接已经关闭" (kept here in case any optional download path returns)
## When Changing
- Runtime dep model → @pipeline/CLAUDE.md (cli-patched.js externally requires `ws`; resolution walks up from pipeline/build/)
- Test parity → tests/install-mode-parity.test.cjs locks the contract that both installers `git clone` + install ws under pipeline/build/node_modules
## Conventions
- Source-install model: git clone → node pipeline/patch.cjs → ws install → ~/.local/bin wrappers
- All Windows path joins use `Join-Path` (forward/backslash drift)
- .cmd wrappers just call `node "<install>\bin\<cmd>.js"` directly — no SILLY_INSTALL_DIR threading, no NODE_PATH, no double-spawn (eliminates Iter 100 class)
- Public repo is hilyfux/silly-code; install URL is `raw.githubusercontent.com/hilyfux/silly-code/main/install.{sh,ps1}` (root, not under /installer/)
