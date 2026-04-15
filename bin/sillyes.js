#!/usr/bin/env node
process.env.SILLY_TARGET_COMMAND = 'sillye';
process.argv.splice(2, 0, '--dangerously-skip-permissions');
await import('./silly-launcher.js');
