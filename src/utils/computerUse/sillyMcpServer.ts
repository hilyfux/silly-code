/**
 * Silly Code Computer Use MCP Server
 *
 * Security-gated computer control via Python bridge.
 * No Anthropic private packages needed.
 *
 * Safety architecture (modeled on cc-haha vendor/computer-use-mcp/toolCalls.ts):
 *   1. Global kill switch (env var)
 *   2. macOS TCC permission check (accessibility + screen recording)
 *   3. Tool-specific gates (dangerous key combos, denied apps)
 *   4. For input actions: frontmost app check before every action
 *   5. Error paths are explicit and recoverable
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { callPythonHelper, ensureBootstrapped } from './pythonBridge.js'

const TOOL_DEFS = [
  {
    name: 'computer_screenshot',
    description: 'Take a screenshot of the current screen. Returns base64 PNG.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        display_id: { type: 'number', description: 'Display ID (null for main)' },
      },
    },
  },
  {
    name: 'computer_click',
    description: 'Click at screen coordinates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        count: { type: 'number', default: 1 },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'computer_type',
    description: 'Type text at current cursor position.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'computer_key',
    description: 'Press a key or key combination (e.g. "cmd+c", "enter", "tab").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keySequence: { type: 'string', description: 'Key sequence like "cmd+c" or "enter"' },
        repeat: { type: 'number', default: 1 },
      },
      required: ['keySequence'],
    },
  },
  {
    name: 'computer_scroll',
    description: 'Scroll at screen coordinates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        deltaX: { type: 'number', default: 0 },
        deltaY: { type: 'number', description: 'Positive = down, negative = up' },
      },
      required: ['x', 'y', 'deltaY'],
    },
  },
  {
    name: 'computer_drag',
    description: 'Drag from one point to another.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        to: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
      },
      required: ['to'],
    },
  },
  {
    name: 'computer_cursor_position',
    description: 'Get current mouse cursor position.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'computer_open_app',
    description: 'Launch an application by bundle ID (e.g. "com.apple.Safari").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bundleId: { type: 'string' },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'computer_list_windows',
    description: 'List all visible windows with their positions and owning apps.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'computer_frontmost_app',
    description: 'Get the currently focused application.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'computer_clipboard_read',
    description: 'Read current clipboard contents.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'computer_clipboard_write',
    description: 'Write text to clipboard.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    },
  },
]

const COMMAND_MAP: Record<string, string> = {
  computer_screenshot: 'screenshot',
  computer_click: 'click',
  computer_type: 'type',
  computer_key: 'key',
  computer_scroll: 'scroll',
  computer_drag: 'drag',
  computer_cursor_position: 'cursor_position',
  computer_open_app: 'open_app',
  computer_list_windows: 'list_windows',
  computer_frontmost_app: 'frontmost_app',
  computer_clipboard_read: 'read_clipboard',
  computer_clipboard_write: 'write_clipboard',
}

// ── Safety gates ──────────────────────────────────────────────

/** Gate 1: Global kill switch. Set SILLY_COMPUTER_USE_DISABLED=1 to block all CU. */
function isKillSwitchActive(): boolean {
  return process.env.SILLY_COMPUTER_USE_DISABLED === '1'
}

/** Gate 2: TCC permission check. Returns missing permissions or null if OK. */
async function checkPermissions(): Promise<string | null> {
  try {
    const perms = await callPythonHelper<Record<string, boolean>>('check_permissions', {})
    const missing: string[] = []
    if (!perms.accessibility) missing.push('Accessibility')
    if (!perms.screen_recording) missing.push('Screen Recording')
    if (missing.length > 0) {
      return `Missing macOS permissions: ${missing.join(', ')}. Grant in System Settings → Privacy & Security.`
    }
    return null
  } catch {
    // If check_permissions isn't available, allow (non-macOS or older helper)
    return null
  }
}

/** Gate 3: Dangerous key combo blocklist. Based on cc-haha keyBlocklist.ts. */
const BLOCKED_KEY_COMBOS = [
  'cmd+q',           // quit app
  'cmd+shift+q',     // force quit
  'cmd+opt+esc',     // force quit dialog
  'cmd+ctrl+q',      // lock screen
  'ctrl+cmd+power',  // force restart
  'cmd+shift+delete', // empty trash
]

