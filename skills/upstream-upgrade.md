# Upstream Upgrade — silly-code patch pipeline maintenance

When upstream `@anthropic-ai/claude-code` releases a new version, use this skill to upgrade the patched binary.

## Quick Reference

```
Current upstream: @anthropic-ai/claude-code v2.1.100
Patch pipeline:   pipeline/patch.cjs (orchestrator)
Patch modules:    pipeline/patches/{branding,providers,identity,equality,privacy,platform}.cjs
Upstream source:  pipeline/upstream/package/cli.js
Patched output:   pipeline/build/cli-patched.js
```

## Phase 1: Fetch New Upstream

```bash
cd /path/to/silly-code
rm -rf pipeline/upstream/package
TMP=$(mktemp)
npm pack @anthropic-ai/claude-code --pack-destination "$(dirname "$TMP")"
tar xzf "$TMP" -C pipeline/upstream
rm -f "$TMP"
```

Verify: `head -1 pipeline/upstream/package/cli.js` should show the new shebang.

## Phase 2: Attempt Patch Build

```bash
node pipeline/patch.cjs
```

**If 0 FAIL**: Skip to Phase 5.

**If any FAIL**: Proceed to Phase 3 (the important part).

## Phase 3: Fix Broken Patches

Each FAIL means the match string changed in the new upstream. Fix them **one at a time**, in order of criticality:

### Priority 1 — Core functionality (will crash if broken)
| Patch | Domain | Why it breaks |
|-------|--------|---------------|
| 10-provider-detection | providers.cjs | `dq()` function renamed or signature changed |
| 11-12-provider-adapters | providers.cjs | `BX` variable renamed or client constructor changed |
| 13-model-resolution | providers.cjs | `D$` function renamed |
| 14-provider-family | providers.cjs | `fg` function renamed |
| 20-tier-bypass | equality.cjs | `XK` function renamed or refactored |
| 21-subscriber-bypass | equality.cjs | `m7` function renamed |

### Priority 2 — Identity & branding (won't crash, but wrong display)
| Patch | Domain | Why it breaks |
|-------|--------|---------------|
| 01-05 | branding.cjs | Version string changed (e.g. "2.1.100" → "2.2.0") |
| 06b-header-title | branding.cjs | TUI title rendering changed |
| 60-model-display-name | identity.cjs | `G0` function renamed |
| 61-system-identity | identity.cjs | `Xh1` variable renamed |
| 63-tier-display | identity.cjs | `MT8` function refactored |

### Priority 3 — Privacy (won't crash, but leaks telemetry)
| Patch | Domain | Why it breaks |
|-------|--------|---------------|
| 30-39 | privacy.cjs | API endpoint URLs changed |

### Priority 4 — Cosmetic
| Patch | Domain | Why it breaks |
|-------|--------|---------------|
| 07-mascot-color | branding.cjs | Color value string changed |
| 50-51 context-window | platform.cjs | Default constant renamed |

### Methodology: Finding New Match Strings

When a patch fails, the minified variable name has changed. Use these techniques:

#### Technique 1: Semantic Search (fastest)
Search the NEW upstream binary for unique string literals that are NEAR the patched code:

```bash
# Example: provider detection patch broke because dq() was renamed
# The env var name is stable — search for it:
grep -o '.{0,100}CLAUDE_CODE_USE_BEDROCK.{0,100}' pipeline/upstream/package/cli.js
# This will show the new function name wrapping the env var check
```

#### Technique 2: Probe Injection (for complex functions)
Insert a `console.log` to find runtime values:

```javascript
// Temporarily add to the binary:
console.log('PROVIDER:', typeof dq === 'function' ? dq() : 'dq not found');
```

#### Technique 3: Offset Comparison
Compare the byte offset of known stable strings between old and new versions:

```python
# Find the offset shift
old_pos = old_text.find('CLAUDE_CODE_USE_BEDROCK')
new_pos = new_text.find('CLAUDE_CODE_USE_BEDROCK')
drift = new_pos - old_pos
# Apply same drift to nearby patch targets
```

#### Technique 4: Variable Mapping Table
The upstream uses short minified names. Key mappings for v2.1.100:

| Minified | Purpose | Stable anchor to find it |
|----------|---------|------------------------|
| `dq()` | Provider detection (returns "firstParty"/"openai"/"copilot"/"bedrock") | `CLAUDE_CODE_USE_BEDROCK` env var |
| `B6()` | Truthy check (parses "1"/"true"/"yes"/"on") | `["1","true","yes","on"].includes` |
| `BX()` | Provider for API client creation | Near `"bedrock"` branch in client factory |
| `G0()` | Model ID → display name | `"Opus 4.6"` or `"Sonnet 4.6"` string |
| `D$()` | Model resolution check | `"firstParty"||q==="anthropicAws"` |
| `fg()` | Provider family check | `"foundry"||q==="mantle"` |
| `XK()` | Subscription type getter | `subscriptionType` |
| `hL` | Anthropic client constructor | Near `apiKey:` and `fetch:` params |
| `Xh1` | System prompt identity string | `"You are Claude Code"` |
| `Nm` | Model display name constant | `"Opus 4.6"` |
| `KW()` | System prompt builder function | `"CWD:"` and `"Date:"` template |

