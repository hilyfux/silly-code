/**
 * Debug Report — captures context on failure for dogfooding diagnostics.
 *
 * Writes a timestamped JSON file to ~/.silly-code/debug-reports/
 * so the user can quickly bring failure context back for analysis.
 *
 * Usage from code: captureDebugReport({ error, context })
 * Usage from CLI: silly debug-report (shows last report)
 */
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const REPORT_DIR = join(homedir(), '.silly-code', 'debug-reports')
const MAX_REPORTS = 20

export type DebugReport = {
  timestamp: string
  version: string
  commit: string
  platform: string
  error: string
  provider?: string
  fallbackChain?: string[]
  requestState?: string
  featureFlags?: number
  experimental?: boolean
  context?: Record<string, unknown>
}

export function captureDebugReport(input: {
  error: string
  provider?: string
  fallbackChain?: string[]
  requestState?: string
  context?: Record<string, unknown>
}): string {
  mkdirSync(REPORT_DIR, { recursive: true })

  const report: DebugReport = {
    timestamp: new Date().toISOString(),
    version: typeof MACRO !== 'undefined' ? (MACRO as any).VERSION : 'unknown',
    commit: process.env.SILLY_CODE_COMMIT || 'unknown',
    platform: `${process.platform} ${process.arch}`,
    error: input.error.slice(0, 2000),
    provider: input.provider,
    fallbackChain: input.fallbackChain,
    requestState: input.requestState,
    featureFlags: undefined, // filled below
    experimental: process.env.SILLY_EXPERIMENTAL === '1',
    context: input.context,
  }

  const filename = `report-${Date.now()}.json`
  const filepath = join(REPORT_DIR, filename)
  writeFileSync(filepath, JSON.stringify(report, null, 2))

  // Prune old reports
  try {
    const files = readdirSync(REPORT_DIR)
      .filter(f => f.startsWith('report-'))
      .sort()
    if (files.length > MAX_REPORTS) {
      const { unlinkSync } = require('fs')
      for (const old of files.slice(0, files.length - MAX_REPORTS)) {
        try { unlinkSync(join(REPORT_DIR, old)) } catch {}
      }
    }
  } catch {}

  return filepath
}

export function getLastReport(): DebugReport | null {
  try {
    const files = readdirSync(REPORT_DIR)
      .filter(f => f.startsWith('report-'))
      .sort()
    if (files.length === 0) return null
    const last = files[files.length - 1]!
    return JSON.parse(readFileSync(join(REPORT_DIR, last), 'utf8'))
  } catch {
    return null
  }
}

export function getReportDir(): string {
  return REPORT_DIR
}
