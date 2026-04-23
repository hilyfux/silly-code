# installer/ — Public-mirror install scripts
## Prohibitions
- Calling `Invoke-WebRequest` before forcing TLS 1.2 → PowerShell 5.x defaults reject GitHub TLS, surfacing as "基础连接已经关闭: 发送时发生错误"
- Hardcoding `bin\.lib\` paths in .cmd templates → must mirror `pipeline/package-release.cjs::libFromBin` layout exactly
- Dropping `-UseBasicParsing` from Invoke-WebRequest → IE-engine path needs IE first-run config; -UseBasicParsing is the safe cross-host default
- Editing `install.sh` or `install.ps1` and forgetting `installer/uninstall.{sh,ps1}` parity → install/uninstall must touch the same paths
## When Changing
- .cmd template → @pipeline/CLAUDE.md (release tarball layout: `bin/.lib/<name>.js` + `versions/<ver>` + `.deps/node_modules`)
- Sync workflow → @.github/workflows/CLAUDE.md (sync-installer.yml flattens installer/ to public mirror root)
## Conventions
- TLS 1.2/1.3 OR'd in via `-bor`, never `=` (don't downgrade caller's stronger config)
- All Windows path joins use `Join-Path` (forward/backslash drift)
- Public mirror is hilyfux/silly-code; install URL is `raw.githubusercontent.com/hilyfux/silly-code/main/install.{sh,ps1}` (NO `/installer/` prefix — sync flattens)
