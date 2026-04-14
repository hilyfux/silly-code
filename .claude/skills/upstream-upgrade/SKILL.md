---
name: upstream-upgrade
description: Use when bumping silly-code's @anthropic-ai/claude-code upstream or when proactively looking for provider-adapter / patch improvements. Covers (a) tracking — fix 82 patches when a new version lands; (b) optimizing — discover leaks, scars, and adapter bugs revealed by each bump.
---

# upstream-upgrade

Two jobs, one skill. Each upstream bump is both a chance to **track** (keep 82 patches green) and to **optimize** (find new leaks, scars, and provider-adapter bugs that the new binary reveals). Do both — tracking without optimizing means the codebase decays into look-alike output with real behavior gaps.

## When to invoke

- User: "升级 upstream" / "bump claude code" / "跟 claude code"
- GitHub Issue labeled `auto-upgrade` is open
- `node pipeline/patch.cjs` reports "pattern not found" after a fetch

## Do NOT invoke when

- `npm view @anthropic-ai/claude-code version` equals `deps.json` upstream.version → nothing to do
- User asks about provider adapters or silly-code's own code — that's not an upstream bump

---

## Fastest path (90% of cases)

```bash
node pipeline/ci-upgrade.cjs          # tries everything automatically
```

Exit codes:
- `0` — already current, stop
- `1` — upgraded cleanly, run tests + commit + push, then **skip to Post-run self-update**
- `2` — partial failure, continue to **Manual rename sweep** below
- `3` — unexpected error (usually network), retry

> **Every run ends with a self-update step** (see "Post-run" at the bottom). Don't skip it even when ci-upgrade did all the work — track stable vs. churny variables so the history stays useful.

---

## Manual rename sweep

### Step 1 — see what broke

```bash
node pipeline/patch.cjs 2>&1 | grep "✗"
```

Each `✗ NN-name — pattern not found` points to a MATCH string or patch literal that references a minified identifier that's been renamed upstream.

### Step 2 — find new names with one grep battery

Run this Python block against the new binary — it returns the new name for every known failure pattern in one shot:

```python
python3 <<'PYEOF'
import re
with open('pipeline/upstream/package/cli.js') as f: c=f.read()
probes = [
  ('brand var',        r'var (\w+)="Claude Code"'),
  ('INJECT resolver',  r'P=(\w+)\(_\);if\(P==="bedrock"\)'),
  ('display fn',       r'function (\w+)\(q\)\{if\(\w+\(\)==="foundry"\)return;'),
  ('system identity',  r'(\w+)="You are Claude Code, Anthropic\'s official CLI for Claude\."'),
  ('SDK identity',     r'(\w+)="You are Claude Code, Anthropic\'s official CLI for Claude, running within the Claude Agent SDK\."'),
  ('agent identity',   r'(\w+)="You are a Claude agent, built on Anthropic\'s Claude Agent SDK\."'),
  ('public model fn',  r'function (\w+)\(q\)\{let \w+=q\.endsWith\("\[1m\]"\)\?'),
  ('fast mode var',    r'var (\w+)="Opus 4\.6"'),
  ('model family obj', r'"Model IDs — Opus 4\.6: \'\$\{(\w+)\.opus\}'),
  ('GK helpers',       r'function GK\(\)\{if\((\w+)\(\)\)return (\w+)\(\);if\(!(\w+)\(\)\)return null;let q=(\w+)\(\);'),
  ('d7 helpers',       r'function d7\(\)\{if\(!(\w+)\(\)\)return!1;return (\w+)\((\w+)\(\)\?\.scopes\)'),
  ('loop-dynamic fn',  r'function (\w+)\(\)\{return h8\("tengu_kairos_loop_dynamic"'),
  ('loop-prompt fn',   r'function (\w+)\(\)\{return h8\("tengu_kairos_loop_prompt"'),
  ('no-defer var',     r'if\((\w+)&&q\.name===\w+\)\{if\(\((\w+)\(\),(\w+)\((\w+)\)\)\.isLoopDynamicEnabled'),
  ('header render ch', r'"claude",(\w)\)\("Claude Code"\)'),
]
for label, pat in probes:
  m = re.search(pat, c)
  print(f'{label:20s}: {m.groups() if m else "NOT FOUND"}')
PYEOF
```

