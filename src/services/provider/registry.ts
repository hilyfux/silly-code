import type { ProviderDescriptor, ProviderId } from './types.js'

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDescriptor> = {
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    opusModel: 'claude-opus-4-5',
    sonnetModel: 'claude-sonnet-4-5',
    haikuModel: 'claude-haiku-3-5',
  },
  codex: {
    id: 'codex',
    name: 'OpenAI Codex',
    sonnetModel: 'gpt-5.4',
    haikuModel: 'gpt-5.4-mini',
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    sonnetModel: 'gpt-4o',
    haikuModel: 'gpt-4o-mini',
  },
}

export function getProvider(id: ProviderId): ProviderDescriptor {
  return PROVIDER_REGISTRY[id]
}

/** Alias used by tests and the provider plane contract layer */
export function getSupportedProviderIds(): ProviderId[] {
  return Object.keys(PROVIDER_REGISTRY) as ProviderId[]
}

/** Alias used by tests and the provider plane contract layer */
export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDER_REGISTRY[id]
}
