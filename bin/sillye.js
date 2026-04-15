#!/usr/bin/env node
process.env.SILLY_TARGET_COMMAND = 'sillye';
await import('./silly-launcher.js');