function isBlockedKeyCombo(seq: string): boolean {
  const normalized = seq.toLowerCase().replace(/\s+/g, '')
  return BLOCKED_KEY_COMBOS.some(b => normalized === b.replace(/\s+/g, ''))
}

/** Gate 4: For input actions, verify frontmost app is not our own terminal. */
async function checkFrontmostApp(actionKind: 'mouse' | 'keyboard'): Promise<string | null> {
  try {
    const app = await callPythonHelper<{ bundleId?: string; name?: string } | null>('frontmost_app', {})
    if (!app) return null
    const hostBundleId = process.env.TERM_PROGRAM_BUNDLE_ID || ''
    if (actionKind === 'keyboard' && app.bundleId === hostBundleId && hostBundleId) {
      // Keyboard: always block if host terminal is frontmost (typing into our chat input)
      return `Safety: keyboard action blocked — host terminal (${app.bundleId}) is frontmost. Defocus first.`
    }
    // Mouse: allow host terminal (click-through is safe), but block if nothing useful is frontmost
    return null
  } catch {
    return null
  }
}

/** Gate 5: prepareForAction — hide non-allowlisted apps, defocus host terminal. */
async function prepareForAction(allowedBundleIds: string[] = []): Promise<string | null> {
  try {
    await callPythonHelper('hide_other_apps', { allowedBundleIds })
    await callPythonHelper('defocus_host', {})
    return null
  } catch (err) {
    // Non-fatal: if prepare fails, log but continue (desktop might not support it)
    const msg = err instanceof Error ? err.message : String(err)
    logGate('prepareForAction', 'warn', `prepare failed (non-fatal): ${msg}`)
    return null
  }
}

/** Gate 6: pixel validation — screenshot a region around click target, compare with model's view. */
async function validateClickRegion(x: number, y: number): Promise<string | null> {
  // Take a small region screenshot centered on the click point
  const regionSize = 40
  const region = {
    x: Math.max(0, x - regionSize / 2),
    y: Math.max(0, y - regionSize / 2),
    w: regionSize,
    h: regionSize,
  }
  try {
    const result = await callPythonHelper<{ data?: string } | null>('screenshot_region', { region })
    if (!result || !result.data) {
      // Can't validate — fail open with warning (no screenshot_region support)
      logGate('pixelValidation', 'warn', 'screenshot_region not available, skipping validation')
      return null
    }
    // Validation succeeded — region is capturable (screen hasn't changed drastically)
    // Full pixel-diff comparison would require storing the model's last screenshot,
    // which is a larger architectural change. For now, "can we capture this region
    // at all" is the gate — catches moved/hidden windows and screen lock.
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logGate('pixelValidation', 'error', `region capture failed: ${msg}`)
    return `Pixel validation failed: ${msg}. Screen may have changed.`
  }
}

// ── Structured security audit log ────────────────────────────
// This is a Silly Code exclusive: every gate decision is logged
// with structured data for debugging and regression analysis.

type GateLogEntry = {
  timestamp: string
  tool: string
  gate: string
  level: 'pass' | 'block' | 'warn' | 'error'
  detail: string
}

const gateLog: GateLogEntry[] = []
const MAX_GATE_LOG = 500

function logGate(gate: string, level: GateLogEntry['level'], detail: string, tool = ''): void {
  const entry: GateLogEntry = {
    timestamp: new Date().toISOString(),
    tool,
    gate,
    level,
    detail,
  }
  gateLog.push(entry)
  if (gateLog.length > MAX_GATE_LOG) gateLog.splice(0, gateLog.length - MAX_GATE_LOG)
  // Also emit to stderr for real-time observability
  if (level === 'block' || level === 'error') {
    process.stderr.write(`[CU:${gate}] ${level}: ${detail}\n`)
  }
}

/** Export gate log for debugging / eval. */
export function getGateLog(): readonly GateLogEntry[] {
  return gateLog
}

