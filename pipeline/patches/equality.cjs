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
    'function GK(){if(VXq())return vXq();if(!qX())return null;let q=Kq();if(!q)return null;return q.subscriptionType??null}',
    'function GK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  // m7() checks if user is a Claude AI subscriber.
  patch('21-subscriber-bypass',
    'function d7(){if(!qX())return!1;return Vb(Kq()?.scopes)',
    'function d7(){return!0;if(!qX())return!1;return Vb(Kq()?.scopes)'
  )

  // Patch 22: Enable /loop dynamic mode — bypass feature flag gate
  // isLoopDynamicEnabled() checks statsig flag "tengu_kairos_loop_dynamic"
  // which always returns false because privacy patches block statsig/growthbook.
  // Without this, ScheduleWakeup stays deferred and its call() returns {scheduledFor:0}.
  patch('22-loop-dynamic-enable',
    'function Q7z(){return h8("tengu_kairos_loop_dynamic",!1)}',
    'function Q7z(){return!0}'
  )

  // Patch 24: Enable /loop prompt preamble — bypass feature flag gate
  // s97() → h8("tengu_kairos_loop_prompt", false). Controls whether the
  // loop preamble (execution guidance) is injected into /loop conversations.
  // Without it, /loop tasks get less guidance and drift off-task.
  patch('24-loop-prompt-enable',
    'function s97(){return h8("tengu_kairos_loop_prompt",!1)}',
    'function s97(){return!0}'
  )

  // Patch 23: Disable tool deferral for third-party providers
  // GPT/Copilot models don't reliably use ToolSearch to load deferred tools,
  // so cron tools (CronCreate/CronList/CronDelete) stay invisible and the
  // model can't cancel a running /loop. Force non-MCP tools to load directly
  // for non-firstParty providers. MCP tools stay deferred (can be numerous).
  patch('23-no-defer-third-party',
    'if(mZ4&&q.name===mZ4){if((ih8(),C7(nh8)).isLoopDynamicEnabled())return!1}return q.shouldDefer===!0}',
    'if(mZ4&&q.name===mZ4){if((ih8(),C7(nh8)).isLoopDynamicEnabled())return!1}if(typeof iq==="function"&&iq()!=="firstParty")return!1;return q.shouldDefer===!0}'
  )
}
