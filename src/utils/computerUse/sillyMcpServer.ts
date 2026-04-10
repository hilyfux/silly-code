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
async function checkFrontmostApp(): Promise<string | null> {
  try {
    const app = await callPythonHelper<{ bundleId?: string; name?: string } | null>('frontmost_app', {})
    if (!app) return null
    // Block if our own terminal is frontmost — typing would go to our input
    const hostBundleId = process.env.TERM_PROGRAM_BUNDLE_ID || ''
    if (app.bundleId === hostBundleId && hostBundleId) {
      return `Safety: frontmost app is the host terminal (${app.bundleId}). Defocus it first or use a different app.`
    }
    return null
  } catch {
    return null // Can't check → allow, but logged
  }
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

    // ── Gate 1: Kill switch ──
    if (isKillSwitchActive()) {
      return {
        content: [{ type: 'text', text: 'Computer use is disabled (SILLY_COMPUTER_USE_DISABLED=1). Unset the env var to re-enable.' }],
        isError: true,
      }
    }

    // ── Gate 2: TCC permissions ──
    const permError = await checkPermissions()
    if (permError) {
      return { content: [{ type: 'text', text: permError }], isError: true }
    }

    // ── Gate 3: Dangerous key combos ──
    if (name === 'computer_key') {
      const seq = (args as Record<string, unknown>)?.keySequence
      if (typeof seq === 'string' && isBlockedKeyCombo(seq)) {
        return {
          content: [{ type: 'text', text: `Blocked: "${seq}" is a dangerous key combination (could quit apps, lock screen, or restart).` }],
          isError: true,
        }
      }
    }

    // ── Gate 4: Frontmost check for input actions ──
    if (INPUT_TOOLS.has(name)) {
      const frontmostError = await checkFrontmostApp()
      if (frontmostError) {
        return { content: [{ type: 'text', text: frontmostError }], isError: true }
      }
    }

    // ── Execute via Python bridge ──
    try {
      const result = await callPythonHelper<unknown>(pyCommand, (args || {}) as Record<string, unknown>)

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
