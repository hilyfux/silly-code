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

  // Patch 28a: Disable durable scheduled-task READ.
  // Upstream persists `durable:true` CronCreate jobs to <cwd>/.claude/scheduled_tasks.json
  // and auto-resumes them on every session launch (including a `missed while Claude
  // was not running` catch-up banner). Observed failure: a task armed in one project
  // fires autonomously in a fresh session of another project after `/clear` — user has
  // no memory of scheduling it. Neuter the loader so stale .json files are ignored and
  // no task ever auto-fires in a session that didn't explicitly arm it.
  patch('28a-durable-read-disable',
    'async function Qy6(q){let K=V8(),_;try{_=await K.readFile(Ls(q),{encoding:"utf-8"})}catch(O){if(D5(O))return[];return j6(O),[]}let z=k5(_,!1);if(!z||typeof z!=="object")return[];let Y=z;if(!Array.isArray(Y.tasks))return[];let A=[];for(let O of Y.tasks){if(!O||typeof O.id!=="string"||typeof O.cron!=="string"||typeof O.prompt!=="string"||typeof O.createdAt!=="number"){E(`[ScheduledTasks] skipping malformed task: ${I6(O)}`);continue}if(!gj6(O.cron)){E(`[ScheduledTasks] skipping task ${O.id} with invalid cron \'${O.cron}\'`);continue}A.push({id:O.id,cron:O.cron,prompt:O.prompt,createdAt:O.createdAt,...typeof O.lastFiredAt==="number"&&{lastFiredAt:O.lastFiredAt},...O.recurring&&{recurring:!0},...O.permanent&&{permanent:!0}})}return A}',
    'async function Qy6(q){return[]}'
  )

  // Patch 28b: Force CronCreate to session-only (never write .json).
  // Pair with 28a — write side would otherwise leave orphan .json files that read
  // as [] but still clutter the project tree. Redirect durable=true to the same
  // in-memory DY6 branch as durable=false. User-facing cost: a user who says
  // "persist this across sessions" gets silent degradation; acceptable because
  // silly-code's philosophy is no-autonomous-work > cross-session continuity.
  patch('28b-durable-write-disable',
    'async function UR8(q,K,_,z,Y){let A=X4z().slice(0,8),O={id:A,cron:q,prompt:K,createdAt:Date.now(),..._&&{recurring:!0}};if(!z)return DY6({...O,...Y&&{agentId:Y}}),A;let w=await Qy6();return w.push(O),await WU1(w),A}',
    'async function UR8(q,K,_,z,Y){let A=X4z().slice(0,8),O={id:A,cron:q,prompt:K,createdAt:Date.now(),..._&&{recurring:!0}};return DY6({...O,...Y&&{agentId:Y}}),A}'
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
