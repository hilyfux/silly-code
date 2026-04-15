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
    'function jK(){if(NJq())return VJq();if(!eJ())return null;let q=a7();if(!q)return null;return q.subscriptionType??null}',
    'function jK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  patch('21-subscriber-bypass',
    'function o7(){if(!eJ())return!1;return Zb(a7()?.scopes)',
    'function o7(){return!0;if(!eJ())return!1;return Zb(a7()?.scopes)'
  )

  // Patch 22: Enable /loop dynamic mode — bypass statsig feature flag
  patch('22-loop-dynamic-enable',
    'function o8z(){return b8("tengu_kairos_loop_dynamic",!1)}',
    'function o8z(){return!0}'
  )

  // Patch 24: Enable /loop prompt preamble — bypass statsig feature flag
  patch('24-loop-prompt-enable',
    'function c37(){return b8("tengu_kairos_loop_prompt",!1)}',
    'function c37(){return!0}'
  )

  // Patch 23: Disable tool deferral for third-party providers — force direct load
  patch('23-no-defer-third-party',
    'if(Q04&&q.name===Q04){if((OR8(),u7(AR8)).isLoopDynamicEnabled())return!1}return q.shouldDefer===!0}',
    'if(Q04&&q.name===Q04){if((OR8(),u7(AR8)).isLoopDynamicEnabled())return!1}if(typeof Uq==="function"&&Uq()!=="firstParty")return!1;return q.shouldDefer===!0}'
  )
}
