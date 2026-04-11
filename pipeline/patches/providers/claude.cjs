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
    sdkPrompt: 'You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK.',
    modelDisplayNames: null,
  },
  models: null,
  contextWindow: null,
  tierNames: { max: 'Claude Max', pro: 'Claude Pro', api: 'Claude API' },
  adapter: null,
  auth: null,
};
