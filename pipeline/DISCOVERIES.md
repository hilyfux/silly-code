# Reverse Engineering Discoveries

## 2026-04-10: Initial Pipeline Verification

### Discovery 1: Binary Format
- **Native binary** (`~/.local/share/claude/versions/2.1.100`) is 191MB Mach-O arm64
- Contains `@bytecode` — Bun compiled bytecode, NOT directly patchable JS
- Sentinel: `---- Bun! ----` at end of binary
- Strings are readable but code logic is bytecode

### Discovery 2: npm Package Contains Raw JS
- `npm pack @anthropic-ai/claude-code` → 18MB tgz
- Contains `cli.js` (13.5MB) — **minified but readable JS source**
- This is the patchable artifact, NOT the native binary
- `node cli.js --version` runs directly → `2.1.100 (Claude Code)`
- Also contains: `vendor/` (ripgrep, audio-capture, seccomp), `sdk-tools.d.ts`

### Discovery 3: MACRO Constants Location
- `VERSION:"2.1.100"` appears 127 times in cli.js (inlined at every usage site)
- `PACKAGE_URL:"@anthropic-ai/claude-code"` — 127 occurrences
- `FEEDBACK_CHANNEL`, `README_URL`, `ISSUES_EXPLAINER` — same pattern
- All are string literals, trivial to sed/replace

### Discovery 4: getAPIProvider Function
- **Offset**: ~2,287,347 in cli.js
- **Pattern**: `return B6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock":B6(process.env.CLAUDE_CODE_USE_FOUNDRY)?"foundry":...:"firstParty"`
- `B6()` is the `isEnvTruthy()` helper (maps from v2.1.87 source: `src/utils/envUtils.ts`)
- Provider chain: BEDROCK → FOUNDRY → ANTHROPIC_AWS → MANTLE → VERTEX → firstParty
- **No OPENAI or COPILOT** in original — we inject at the start of the chain
- Adjacent function `Zr()` is `getAPIProviderForStatsig()` (just wraps `dq()`)
- Adjacent function `u08()` checks mantle override

### Discovery 5: Bun Compile Works
- `bun build --compile cli-patched.js --outfile silly` → 75MB binary
- Binary runs correctly: `./silly --version` → `2.1.100-silly (Claude Code)`
- Compile time: ~600ms

### Discovery 6: Variable Name Mapping (v2.1.87 → v2.1.100 minified)
| Source (v2.1.87) | Minified (v2.1.100) | Purpose |
|---|---|---|
| `isEnvTruthy()` | `B6()` | Env var boolean check |
| `getAPIProvider()` | `dq()` | Provider detection |
| `getAPIProviderForStatsig()` | `Zr()` | Analytics provider |
| `MACRO.VERSION` | Inlined `VERSION:"2.1.100"` | Version constant |
| `MACRO.PACKAGE_URL` | Inlined `PACKAGE_URL:"..."` | Package name |

## Pipeline Status

### Verified Patches (6/6 OK)
| # | Name | Method | Count | Status |
|---|---|---|---|---|
| 01 | version | replaceAll | 127x | ✓ |
| 02 | package-url | replaceAll | 127x | ✓ |
| 03 | feedback | replaceAll | 127x | ✓ |
| 04 | readme-url | replaceAll | 127x | ✓ |
| 05 | issues | replaceAll | 127x | ✓ |
| 10 | provider-detection | replace (1x) | 1x | ✓ |

### Pending Patches (need probe verification)
| # | Name | Target | Probe Strategy |
|---|---|---|---|
| 11 | codex-fetch-adapter | getAnthropicClient | Find `new Anthropic(` + inject adapter before |
| 12 | copilot-fetch-adapter | getAnthropicClient | Same function, copilot branch |
| 20 | telemetry-disable | is1PEventLoggingEnabled | Find function, replace body with `return false` |
| 21 | feature-flags | GrowthBook defaults | Find getFeatureValue, override defaults |
| 22 | auto-updater | GCS URL + npm registry | Replace URL strings |
| 23 | policy-limits | rate limit enforcement | Find and bypass |

## Architecture

```
npm pack @anthropic-ai/claude-code
    ↓
pipeline/upstream/package/cli.js  (13.5MB, minified JS)
    ↓  node pipeline/patch.cjs
pipeline/build/cli-patched.js     (patched JS)
    ↓  bun build --compile
pipeline/build/silly              (75MB standalone binary)
```
