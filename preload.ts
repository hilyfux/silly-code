const version = process.env.CLAUDE_CODE_LOCAL_VERSION ?? '0.1.0';
const packageUrl = process.env.CLAUDE_CODE_LOCAL_PACKAGE_URL ?? 'silly-code';
const buildTime = process.env.CLAUDE_CODE_LOCAL_BUILD_TIME ?? new Date().toISOString();

process.env.CLAUDE_CODE_LOCAL_SKIP_REMOTE_PREFETCH ??= '1';

// Silly Code: treat as ant user to unlock all internal features
process.env.USER_TYPE ??= 'ant';

Object.assign(globalThis, {
  MACRO: {
    VERSION: version,
    PACKAGE_URL: packageUrl,
    NATIVE_PACKAGE_URL: packageUrl,
    BUILD_TIME: buildTime,
    FEEDBACK_CHANNEL: 'local',
    VERSION_CHANGELOG: '',
    ISSUES_EXPLAINER: '',
  },
});

// Feature flags are unlocked via --feature=FLAG args in bin/silly*.sh
// See bin/silly-common.sh for the full list

// Switch to the current workspace
if (process.env.CALLER_DIR) {
  process.chdir(process.env.CALLER_DIR);
}
