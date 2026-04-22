# silly-code (source)

Private source repo for silly-code. Users should install via the public mirror:
https://github.com/hilyfux/silly-code

## Structure

- `installer/` — install/uninstall scripts synced to public mirror by CI
- `pipeline/` — patch build pipeline
- `bin/` — runtime launchers (silly, sillye, sillyx, ...)
- `skills/` — Claude Code skills
- `.github/workflows/` — CI (sync-installer + release)

## Development

All development happens on `main` of this private repo. CI handles:

- Syncing `installer/` to the public mirror on every push
- Building release tarballs when `deps.json` upstream version changes

**Do not push directly to the public mirror `hilyfux/silly-code` — the bot manages it.**
