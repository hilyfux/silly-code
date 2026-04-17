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
  patch('25-sonnet-default',
    'function hv(){if(ch())return LE()+(YX()?"[1m]":"");if(Yq6())return LE()+(YX()?"[1m]":"");return Af()}',
    'function hv(){return Af()+(YX()?"[1m]":"")}'
  )
}
