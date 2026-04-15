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
    'function HK(){if(yJq())return EJq();if(!tJ())return null;let q=a7();if(!q)return null;return q.subscriptionType??null}',
    'function HK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  patch('21-subscriber-bypass',
    'function r7(){if(!tJ())return!1;return Wb(a7()?.scopes)',
    'function r7(){return!0;if(!tJ())return!1;return Wb(a7()?.scopes)'
  )

  // Patch 22: Enable /loop dynamic mode — bypass statsig feature flag
  patch('22-loop-dynamic-enable',
    'function n8z(){return b8("tengu_kairos_loop_dynamic",!1)}',
    'function n8z(){return!0}'
  )

  // Patch 24: Enable /loop prompt preamble — bypass statsig feature flag
  patch('24-loop-prompt-enable',
    'function r37(){return b8("tengu_kairos_loop_prompt",!1)}',
    'function r37(){return!0}'
  )

  // Patch 23: Disable tool deferral for third-party providers — force direct load
  patch('23-no-defer-third-party',
    'if(cD4&&q.name===cD4){if(($R8(),u7(wR8)).isLoopDynamicEnabled())return!1}return q.shouldDefer===!0}',
    'if(cD4&&q.name===cD4){if(($R8(),u7(wR8)).isLoopDynamicEnabled())return!1}if(typeof gq==="function"&&gq()!=="firstParty")return!1;return q.shouldDefer===!0}'
  )
}
