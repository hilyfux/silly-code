#!/usr/bin/env node
// Pre-launcher watchdog — if the launcher module doesn't load within 5s of
// Node entry, we've hung BEFORE any in-launcher instrumentation (the 30s
// boot watchdog defined inside the launcher) could fire. This covers the
// catastrophic class: ESM import resolution hang, corrupt install, antivirus
// stalling the loader. unref() so clean boots don't block on it; cleared by
// both the success and failure paths of the import below.
const _preBootTimer = setTimeout(() => {
  process.stderr.write(
    '[silly][FATAL] launcher module did not load within 5s of Node entry.\n' +
    '[silly][FATAL] This usually means: ESM import resolution hang, corrupt install, or antivirus blocking.\n' +
    '[silly][FATAL] Try: 1) re-run install.ps1; 2) disable antivirus; 3) run with SILLY_TRACE_BOOT=1.\n'
  );
  process.exit(43);
}, 5_000);
_preBootTimer.unref();
if (process.env.SILLY_TRACE_BOOT === '1' || process.env.SILLY_TRACE_BOOT === 'true')
  process.stderr.write(`[silly-boot +0ms] bin/silly.js entry\n`);
process.env.SILLY_TARGET_COMMAND = 'silly';
try {
  await import('./silly-launcher.js');
  clearTimeout(_preBootTimer);
} catch (e) {
  clearTimeout(_preBootTimer);
  process.stderr.write('[silly][FATAL] launcher import failed: ' + (e && e.message ? e.message : e) + '\n');
  process.exit(44);
}
