import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { PROVIDER_REGISTRY } from './registry.js'
import type { ProviderId } from './types.js'

export type TaskType = 'reasoning' | 'coding' | 'fast' | 'review' | 'general'

export interface RouteDecision {
  providerId: ProviderId
  model: string
  reason: string
}

// ── Auth detection ─────────────────────────────────────────────────────────────

function isAuthenticated(id: ProviderId): boolean {
  const home = homedir()
  const sillyDir = process.env.SILLY_CODE_DATA ?? join(home, '.silly-code')
  switch (id) {
    case 'claude':  return existsSync(join(home, '.claude', '.credentials.json'))
    case 'codex':   return existsSync(join(sillyDir, 'codex-oauth.json'))
    case 'copilot': return existsSync(join(sillyDir, 'copilot-oauth.json'))
  }
}

function availableProviders(): ProviderId[] {
  return (['claude', 'codex', 'copilot'] as ProviderId[]).filter(isAuthenticated)
}

function pick(preferred: ProviderId[], available: ProviderId[]): ProviderId | undefined {
  return preferred.find(p => available.includes(p))
}

// ── Task classification ────────────────────────────────────────────────────────

const PATTERNS: Record<TaskType, RegExp> = {
  reasoning: /\b(think|analyze|analyse|explain|why|design|architect|plan)\b/i,
  coding:    /\b(code|implement|fix|bug|refactor|function|class|test)\b/i,
  fast:      /\b(quick|brief|short|simple|just|only)\b/i,
  review:    /\b(review|audit|check|verify|inspect)\b/i,
  general:   /(?:)/,  // always matches — checked last
}

export function classifyTask(prompt: string): TaskType {
  for (const type of ['reasoning', 'coding', 'fast', 'review'] as const) {
    if (PATTERNS[type].test(prompt)) return type
  }
  return 'general'
}

// ── Routing ────────────────────────────────────────────────────────────────────

export function routeTask(taskType: TaskType, userPreference?: ProviderId): RouteDecision {
  const available = availableProviders()

  if (available.length === 0) {
    // No auth at all — default to claude with a graceful fallback
    const provider = PROVIDER_REGISTRY.claude
    return { providerId: 'claude', model: provider.sonnetModel, reason: 'no authenticated provider found, defaulting to claude' }
  }

  // Always honor explicit user preference if that provider is authenticated
  if (userPreference && available.includes(userPreference)) {
    const provider = PROVIDER_REGISTRY[userPreference]
    const model = provider.sonnetModel
    return { providerId: userPreference, model, reason: `user preference: ${userPreference}` }
  }

  switch (taskType) {
    case 'reasoning': {
      const id = pick(['claude', 'codex'], available) ?? available[0]!
      const provider = PROVIDER_REGISTRY[id]
      const model = provider.opusModel ?? provider.sonnetModel
      return { providerId: id, model, reason: 'reasoning tasks benefit from the most capable model' }
    }
    case 'coding': {
      const id = pick(['claude', 'codex'], available) ?? available[0]!
      const provider = PROVIDER_REGISTRY[id]
      return { providerId: id, model: provider.sonnetModel, reason: 'coding tasks use the balanced sonnet-class model' }
    }
    case 'fast': {
      const id = pick(['claude', 'codex', 'copilot'], available) ?? available[0]!
      const provider = PROVIDER_REGISTRY[id]
      const model = provider.haikuModel ?? provider.sonnetModel
      return { providerId: id, model, reason: 'fast tasks use the lightweight model for lower latency' }
    }
    case 'review': {
      const id = pick(['claude', 'copilot', 'codex'], available) ?? available[0]!
      const provider = PROVIDER_REGISTRY[id]
      return { providerId: id, model: provider.sonnetModel, reason: 'review tasks use balanced sonnet-class model' }
    }
    case 'general':
    default: {
      const id = available[0]!
      const provider = PROVIDER_REGISTRY[id]
      return { providerId: id, model: provider.sonnetModel, reason: 'general task routed to first authenticated provider' }
    }
  }
}
