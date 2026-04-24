#!/usr/bin/env node
import { runEntry } from './_entry-preamble.js';
await runEntry('sillyx', { skipPermissions: true });
