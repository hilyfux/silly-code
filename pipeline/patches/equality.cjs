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
    'function XK(){if(Kjq())return qjq();if(!rJ())return null;let q=Kq();if(!q)return null;return q.subscriptionType??null}',
    'function XK(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed
  // m7() checks if user is a Claude AI subscriber.
  patch('21-subscriber-bypass',
    'function m7(){if(!rJ())return!1;return lC(Kq()?.scopes)',
    'function m7(){return!0;if(!rJ())return!1;return lC(Kq()?.scopes)'
  )
}
