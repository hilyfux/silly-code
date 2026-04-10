export type ProviderId =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'copilot'

export type ProviderDescriptor = {
  id: ProviderId
  displayName: string
  envFlag?: string
  usesSubscriptionAuth: boolean
  supportsFetchAdapter: boolean
}
