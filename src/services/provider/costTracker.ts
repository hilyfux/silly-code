export interface ProviderCostEntry {
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCostUSD: number
  timestamp: number
}

export interface ProviderCostSummary {
  providerId: string
  totalCostUSD: number
  totalInputTokens: number
  totalOutputTokens: number
  requestCount: number
  models: Record<string, { cost: number; requests: number }>
}

// Per-million-token rates: [inputRate, outputRate]
const MODEL_RATES: Record<string, [number, number]> = {
  'claude-opus':   [15,   75],
  'claude-sonnet': [3,    15],
  'claude-haiku':  [0.25, 1.25],
  'gpt-5.4-mini':  [0.4,  1.6],
  'gpt-5.4':       [5,    15],
}

export function estimateCostUSD(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(MODEL_RATES).find(k => model.toLowerCase().includes(k)) ?? ''
  const [inputRate, outputRate] = MODEL_RATES[key] ?? [3, 15]
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
}

const costLog: ProviderCostEntry[] = []

export function recordProviderCost(entry: ProviderCostEntry): void {
  costLog.push(entry)
}

export function getProviderCostSummary(): ProviderCostSummary[] {
  const byProvider = new Map<string, ProviderCostSummary>()

  for (const entry of costLog) {
    let summary = byProvider.get(entry.providerId)
    if (!summary) {
      summary = {
        providerId: entry.providerId,
        totalCostUSD: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        requestCount: 0,
        models: {},
      }
      byProvider.set(entry.providerId, summary)
    }
    summary.totalCostUSD += entry.estimatedCostUSD
    summary.totalInputTokens += entry.inputTokens
    summary.totalOutputTokens += entry.outputTokens
    summary.requestCount += 1

    const m = summary.models[entry.model] ?? { cost: 0, requests: 0 }
    m.cost += entry.estimatedCostUSD
    m.requests += 1
    summary.models[entry.model] = m
  }

  return Array.from(byProvider.values())
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function getSessionCostBreakdown(): string {
  const summaries = getProviderCostSummary()
  if (summaries.length === 0) return 'No provider cost data recorded.'

  const col = (s: string, w: number) => s.padEnd(w)
  const header = [col('Provider', 14), col('Model', 20), col('Requests', 10), col('Input', 10), col('Output', 10), col('Cost', 8)].join('')
  const sep = '-'.repeat(header.length)
  const rows: string[] = [header, sep]

  let totReq = 0, totIn = 0, totOut = 0, totCost = 0

  for (const s of summaries) {
    const modelEntries = Object.entries(s.models)
    modelEntries.forEach(([model, stats], i) => {
      const inputForModel = costLog.filter(e => e.providerId === s.providerId && e.model === model).reduce((a, e) => a + e.inputTokens, 0)
      const outputForModel = costLog.filter(e => e.providerId === s.providerId && e.model === model).reduce((a, e) => a + e.outputTokens, 0)
      rows.push([
        col(i === 0 ? s.providerId : '', 14),
        col(model, 20),
        col(String(stats.requests), 10),
        col(fmt(inputForModel), 10),
        col(fmt(outputForModel), 10),
        `$${stats.cost.toFixed(2)}`,
      ].join(''))
    })
    totReq += s.requestCount
    totIn += s.totalInputTokens
    totOut += s.totalOutputTokens
    totCost += s.totalCostUSD
  }

  rows.push(sep)
  rows.push([col('Total', 14), col('', 20), col(String(totReq), 10), col(fmt(totIn), 10), col(fmt(totOut), 10), `$${totCost.toFixed(2)}`].join(''))
  return rows.join('\n')
}

export function resetProviderCosts(): void {
  costLog.length = 0
}
