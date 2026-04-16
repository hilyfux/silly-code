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
    'function jK(){if(WXq())return PXq();if(!qX())return null;let q=o7();if(!q)return null;return q.subscriptionType??null}',
    'function jK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  patch('21-subscriber-bypass',
    'function tX(){if(!aK())return!1;return vT6()===null}',
    'function tX(){return!0;if(!aK())return!1;return vT6()===null}'
  )

  // Patch 22: Enable /loop dynamic mode — bypass statsig feature flag
  patch('22-loop-dynamic-enable',
    'function I7z(){return I8("tengu_kairos_loop_dynamic",!1)}',
    'function I7z(){return!0}'
  )

  // Patch 24: Enable /loop prompt preamble — bypass statsig feature flag
  patch('24-loop-prompt-enable',
    'function yi1(){return I8("tengu_kairos_loop_prompt",!1)}',
    'function yi1(){return!0}'
  )

  // Patch 23: Disable tool deferral for third-party providers — force direct load
  patch('23-no-defer-third-party',
    'if(jW4&&q.name===jW4){if((WR8(),u7(PR8)).isLoopDynamicEnabled())return!1}return q.shouldDefer===!0}',
    'if(jW4&&q.name===jW4){if((WR8(),u7(PR8)).isLoopDynamicEnabled())return!1}if(typeof Uq==="function"&&Uq()!=="firstParty")return!1;return q.shouldDefer===!0}'
  )

  // Patch 25: Force Sonnet as the default model for firstParty Claude.
  // Upstream Nv() returns Opus when tier == "max"/"team" (our patch 20 forces
  // "max" to unlock tier-gated features), which would otherwise auto-select
  // Opus 4.6 by default and burn ~5× Sonnet's token budget. Users who want
  // Opus can still flip with /model opus; the tier unlocks remain intact.
  patch('25-sonnet-default',
    'function Nv(){if(Qh())return EE()+(aJ()?"[1m]":"");if(r76())return EE()+(aJ()?"[1m]":"");return $G()}',
    'function Nv(){return $G()+(aJ()?"[1m]":"")}'
  )
}
