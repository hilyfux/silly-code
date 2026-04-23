/**
 * claude.cjs — Provider config for Claude (first-party)
 *
 * Minimal config: no adapter or auth needed.
 * Claude is handled natively by the upstream binary.
 */

module.exports = {
  key: 'claude',
  runtimeId: 'firstParty',
  envKey: null,
  priority: null,
  identity: {
    displayName: null,
    systemPrompt: 'You are Silly Code, a multi-provider AI coding assistant, currently running with Claude as the backend model.',
    agentPrompt: 'You are a Silly Code agent, running with Claude.',
    simplePrompt: 'You are Silly Code (Claude).',
    // sdkPrompt: retained for schema parity (tests/base.test.cjs C1 asserts this is a string)
    // and symmetry with openai.cjs. Runtime-unused: provider-identity.cjs:57-60 (post W4
    // f220266) filters firstParty out of sdkBranches, and the fallback string is hardcoded
    // at provider-identity.cjs:55 (fallbackSdk). See project-sillyx-runtime-observation-bridge.
    sdkPrompt: 'You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK.',
    modelDisplayNames: null,
  },
  models: null,
  contextWindow: null,
  tierNames: { max: 'Claude Max', pro: 'Claude Pro', api: 'Claude API' },
  adapter: null,
  auth: null,
};