**When a variable is renamed**: Search for its stable anchor string, then read the surrounding code to find the new name.

## Phase 4: Rebuild and Verify

After fixing all patches:

```bash
# Rebuild
node pipeline/patch.cjs
# Should show: N OK, 0 FAIL

# Quick test — all 3 providers
CLAUDE_CODE_USE_OPENAI=1 SILLY_CODE_DATA=~/.silly-code \
  node pipeline/build/cli-patched.js -p "Name: ? Model: ?" 
# Expect: "Name: Silly Code, Model: GPT 5.4"

CLAUDE_CODE_USE_COPILOT=1 SILLY_CODE_DATA=~/.silly-code \
  node pipeline/build/cli-patched.js -p "Name: ? Model: ?"
# Expect: "Name: Silly Code, Model: GPT 4o (Copilot)"

node pipeline/build/cli-patched.js -p "Name: ? Model: ?"
# Expect: "Name: Silly Code, Model: Opus 4.6"
```

## Phase 5: Update Version References

1. Update `VERSION:"X.Y.Z"` in `branding.cjs` patch 01
2. Update `// Version: X.Y.Z` in `providers.cjs` patch 15 and `platform.cjs` patch 50
3. Rebuild: `node pipeline/patch.cjs`
4. Commit:
```bash
git add pipeline/
git commit -m "chore: upgrade upstream to @anthropic-ai/claude-code vX.Y.Z"
git push origin main
```

## Phase 6: Deploy

```bash
# Update installed copy
cp pipeline/build/cli-patched.js ~/.local/share/silly-code/pipeline/build/cli-patched.js

# Or full reinstall:
curl -fsSL https://raw.githubusercontent.com/hilyfux/silly-code/main/install.sh | bash
```

## Patch Architecture (for new contributors)

```
upstream cli.js ──→ patch.cjs ──→ cli-patched.js
                      │
                      ├── branding.cjs    (01-07a) URLs, names, colors
                      ├── providers.cjs   (10-15)  OpenAI + Copilot adapters
                      ├── identity.cjs    (60-65)  Provider-aware prompts
                      ├── equality.cjs    (20-21)  Tier bypass
                      ├── privacy.cjs     (30-39)  Telemetry blocking
                      └── platform.cjs    (50-51)  Context window tuning
```

Each module is a function receiving `{ patch, patchAll }` helpers. Patches are applied in file order, then in-file order. A `patch()` call replaces the FIRST occurrence; `patchAll()` replaces ALL.

## Common Pitfalls

1. **Patch order matters**: providers.cjs injects adapter functions as a string blob before the bedrock branch. If branding patches change something providers.cjs depends on, it'll break. Always run branding BEFORE providers.
2. **IIFE timing**: `Xh1=(()=>{...})()` runs at module load time. If `dq()` isn't defined yet (because it moved to a lazy module), the identity patch will default to "firstParty". Use `typeof dq==="function"` guard.
3. **Scope isolation**: Adapter functions (`_sillyCodFetch`, `_sillyCopFetch` etc.) are injected as a string into the client factory scope. They can't access variables defined elsewhere. All imports must use dynamic `await import('node:fs')`.
4. **Token refresh**: Codex OAuth tokens expire. The adapter has built-in JWT expiry check + refresh_token flow. If OpenAI changes their token format, check `_refreshCodex()`.
5. **Version string appears 127x**: `patchAll` for version/URL patches typically hits 127 occurrences. If the count drops significantly, the upstream structure changed.

## Adapter Protocol Reference

### Codex (ChatGPT OAuth → Responses API)
```
Anthropic Messages API → _sillyCodFetch → Responses API (chatgpt.com/backend-api/codex/responses)
SSE translation: _makeResponsesSseStream (response.output_text.delta → content_block_delta)
Model mapping: claude-opus → gpt-5.4, claude-haiku → gpt-5.3-codex
```

### Copilot (GitHub OAuth → Chat Completions API)
```
Anthropic Messages API → _sillyCopFetch → Chat Completions (api.githubcopilot.com/chat/completions)
SSE translation: _makeSseStream (choices[0].delta → content_block_delta)
Model mapping: claude-opus → gpt-4o, claude-haiku → gpt-4o-mini
Token refresh: GitHub token → /copilot_internal/v2/token → short-lived Copilot token
```