### Step 3 — edit three patch files

All MATCH strings live in exactly three files. Map failing patch → file:

| Failing patch | File | What to change |
|---|---|---|
| `08-model-family` | `branding.cjs` | `${X.opus}` → new family obj name |
| `10a-header-brand-var` | `branding.cjs` | `var X="Claude Code"` prefix |
| `10b-header-themed-render` | `branding.cjs` | `"claude",X)(` render arg |
| `10-provider-detection` | `provider-engine.cjs` | `MATCH.DETECT` — `B6(process.env...)` → new isEnvTruthy |
| `11-12-provider-adapters` | `provider-engine.cjs` | `MATCH.INJECT` + replacement `P=X(_)` |
| `13-model-resolution` | `provider-engine.cjs` | `MATCH.RESOLVE` — `function P$(q=iq())...` |
| `14-provider-family` | `provider-engine.cjs` | `MATCH.FAMILY` |
| `15` / `50` / `51` | `provider-engine.cjs` | `MATCH.VERSION` / `CONTEXT_DEFAULT` |
| `60-model-display-name` | `provider-engine.cjs` | `MATCH.DISPLAY` + replacement `function X(q)` |
| `61-system-identity` | `provider-engine.cjs` | `MATCH.IDENTITY` + replacement `X=(()=>...)()` |
| `62-sdk-identity` | `provider-engine.cjs` | `MATCH.SDK_ID` + replacement |
| `63-tier-display` | `provider-engine.cjs` | `MATCH.TIER` (watch for new `"team"` case) |
| `65-agent-identity` | `provider-engine.cjs` | `MATCH.AGENT_ID` + replacement |
| `66-fast-mode-display` | `provider-engine.cjs` | `var X="Opus 4.6"` |
| `67-public-model-display` | `provider-engine.cjs` | `function X(q){let K=q.endsWith...}` |
| `20-tier-bypass` | `equality.cjs` | `function GK(){...}` body — helper renames |
| `21-subscriber-bypass` | `equality.cjs` | `function d7(){...}` body |
| `22-loop-dynamic-enable` | `equality.cjs` | `function X(){return h8("tengu_kairos_loop_dynamic"...` |
| `23-no-defer-third-party` | `equality.cjs` | `mZ4/BZ4` tool-id var |
| `24-loop-prompt-enable` | `equality.cjs` | `function X(){return h8("tengu_kairos_loop_prompt"...` |
| `30-statsig-block` | `privacy.cjs` | `$U.fetch(` — statsigTransport var |
| `31-39`, `40` | `privacy.cjs` | URL/endpoint literals — rarely change |

**Also update the replacement template strings**, not just the MATCH constants. In `provider-engine.cjs` the replacement for `61-system-identity` references the identity var name twice — once in MATCH, once in the `(()=>{...})()` wrapper. Both need to match the NEW name.

### Step 4 — chained rename trap

Upstream sometimes reuses a slot: `d74` (SDK) → `c74` AND old `c74` (agent) → `l74`. Naive string-replace applied in order will double-rename: first step changes all `d74` to `c74`, so the second step's "old `c74`" now includes both the old-agent AND the just-renamed-SDK, all become `l74`. Wrong.

Two-phase swap:
```bash
# Phase 1: park the chain target under a placeholder
sed -i '' 's/\bc74\b/__PH_AGENT__/g' pipeline/patches/provider-engine.cjs
# Phase 2: rename the incoming
sed -i '' 's/\bd74\b/c74/g' pipeline/patches/provider-engine.cjs
# Phase 3: land the placeholder at its new home
sed -i '' 's/__PH_AGENT__/l74/g' pipeline/patches/provider-engine.cjs
```

When in doubt: **edit MATCH strings explicitly with hardcoded new values** rather than running sed over chained renames.

### Step 5 — new feature scars

Keep an eye on new cases that prepend to existing patterns. Recent example: 2.1.105 added `case"team":return"Claude Team";` before `case"max"...`. Our MATCH.TIER still matches as a substring, so 63 passed, but non-firstParty providers now leak "Claude Team" for team-tier users. Note the pattern drift but don't block the upgrade on it — file a follow-up issue.

---

## Version bumps

After patches pass, these files need the new version string:

