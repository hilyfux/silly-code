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
    'function J7(){if(zwq())return Awq();if(!mD())return null;let H=e8();if(!H)return null;return H.subscriptionType??null}',
    'function J7(){return"max"}'
  )

  // Patch 21: Subscriber check — always subscribed.
  // Upstream 2.1.114 replaced AM()/ST6() with Hq() as the "has active paid
  // scope" check. Hq() gates tier-display branches (KS/XqH) and FzH() (the
  // non-premium detector used for rate-limit banner and upsell prompts).
  // Forcing true keeps parity with patch 20 (tier=max) — both unlock paid UX.
  patch('21-subscriber-bypass',
    'function Hq(){if(!mD())return!1;return Fb(e8()?.scopes)}',
    'function Hq(){return!0}'
  )

  // Patch 22: Enable /loop dynamic mode — opt-in via SILLY_ENABLE_LOOP env var.
  // Default OFF: prevents ghost wakeups from self-replicating ScheduleWakeup calls.
  patch('22-loop-dynamic-enable',
    'function J91(){return I_("tengu_kairos_loop_dynamic",!1)}',
    'function J91(){return!!process.env.SILLY_ENABLE_LOOP}'
  )

  // Patch 24: Enable /loop prompt preamble — bypass statsig feature flag
  patch('24-loop-prompt-enable',
    'function Pi6(){return I_("tengu_kairos_loop_prompt",!1)}',
    'function Pi6(){return!0}'
  )

  // Patch 23: Disable tool deferral for third-party providers — force direct load
  patch('23-no-defer-third-party',
    'if(o$9&&H.name===o$9){if((hyH(),g8(vyH)).isLoopDynamicEnabled())return!1}return H.shouldDefer===!0}',
    'if(o$9&&H.name===o$9){if((hyH(),g8(vyH)).isLoopDynamicEnabled())return!1}if(typeof uq==="function"&&uq()!=="firstParty")return!1;return H.shouldDefer===!0}'
  )

  // Patch 25: Force Sonnet as the default model for firstParty Claude.
  // Upstream lG() returns Opus when tier == "max"/"team" (our patch 20 forces
  // "max" to unlock tier-gated features), which would otherwise auto-select
  // Opus 4.6 by default and burn ~5× Sonnet's token budget. Users who want
  // Opus can still flip with /model opus; the tier unlocks remain intact.
  // No [1m] suffix — Sonnet default runs at 200K (patch 52 clamps non-Opus).
  patch('25-sonnet-default',
    'function lG(){if(KS())return Fh()+(bD()?"[1m]":"");if(XqH())return Fh()+(bD()?"[1m]":"");return nG()}',
    'function lG(){return nG()}'
  )

  // Patch 25b: Fix Default menu description to match actual default model.
  // RZH() shows "Opus 4.7" for max tier, but patch 25 sets Sonnet as default.
  patch('25b-default-menu-desc',
    'function RZH(H=!1){if(KS()||XqH()){if(bD())return"Opus 4.7 with 1M context \\xB7 Most capable for complex work";return"Opus 4.7 \\xB7 Most capable for complex work"}return"Sonnet 4.6 \\xB7 Best for everyday tasks"}',
    'function RZH(H=!1){return"Sonnet 4.6 \\xB7 Best for everyday tasks"}'
  )

  // Patch 26: Bypass availableModels filter on model menu.
  // RM6 filters menu items against API-side availableModels, which reflects
  // the real account tier — not our faked "max". This removes models the
  // user's subscription doesn't technically include (e.g. Opus 4.7 on Pro).
  // Since we already control the menu via patches 25/53, bypass the filter.
  patch('26-model-menu-ungate',
    'function BMH(H){if(!(C8()||{}).availableModels)return H;return H.filter((q)=>q.value===null||q.value!==null&&MqH(q.value))}',
    'function BMH(q){return q}'
  )

  // Patch 28a: Disable durable scheduled-task READ.
  // Upstream persists `durable:true` CronCreate jobs to <cwd>/.claude/scheduled_tasks.json
  // and auto-resumes them on every session launch (including a `missed while Claude
  // was not running` catch-up banner). Observed failure: a task armed in one project
  // fires autonomously in a fresh session of another project after `/clear` — user has
  // no memory of scheduling it. Neuter the loader so stale .json files are ignored and
  // no task ever auto-fires in a session that didn't explicitly arm it.
  patch('28a-durable-read-disable',
    'async function LyH(H){let _=v_(),q;try{q=await _.readFile(ks(H),{encoding:"utf-8"})}catch($){if(LK($))return[];return zH($),[]}let K=SK(q,!1);if(!K||typeof K!=="object")return[];let O=K;if(!Array.isArray(O.tasks))return[];let T=[];for(let $ of O.tasks){if(!$||typeof $.id!=="string"||typeof $.cron!=="string"||typeof $.prompt!=="string"||typeof $.createdAt!=="number"){h(`[ScheduledTasks] skipping malformed task: ${uH($)}`);continue}if(!lI($.cron)){h(`[ScheduledTasks] skipping task ${$.id} with invalid cron \'${$.cron}\'`);continue}T.push({id:$.id,cron:$.cron,prompt:$.prompt,createdAt:$.createdAt,...typeof $.lastFiredAt==="number"&&{lastFiredAt:$.lastFiredAt},...$.recurring&&{recurring:!0},...$.permanent&&{permanent:!0}})}return T}',
    'async function LyH(H){return[]}'
  )

  // Patch 28b: Force CronCreate to session-only (never write .json).
  // Pair with 28a — write side would otherwise leave orphan .json files that read
  // as [] but still clutter the project tree. Redirect durable=true to the same
  // in-memory tOH branch as durable=false. User-facing cost: a user who says
  // "persist this across sessions" gets silent degradation; acceptable because
  // silly-code's philosophy is no-autonomous-work > cross-session continuity.
  patch('28b-durable-write-disable',
    'async function Nb_(H,_,q,K,O){let T=U$9.randomUUID().slice(0,8),$={id:T,cron:H,prompt:_,createdAt:Date.now(),...q&&{recurring:!0}};if(!K)return tOH({...$,...O&&{agentId:O}}),T;let A=await LyH();return A.push($),await hF6(A),T}',
    'async function Nb_(H,_,q,K,O){let T=U$9.randomUUID().slice(0,8),$={id:T,cron:H,prompt:_,createdAt:Date.now(),...q&&{recurring:!0}};return tOH({...$,...O&&{agentId:O}}),T}'
  )

  // Patch 28c: Cancel loop crons on /clear.
  // clearConversation resets conversation state but leaves in-memory cron timers
  // alive — a surviving ScheduleWakeup self-replicates into the fresh context.
  // Inject cleanup right after the unique "conversation_clear" telemetry anchor.
  patch('28c-clear-cancels-loop',
    'l("tengu_cache_eviction_hint",{scope:"conversation_clear",last_request_id:j});let D=new Set,M=[]',
    'l("tengu_cache_eviction_hint",{scope:"conversation_clear",last_request_id:j});try{Qi(!1);YU(Yh().map(W=>W.id))}catch{}let D=new Set,M=[]'
  )

  // Patch 27: Cancel /loop on session shutdown.
  // Upstream WK() never disables the cron scheduler nor clears sessionCronTasks,
  // so /loop keeps firing wakeups while the process winds down — visible as
  // "loop ignored my Ctrl+C" when an in-flight Codex fetch holds the process
  // open. Inject right after WK's re-entry guard so cleanup runs exactly once
  // per shutdown. try/catch protects WK if Si/Ci/nL get renamed upstream
  // (layer-3 bare-inject; structural guards live in match-registry.cjs).
  patch('27-cancel-loop-on-shutdown',
    'if(xu_=!0,q?.suppressResumeHint)ml6=!0;',
    'if(xu_=!0,q?.suppressResumeHint)ml6=!0;try{Qi(!1);YU(Yh().map(W=>W.id))}catch{}'
  )
}