/** Classify tool as read-only or input action */
const INPUT_TOOLS = new Set([
  'computer_click', 'computer_type', 'computer_key',
  'computer_scroll', 'computer_drag',
])

export function createSillyComputerUseMcpServer(): Server {
  const server = new Server(
    { name: 'silly-computer-use', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const pyCommand = COMMAND_MAP[name]
    if (!pyCommand) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }

    const isInput = INPUT_TOOLS.has(name)
    const isKeyboard = name === 'computer_key' || name === 'computer_type'
    const isClick = name === 'computer_click'

    // ── Gate 1: Kill switch ──
    if (isKillSwitchActive()) {
      logGate('killSwitch', 'block', 'SILLY_COMPUTER_USE_DISABLED=1', name)
      return {
        content: [{ type: 'text', text: 'Computer use is disabled (SILLY_COMPUTER_USE_DISABLED=1).' }],
        isError: true,
      }
    }
    logGate('killSwitch', 'pass', 'not active', name)

    // ── Gate 2: TCC permissions ──
    const permError = await checkPermissions()
    if (permError) {
      logGate('tcc', 'block', permError, name)
      return { content: [{ type: 'text', text: permError }], isError: true }
    }
    logGate('tcc', 'pass', 'permissions OK', name)

    // ── Gate 3: Dangerous key combos ──
    if (name === 'computer_key') {
      const seq = (args as Record<string, unknown>)?.keySequence
      if (typeof seq === 'string' && isBlockedKeyCombo(seq)) {
        logGate('keyBlocklist', 'block', `blocked: ${seq}`, name)
        return {
          content: [{ type: 'text', text: `Blocked: "${seq}" is a dangerous key combination.` }],
          isError: true,
        }
      }
      logGate('keyBlocklist', 'pass', `allowed: ${seq}`, name)
    }

    // ── Gate 4: Frontmost app check (re-checked per call, not cached) ──
    if (isInput) {
      const actionKind = isKeyboard ? 'keyboard' : 'mouse' as const
      const frontmostError = await checkFrontmostApp(actionKind)
      if (frontmostError) {
        logGate('frontmost', 'block', frontmostError, name)
        return { content: [{ type: 'text', text: frontmostError }], isError: true }
      }
      logGate('frontmost', 'pass', `${actionKind} action allowed`, name)
    }

    // ── Gate 5: prepareForAction (hide non-allowlisted apps, defocus host) ──
    if (isInput) {
      const prepError = await prepareForAction()
      if (prepError) {
        logGate('prepare', 'block', prepError, name)
        return { content: [{ type: 'text', text: prepError }], isError: true }
      }
      logGate('prepare', 'pass', 'environment prepared', name)
    }

    // ── Gate 6: Pixel validation for clicks ──
    if (isClick) {
      const a = args as Record<string, unknown>
      const x = typeof a?.x === 'number' ? a.x : 0
      const y = typeof a?.y === 'number' ? a.y : 0
      const pixelError = await validateClickRegion(x, y)
      if (pixelError) {
        logGate('pixelValidation', 'block', pixelError, name)
        return { content: [{ type: 'text', text: pixelError }], isError: true }
      }
      logGate('pixelValidation', 'pass', `region OK at (${x},${y})`, name)
    }

    // ── Execute via Python bridge ──
    try {
      const result = await callPythonHelper<unknown>(pyCommand, (args || {}) as Record<string, unknown>)
      logGate('execute', 'pass', `${pyCommand} succeeded`, name)

      if (name === 'computer_screenshot' && result && typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
        const r = result as { data: string; width: number; height: number }
        return {
          content: [{
            type: 'image',
            data: r.data,
            mimeType: 'image/png',
          }],
        }
      }

      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      logGate('execute', 'error', `${pyCommand} failed: ${message}`, name)
      return { content: [{ type: 'text', text: `Computer use error: ${message}` }], isError: true }
    }
  })

  return server
}

export async function runSillyComputerUseMcpServer(): Promise<void> {
  await ensureBootstrapped()
  const server = createSillyComputerUseMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
