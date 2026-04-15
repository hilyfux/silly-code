#!/usr/bin/env node
process.env.SILLY_TARGET_COMMAND = 'sillyx';
await import('./silly-launcher.js');