```bash
NEW=2.1.xxx
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$NEW\"/" deps.json
sed -i '' "s|VERSION:\"[0-9.]*\"|VERSION:\"$NEW\"|g" pipeline/patches/branding.cjs
sed -i '' "s|VERSION:\"[0-9.]*-silly\"|VERSION:\"$NEW-silly\"|g" pipeline/patches/branding.cjs
sed -i '' "s|// Version: [0-9.]*|// Version: $NEW|" pipeline/patches/provider-engine.cjs
sed -i '' "s/2\\.1\\.[0-9]\\+/$NEW/g" README.md   # 4 language sections share the number
```

---

## Verification checklist

```bash
node pipeline/patch.cjs            # must print "82 OK, 0 FAIL"
node tests/base.test.cjs           # all PASS
node tests/schema.test.cjs         # all PASS
node pipeline/build/cli-patched.js --version   # "X.Y.Z-silly (Claude Code)"

# Optional smoke — if creds available:
# node pipeline/build/cli-patched.js -p "hello"  # Claude
# CLAUDE_CODE_USE_OPENAI=1 SILLY_CODE_DATA=~/.silly-code node pipeline/build/cli-patched.js -p "hello"
```

Then sync local install:
```bash
cp pipeline/build/cli-patched.js ~/.local/share/silly-code/pipeline/build/cli-patched.js
```

---

## Commit + release

```bash
git add -A pipeline/upstream pipeline/patches pipeline/varmap-$NEW.json deps.json README.md
git commit -m "chore: upgrade upstream to Claude Code $NEW

Variable renames since $OLD:
- <old> → <new>  (<semantic name>)
...

82/82 patches pass. All unit tests green."

git push origin main
```

The `release.yml` workflow auto-fires on the push (path filter: `deps.json` or `pipeline/upstream/package/cli.js`), creates the tag, publishes the GitHub release. If it fails (rare — usually git identity), tag manually:

```bash
git tag v$NEW -m "upstream $NEW"
git push origin v$NEW
gh release create v$NEW --title "silly-code v$NEW" --notes "..."
```

If CI opened an Issue, reference `Closes #N` in the commit message so it auto-closes on merge.

---

## Known rename history (2.1.x)

| Var | 2.1.104 | 2.1.105 | 2.1.107 |
|---|---|---|---|
| isEnvTruthy | F6 | B6 | B6 |
| getAPIProvider | dq | iq | iq |
| isFirstParty | D$ | P$ | P$ |
| providerFamily | lg | $Q | $Q |
| modelAwareProviderResolver | cX | rX | **oX** |
| isSubscriber | U7 | d7 | d7 |
| statsigTransport | nU | $U | $U |
| defaultContextWindow | uL1/rbz | qh1 | qh1 |
| systemIdentity | Fh1 | qb1 | qb1 |
| sdkIdentity | Y14 | d74 | **c74** (chained) |
| agentIdentity | A14 | c74 | **l74** (chained) |
| displayFn | y0 | xW | **mW** |
| publicModelDisplay | N76 | wq6 | wq6 |
| fastModeDisplay | Um | YB | YB |
| headerBrandVar | njK | mOK | **FOK** |
| modelFamilyObj | $j7 | BH7 | BH7 |
| loopDynamicFn | A8z | Q7z | **l7z** |
| loopPromptFn | t37 | s97 | s97 |
| noDeferToolIdVar | dW4 | mZ4 | **BZ4** |
| GK: isEnabled | BHq | VXq | **kXq** |
| GK: readToken | mHq | vXq | **VXq** (chained) |
| auth check | oJ | qX | **KX** |

**Pattern**: identity/display/brand vars change most often. Equality helpers (`BHq/VXq/qX`) swap letters across every release. Core vars (`B6`, `iq`) have been stable since 2.1.105.

## Optimization scan (run on EVERY successful bump)

After the 82-patch build goes green, don't stop — run these checks. They serve the project's **dual mission** (see root `CLAUDE.md`):

- **Lane A (tracking)**: checks 1–3 catch new leaks / telemetry / scars introduced upstream
- **Lane B (Codex UX)**: checks 4–6 catch provider-adapter regressions and discover fixes that make sillyx/GPT work better

A bump is not done until both lanes have been walked.

