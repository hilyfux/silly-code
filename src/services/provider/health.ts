export type ProviderHealth = {
  providerId: string
  status: 'healthy' | 'degraded' | 'down'
  lastSuccess: number | null
  lastFailure: number | null
  consecutiveFailures: number
  avgLatencyMs: number
  rateLimited: boolean
  rateLimitResetAt: number | null
}

const healthMap = new Map<string, ProviderHealth>()
const rateLimitTimers = new Map<string, ReturnType<typeof setTimeout>>()

function getOrInit(providerId: string): ProviderHealth {
  if (!healthMap.has(providerId)) {
    healthMap.set(providerId, {
      providerId,
      status: 'healthy',
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      avgLatencyMs: 0,
      rateLimited: false,
      rateLimitResetAt: null,
    })
  }
  return healthMap.get(providerId)!
}

function computeStatus(h: ProviderHealth): ProviderHealth['status'] {
  if (h.consecutiveFailures >= 5) return 'down'
  if (h.consecutiveFailures >= 2 || h.rateLimited) return 'degraded'
  return 'healthy'
}

export function recordSuccess(providerId: string, latencyMs: number): void {
  const h = getOrInit(providerId)
  const prev = h.avgLatencyMs
  const count = h.lastSuccess === null ? 1 : Math.min(h.consecutiveFailures === 0 ? 20 : 1, 20)
  h.avgLatencyMs = prev === 0 ? latencyMs : Math.round((prev * (count - 1) + latencyMs) / count)
  h.consecutiveFailures = 0
  h.lastSuccess = Date.now()
  h.status = computeStatus(h)
}

export function recordFailure(providerId: string, _error: string): void {
  const h = getOrInit(providerId)
  h.consecutiveFailures += 1
  h.lastFailure = Date.now()
  h.status = computeStatus(h)
}

export function recordRateLimit(providerId: string, resetInMs: number): void {
  const h = getOrInit(providerId)
  h.rateLimited = true
  h.rateLimitResetAt = Date.now() + resetInMs
  h.status = computeStatus(h)

  const existing = rateLimitTimers.get(providerId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    const entry = healthMap.get(providerId)
    if (entry) {
      entry.rateLimited = false
      entry.rateLimitResetAt = null
      entry.status = computeStatus(entry)
    }
    rateLimitTimers.delete(providerId)
  }, resetInMs)

  rateLimitTimers.set(providerId, timer)
}

export function getProviderHealth(providerId: string): ProviderHealth {
  return { ...getOrInit(providerId) }
}

export function getAllProviderHealth(): ProviderHealth[] {
  return Array.from(healthMap.values()).map(h => ({ ...h }))
}

export function getBestAvailableProvider(preferred: string): string {
  const pref = getOrInit(preferred)
  if (pref.status === 'healthy') return preferred

  for (const [id, h] of healthMap.entries()) {
    if (id !== preferred && h.status === 'healthy') return id
  }
  return preferred
}

export function getHealthSummary(): string {
  const all = getAllProviderHealth()
  if (all.length === 0) return 'No provider health data available.'

  const header = 'Provider      Status    Latency   Failures'
  const sep = '-'.repeat(header.length)
  const rows = all.map(h => {
    const name = h.providerId.padEnd(14)
    const status = h.status.padEnd(10)
    const latency = h.avgLatencyMs > 0 ? `${h.avgLatencyMs}ms`.padEnd(10) : '-'.padEnd(10)
    const failures = h.consecutiveFailures >= 5 ? '5+' : String(h.consecutiveFailures)
    return `${name}${status}${latency}${failures}`
  })

  return [header, sep, ...rows].join('\n')
}
