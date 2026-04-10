import { ProviderDescriptor, ProviderId } from './types'

const PROVIDER_DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  firstParty: {
    id: 'firstParty',
    displayName: 'Anthropic',
    usesSubscriptionAuth: true,
    supportsFetchAdapter: false,
  },
  bedrock: {
    id: 'bedrock',
    displayName: 'AWS Bedrock',
    envFlag: 'CLAUDE_CODE_USE_BEDROCK',
    usesSubscriptionAuth: false,
    supportsFetchAdapter: true,
  },
  vertex: {
    id: 'vertex',
    displayName: 'Google Vertex AI',
    envFlag: 'CLAUDE_CODE_USE_VERTEX',
    usesSubscriptionAuth: false,
    supportsFetchAdapter: true,
  },
  foundry: {
    id: 'foundry',
    displayName: 'Azure AI Foundry',
    envFlag: 'CLAUDE_CODE_USE_FOUNDRY',
    usesSubscriptionAuth: false,
    supportsFetchAdapter: true,
  },
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    envFlag: 'CLAUDE_CODE_USE_OPENAI',
    usesSubscriptionAuth: false,
    supportsFetchAdapter: true,
  },
  copilot: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    envFlag: 'CLAUDE_CODE_USE_COPILOT',
    usesSubscriptionAuth: true,
    supportsFetchAdapter: true,
  },
}

const SUPPORTED_PROVIDER_IDS: ProviderId[] = [
  'firstParty',
  'bedrock',
  'vertex',
  'foundry',
  'openai',
  'copilot',
]

export function getSupportedProviderIds(): ProviderId[] {
  return [...SUPPORTED_PROVIDER_IDS]
}

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDER_DESCRIPTORS[id]
}
