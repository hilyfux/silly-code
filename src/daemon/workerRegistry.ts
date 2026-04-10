const SUPPORTED_KINDS = ['assistant', 'watcher'] as const
type WorkerKind = typeof SUPPORTED_KINDS[number]

async function runAssistantWorker(): Promise<void> {
  console.log('[daemon] assistant worker started')
  await new Promise<void>(() => { /* placeholder: long-lived process */ })
}

async function runWatcherWorker(): Promise<void> {
  console.log('[daemon] watcher worker started')
  await new Promise<void>(() => { /* placeholder: long-lived process */ })
}

export async function runDaemonWorker(kind: string): Promise<void> {
  switch (kind as WorkerKind) {
    case 'assistant':
      return runAssistantWorker()
    case 'watcher':
      return runWatcherWorker()
    default:
      console.error(`[daemon] unknown worker kind: "${kind}". Supported: ${SUPPORTED_KINDS.join(', ')}`)
      process.exit(1)
  }
}
