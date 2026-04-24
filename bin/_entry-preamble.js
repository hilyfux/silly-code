// Shared entry preamble for bin/{silly,sillye,sillyx,sillyes,sillyxs}.js.
// Each shim is now: `runEntry('<target>', { skipPermissions: bool })`.
// See bin/CLAUDE.md for the exit-code contract (43/44) and SILLY_TRACE_BOOT hint.
//
// Pre-launcher watchdog — if the launcher module doesn't load within 5s of
// Node entry, we've hung BEFORE any in-launcher instrumentation (the 30s
// boot watchdog defined inside the launcher) could fire. This covers the
// catastrophic class: ESM import resolution hang, corrupt install, antivirus
// stalling the loader. unref() so clean boots don't block on it; cleared by
// both the success and failure paths of the import below.
export async function runEntry(targetCommand, options = {}) {
  const skipPermissions = !!options.skipPermissions;
  const _preBootTimer = setTimeout(() => {
    process.stderr.write(
      '[silly][FATAL] launcher module did not load within 5s of Node entry.\n' +
      '[silly][FATAL] This usually means: ESM import resolution hang, corrupt install, or antivirus blocking.\n' +
      '[silly][FATAL] Try: 1) re-run install.ps1; 2) disable antivirus; 3) run with SILLY_TRACE_BOOT=1.\n'
    );
    process.exit(43);
  }, 5_000);
  _preBootTimer.unref();

  const shimName = skipPermissions ? `${targetCommand}s` : targetCommand;
  const tag = skipPermissions ? ` (${targetCommand} + skip-permissions)` : '';
  if (process.env.SILLY_TRACE_BOOT === '1' || process.env.SILLY_TRACE_BOOT === 'true') {
    process.stderr.write(`[silly-boot +0ms] bin/${shimName}.js entry${tag}\n`);
  }
  process.env.SILLY_TARGET_COMMAND = targetCommand;
  if (skipPermissions) process.argv.splice(2, 0, '--dangerously-skip-permissions');

  try {
    await import('./silly-launcher.js');
    clearTimeout(_preBootTimer);
  } catch (e) {
    clearTimeout(_preBootTimer);
    process.stderr.write('[silly][FATAL] launcher import failed: ' + (e && e.message ? e.message : e) + '\n');
    process.exit(44);
  }
}
