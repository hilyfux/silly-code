#!/usr/bin/env node
process.env.SILLY_TARGET_COMMAND = 'silly';
await import('./silly-launcher.js');
