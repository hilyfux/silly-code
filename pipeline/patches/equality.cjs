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
    'function GK(){if(mHq())return uHq();if(!oJ())return null;let q=t7();if(!q)return null;return q.subscriptionType??null}',
    'function GK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  // m7() checks if user is a Claude AI subscriber.
  patch('21-subscriber-bypass',
    'function U7(){if(!oJ())return!1;return eC(t7()?.scopes)',
    'function U7(){return!0;if(!oJ())return!1;return eC(t7()?.scopes)'
  )

  // Patch 22: Enable /loop dynamic mode — bypass feature flag gate
  // isLoopDynamicEnabled() checks statsig flag "tengu_kairos_loop_dynamic"
  // which always returns false because privacy patches block statsig/growthbook.
  // Without this, ScheduleWakeup stays deferred and its call() returns {scheduledFor:0}.
  patch('22-loop-dynamic-enable',
    'function z8z(){return h8("tengu_kairos_loop_dynamic",!1)}',
    'function z8z(){return!0}'
  )
}
