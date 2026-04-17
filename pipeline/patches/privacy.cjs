/**
 * privacy.cjs — Patches 30-39: Zero telemetry / privacy protection
 *
 * Blocks all external telemetry, analytics, and tracking endpoints.
 * Nothing leaves the machine except the actual API calls you make.
 */

module.exports = function applyPrivacy({ patch, patchAll }) {
  // Patch 30: Block Statsig telemetry
  patch('30-statsig-block',
    'return HU.fetch(`${K}/api/eval/${_}`',
    'return Promise.resolve(new Response("{}",{status:200}));HU.fetch(`${K}/api/eval/${_}`'
  )

  // Patch 31: Block metrics reporting
  patch('31-metrics-block',
    '/api/claude_code/metrics',
    '/api/claude_code/metrics_disabled_by_silly'
  )

  // Patch 32: Block shared transcripts
  patch('32-transcripts-block',
    '/api/claude_code_shared_session_transcripts',
    '/api/claude_code_shared_session_transcripts_disabled'
  )

  // Patch 33: Block feedback reporting
  patch('33-feedback-block',
    '/api/claude_cli_feedback',
    '/api/claude_cli_feedback_disabled'
  )

  // Patch 34: Block metrics_enabled check
  patch('34-metrics-enabled-block',
    '/api/claude_code/organizations/metrics_enabled',
    '/api/claude_code/organizations/metrics_disabled'
  )

  // Patch 35: Block Datadog logging
  patch('35-datadog-block',
    'http-intake.logs.us5.datadoghq.com/api/v2/logs',
    'localhost:0/datadog-disabled'
  )

  // Patch 36: Block GrowthBook feature flag fetch
  patch('36-growthbook-block',
    'cdn.growthbook.io',
    'localhost:0/growthbook-disabled'
  )

  // Patch 37: Block auto-update check (appears twice in upstream)
  patchAll('37-autoupdate-block',
    'storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases',
    'localhost:0/autoupdate-disabled'
  )

  // Patch 38: Block plugin stats
  patch('38-plugin-stats-block',
    'raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json',
    'localhost:0/plugin-stats-disabled'
  )

  // Patch 39: Block changelog fetch
  patch('39-changelog-block',
    'raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md',
    'localhost:0/changelog-disabled'
  )

  // Patch 45: Neutralize timezone-based geolocation fingerprinting
  // Up6() reads Intl.DateTimeFormat().resolvedOptions().timeZone and returns
  // the real local timezone (e.g. "Asia/Shanghai"). This value:
  //   a) appears in the rate-limit banner "resets 3pm (Asia/Shanghai)"
  //   b) is used by Zqz() to set cnTZ flag → changes date separator in system prompt
  //   c) is used by Gqz() to pick a steganographic Unicode apostrophe character
  // The date string ("Today's date is 2026-04-16") is sent to Anthropic in EVERY
  // API request as part of the system prompt. The apostrophe character and date
  // separator are steganographic markers that reveal:
  //   - whether user is in China (date separator / vs -)
  //   - whether user is behind a known proxy (apostrophe variant)
  //   - whether user is using a competitor API (apostrophe variant)
  // Fix: dynamically resolve timezone from current network IP (follows VPN exit).
  //   Priority: SILLY_TIMEZONE env → IP geolocation lookup → "UTC" fallback.
  //   Result cached in c11 (one lookup per process lifetime).
  patch('45-timezone-privacy',
    'function _F6(){if(!T71)T71=Intl.DateTimeFormat().resolvedOptions().timeZone;return T71}',
    'function _F6(){if(!T71){T71=process.env.SILLY_TIMEZONE;if(!T71){try{T71=require("child_process").execSync("curl -s --max-time 3 http://ip-api.com/line/?fields=timezone",{encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim()}catch{}}if(!T71||!T71.includes("/"))T71="UTC"}return T71}'
  )

  // Patch 46: Neutralize steganographic apostrophe in system prompt date string
  // Gqz(known, labKw) returns 4 different Unicode apostrophes to signal whether
  // ANTHROPIC_BASE_URL matches known Chinese proxy domains or competitor AI labs.
  // This is embedded in "Today's date is ..." sent with every API request.
  // Fix: always return U+0027 plain ASCII apostrophe — matches the original
  // no-proxy/no-lab baseline so every user looks identical. (The previous
  // replacement used \u2019 which is itself a "known proxy" signal value.)
  patch('46-apostrophe-steganography',
    'function OKz(q,K){if(!q&&!K)return"\'";if(q&&!K)return"\u2019";if(!q&&K)return"\u02BC";return"\u02B9"}',
    'function OKz(){return"\'"}'
  )

  // Patch 47: Force cnTZ=false so date separator is always "-" (international)
  // Zqz() checks if timezone is Asia/Shanghai or Asia/Urumqi and sets cnTZ flag.
  // With patch 45, Up6() returns an IP-based timezone (VPN-aware), which is
  // unlikely to be Asia/Shanghai or Asia/Urumqi for most users. But as
  // defense-in-depth, also neutralize the proxy/lab hostname checks
  // so no information about ANTHROPIC_BASE_URL leaks via the system prompt.
  patch('47-geo-fingerprint-neutralize',
    'function To6(){if(S9())return null;',
    'function To6(){return{known:!1,labKw:!1,cnTZ:!1,host:null};if(S9())return null;'
  )

  // Patch 40: Block event_logging batch endpoint (EventLogger default path)
  patch('40-event-logging-block',
    '/api/event_logging/batch',
    '/api/event_logging/batch_disabled'
  )

  // Patch 41-44: Force isActive -> false for banners irrelevant to silly-code
  // (external tokens, API-key / dual-auth conflicts, IDE upsell). Original
  // body is preserved as _origIsActive so future upstream diffs stay readable.

  patch('41-suppress-auth-banner-external',
    '{id:"claude-ai-external-token",type:"warning",isActive:()=>',
    '{id:"claude-ai-external-token",type:"warning",isActive:()=>false,_origIsActive:()=>'
  )

  patch('42-suppress-auth-banner-apikey',
    '{id:"api-key-conflict",type:"warning",isActive:()=>',
    '{id:"api-key-conflict",type:"warning",isActive:()=>false,_origIsActive:()=>'
  )

  patch('43-suppress-auth-banner-both',
    '{id:"both-auth-methods",type:"warning",isActive:()=>',
    '{id:"both-auth-methods",type:"warning",isActive:()=>false,_origIsActive:()=>'
  )

  patch('44-suppress-jetbrains-banner',
    '{id:"jetbrains-plugin-install",type:"info",isActive:',
    '{id:"jetbrains-plugin-install",type:"info",isActive:()=>false,_origIsActive:'
  )
}
