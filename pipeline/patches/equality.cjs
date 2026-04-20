/**
 * equality.cjs — Patches 20-21: Tech equality (tier bypass)
 *
 * Unlocks all subscription-gated features for all users.
 * No Free/Pro/Max/Employee tiers — everyone gets everything.
 */

module.exports = function applyEquality({ patch }) {
  // Patch 20: Tier bypass — always return "max" subscription
  // XK() returns subscription tier. "max" unlocks ULTRATHINK, ULTRAPLAN, etc.
  patch('20-tier-bypass',
    'function MK(){if(DMq())return WMq();if(!jX())return null;let q=o7();if(!q)return null;return q.subscriptionType??null}',
    'function MK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  patch('21-subscriber-bypass',
    'function AM(){if(!q5())return!1;return ST6()===null}',
    'function AM(){return!0;if(!q5())return!1;return ST6()===null}'
  )

  // Patch 22: Enable /loop dynamic mode — bypass statsig feature flag
  patch('22-loop-dynamic-enable',
    'function T4z(){return u8("tengu_kairos_loop_dynamic",!1)}',
    'function T4z(){return!0}'
  )

  // Patch 24: Enable /loop prompt preamble — bypass statsig feature flag
  patch('24-loop-prompt-enable',
    'function Hr1(){return u8("tengu_kairos_loop_prompt",!1)}',
    'function Hr1(){return!0}'
  )

  // Patch 23: Disable tool deferral for third-party providers — force direct load
  patch('23-no-defer-third-party',
    'if(T04&&q.name===T04){if((cR8(),B7(dR8)).isLoopDynamicEnabled())return!1}return q.shouldDefer===!0}',
    'if(T04&&q.name===T04){if((cR8(),B7(dR8)).isLoopDynamicEnabled())return!1}if(typeof pq==="function"&&pq()!=="firstParty")return!1;return q.shouldDefer===!0}'
  )

  // Patch 25: Force Sonnet as the default model for firstParty Claude.
  // Upstream hv() returns Opus when tier == "max"/"team" (our patch 20 forces
  // "max" to unlock tier-gated features), which would otherwise auto-select
  // Opus 4.6 by default and burn ~5× Sonnet's token budget. Users who want
  // Opus can still flip with /model opus; the tier unlocks remain intact.
  // No [1m] suffix — Sonnet default runs at 200K (patch 52 clamps non-Opus).
  patch('25-sonnet-default',
    'function hv(){if(ch())return LE()+(YX()?"[1m]":"");if(Yq6())return LE()+(YX()?"[1m]":"");return Af()}',
    'function hv(){return Af()}'
  )

  // Patch 25b: Fix Default menu description to match actual default model.
  // uT6() shows "Opus 4.7" for max tier, but patch 25 sets Sonnet as default.
  patch('25b-default-menu-desc',
    'function uT6(q=!1){if(ch()||Yq6()){if(YX())return"Opus 4.7 with 1M context \xB7 Most capable for complex work";return"Opus 4.7 \xB7 Most capable for complex work"}return"Sonnet 4.6 \xB7 Best for everyday tasks"}',
    'function uT6(q=!1){return"Sonnet 4.6 \xB7 Best for everyday tasks"}'
  )

  // Patch 26: Bypass availableModels filter on model menu.
  // RM6 filters menu items against API-side availableModels, which reflects
  // the real account tier — not our faked "max". This removes models the
  // user's subscription doesn't technically include (e.g. Opus 4.7 on Pro).
  // Since we already control the menu via patches 25/53, bypass the filter.
  patch('26-model-menu-ungate',
    'function RM6(q){if(!(y7()||{}).availableModels)return q;return q.filter((_)=>_.value===null||_.value!==null&&Kq6(_.value))}',
    'function RM6(q){return q}'
  )

  // Patch 27: Cancel /loop on session shutdown.
  // Upstream WK() never disables the cron scheduler nor clears sessionCronTasks,
  // so /loop keeps firing wakeups while the process winds down — visible as
  // "loop ignored my Ctrl+C" when an in-flight Codex fetch holds the process
  // open. Inject right after WK's re-entry guard so cleanup runs exactly once
  // per shutdown. try/catch protects WK if Si/Ci/nL get renamed upstream
  // (layer-3 bare-inject; structural guards live in match-registry.cjs).
  patch('27-cancel-loop-on-shutdown',
    'if(sb8=!0,_?.suppressResumeHint)Sn1=!0;',
    'if(sb8=!0,_?.suppressResumeHint)Sn1=!0;try{Si(!1);Ci(nL().map(W=>W.id))}catch{}'
  )
}