### 1. Identity leak re-scan

Upstream occasionally adds new "Claude Code" references in user-facing strings that need firstParty-gating. Run:

```bash
python3 <<'PYEOF'
import re
with open('pipeline/upstream/package/cli.js') as f: c = f.read()
# Look for Claude Code refs that are NOT URLs, NOT our intentional firstParty-preserved strings, NOT doc-comment text
patterns = [
  r'"([^"]{0,40}Claude Code[^"]{0,40})"',
  r'`([^`]{0,60}Claude Code[^`]{0,60})`',
]
seen = set()
for p in patterns:
  for m in re.finditer(p, c):
    s = m.group(1)
    if s in seen: continue
    seen.add(s)
    # Skip known-safe strings
    if 'github.com/anthropics' in s or 'claude.com' in s: continue
    if 'Claude Code is' in s and 'CLI' in s: continue  # our 08a-cli-description handles these
    print(repr(s)[:100])
PYEOF
```

If new hits appear: add a branding.cjs patch (e.g., `11i-new-leak`) that replaces or branches on provider. Log under "Known feature scars" below.

### 2. New endpoint detection

New URLs upstream hits may need telemetry blocking (patch 30-40). Quick sweep:

```bash
python3 <<'PYEOF'
import re
with open('pipeline/upstream/package/cli.js') as f: c = f.read()
# URLs under anthropic / claude / statsig / growthbook / datadoghq domains
pat = r'https?://[^"\'`\s]{10,100}(?:anthropic|claude|statsig|datadoghq|growthbook|storage\.googleapis)[^"\'`\s]{0,100}'
endpoints = set()
for m in re.finditer(pat, c):
  endpoints.add(m.group(0))
print(f'{len(endpoints)} distinct endpoints. Checking which are already blocked...')
with open('pipeline/patches/privacy.cjs') as f: blocked = f.read()
for e in sorted(endpoints):
  short = re.sub(r'https?://', '', e)
  # Try to find anchor in privacy.cjs
  anchor = short.split('/')[-1] or short.split('/')[-2]
  if anchor and anchor[:20] not in blocked and short[:30] not in blocked:
    print(f'  UNBLOCKED: {e}')
PYEOF
```

If UNBLOCKED urls appear: determine if it's telemetry vs. feature call. Add a privacy.cjs patch if it's telemetry.

### 3. New tier/case probes

Upstream adds case branches that our MATCH substrings pass through but don't cover (like 2.1.105's `case"team":`). Check:

```bash
python3 -c "
import re
with open('pipeline/upstream/package/cli.js') as f: c=f.read()
m=re.search(r'case\"[a-z]+\":return\"Claude (Max|Pro|Team|API|[A-Z][a-z]+)\";'*5, c)
print(m.group(0) if m else 'tier block not found in expected form')
"
```

Compare output to current MATCH.TIER. If new case appears:
- Option A (cheap): note it as a leak for non-firstParty team users, file follow-up issue
- Option B (correct): extend provider-engine.cjs Patch 63 to handle the new case

### 4. Session-resume durability

Upstream sometimes adds new content-block types (we already handle `text / tool_use / tool_result / thinking / redacted_thinking / image`). Check the binary's own schema:

```bash
grep -o 'type:"[a-z_]\{3,30\}"' pipeline/upstream/package/cli.js \
  | grep -vE '"(text|tool_use|tool_result|thinking|redacted_thinking|image|function|function_call|function_call_output|input_text|input_image|message|system|user|assistant|document|web_search|code_execution|mcp)_?[a-z_]*"' \
  | sort -u | head -20
```

Any unrecognized type from this list deserves a look — if it appears in assistant/user `content[]`, our `msgToOai` and `msgsToResponsesInput` will JSON-stringify it as fallback (seen in the `thinking`-block leak). Add explicit handling in `pipeline/patches/providers/_base.cjs` + a test.

### 5. Request-field delta

Compare request shapes between versions — new fields upstream sends may break our `JSON.parse(init.body)` assumptions:

```bash
# Note: varmap-*.json isn't a diff of request schema, but provides a proxy signal.
# For true field-delta, run with SILLY_DEBUG_DUMP=1 against BOTH old and new binaries and diff the dump keys.
diff <(python3 -c "import json; d=json.load(open('/tmp/silly-debug/LATEST.json')); print('\n'.join(sorted(d.get('messages',[{}])[0].keys())))") \
     <(python3 -c "import json; d=json.load(open('/tmp/silly-debug/PREV.json')); print('\n'.join(sorted(d.get('messages',[{}])[0].keys())))")
```

### 6. Adapter-flake surveillance

Review open GitHub issues labeled `bug` / `user-report` / `auto-upgrade`. Each is a signal for a real adapter optimization:

```bash
gh issue list --repo hilyfux/silly-code --state open --label bug,user-report --json number,title,body --limit 10
```

For each issue, ask: does a fix in `pipeline/patches/providers/_base.cjs` (protocol translation) or per-provider adapter resolve it? Past wins for reference:
- thinking-block signature bleed through → `msgsToResponsesInput` filter (c862cdb)
- image-block JSON.stringify → `input_image` multi-part (c862cdb)
- stop-mid-task narration → `enforceContinuation` prompt block (47a6455, 7770e68)
- SILLY_DEBUG_DUMP diagnostic channel → adapter instrumentation + `silly report` CLI (7770e68, 6d32082)

### When to escalate

Some optimizations warrant a dedicated commit separate from the upgrade:
- Cross-provider protocol bugs → separate `fix:` commit
- New identity leak patches → separate `feat:` commit with i18n README updates
- New telemetry endpoint blocks → separate `feat(privacy):` commit

Batching into the upgrade commit is acceptable only for tiny additions (one-line patches). Otherwise split — each fix gets clean attribution in the release notes.

---

## Post-run — update this skill (MANDATORY)

Every time this skill runs end-to-end, update the file you are reading **before** reporting success to the user. This is how the playbook stays sharp instead of decaying.

### What to capture

1. **New column in the rename history table** — add `2.1.N` column. Fill every row. Bold the cells that changed from the previous version. If a row was stable, copy the previous value unchanged (that's signal too).
2. **New probe in the grep battery** — if a failing patch needed a regex that wasn't in the battery, add it. Name the probe after the failing patch (`X-patch-name`). Prefer the shortest unique suffix anchor.
3. **New chain in "chained rename trap"** — if you hit a slot-reuse (like `d74→c74` + `c74→l74`), list it as a concrete example under that section.
4. **New entry in troubleshooting** — if you hit a CI / build / git error that burned more than 5 minutes, add one row with Symptom / Cause / Fix.
5. **New feature scar** — if upstream added content that SUBSUMES one of our MATCH strings (like the new `case"team":` before `case"max":`), note it under "New feature scars" with observable side-effect.
6. **Delete stale advice** — if a trick stopped being relevant (e.g., a rename has been stable for 3+ versions, move it out of the "active" list). Skills rot when they only grow.

### How to commit the skill update

`.claude/` is gitignored — the skill lives locally only. So **do not** try to git add it. Just write the file in place. The auto-memory system and the Skill tool both pick up edits immediately on next invocation.

If the rename history has grown beyond ~8 versions, trim the oldest columns and keep only what's still referenced as context for chains.

### Self-review checklist (2 min)

Before closing the turn, ask yourself:
- Would **next-me**, cold-reading this skill after 3 months of Claude Code updates, have the exact grep/sed commands to reproduce today's fix?
- Is there duplicated guidance anywhere that could collapse into one paragraph?
- Does the troubleshooting table still match current tooling (ci-upgrade.cjs features, release.yml behavior)?

If the answer to any is "no" — fix it now, not later.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `checkSerialization: bare require()` | Added `require()` in adapter code | Use `await import('node:...')` instead |
| `execution verification failed — SyntaxError` | Broken JS in adapter toString() | Re-read the adapter; check template literal escaping |
| `ReferenceError` inside the patched binary | Referenced a var that was renamed | Re-run the grep battery, update replacement |
| `Upstream version mismatch` | `deps.json` doesn't match `upstream/package/package.json` | Run the sed battery in **Version bumps** |
| Tag already exists but binary didn't rebuild | Release workflow skipped due to path filter | Manually tag + `gh release create` |
| `gh label not found` during CI | Labels missing on repo | `gh label create auto-upgrade` + `gh label create upstream` |
