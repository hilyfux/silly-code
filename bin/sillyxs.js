#!/usr/bin/env node
if (process.env.SILLY_TRACE_BOOT === '1' || process.env.SILLY_TRACE_BOOT === 'true')
  process.stderr.write(`[silly-boot +0ms] bin/sillyxs.js entry (sillyx + skip-permissions)\n`);
process.env.SILLY_TARGET_COMMAND = 'sillyx';
process.argv.splice(2, 0, '--dangerously-skip-permissions');
await import('./silly-launcher.js');
