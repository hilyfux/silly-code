#!/usr/bin/env node
if (process.env.SILLY_TRACE_BOOT === '1' || process.env.SILLY_TRACE_BOOT === 'true')
  process.stderr.write(`[silly-boot +0ms] bin/sillyx.js entry\n`);
process.env.SILLY_TARGET_COMMAND = 'sillyx';
await import('./silly-launcher.js');
