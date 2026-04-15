import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Auth file basenames — kept in sync with bin/silly-common.sh constants
// and the adapter auth() functions in pipeline/patches/providers/.
export const AUTH_FILES = {
  codex: ['codex-auth.json', 'codex-oauth.json'],
  claude: ['claude-oauth.json'],
};

export const CLAUDE_MACOS_KEYCHAIN = path.join(os.homedir(), '.claude', '.credentials.json');

export function authState(dataDir) {
  const has = (rel) => fs.existsSync(path.join(dataDir, rel));
  const hasCodex = AUTH_FILES.codex.some(has);
  const hasClaude = AUTH_FILES.claude.some(has) || fs.existsSync(CLAUDE_MACOS_KEYCHAIN);
  return { hasCodex, hasClaude };
}
