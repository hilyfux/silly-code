/**
 * Silly Code Computer Use MCP Server
 *
 * Replaces @ant/computer-use-mcp with a direct Python bridge implementation.
 * No Anthropic private packages needed — all computer control goes through
 * runtime/mac_helper.py via callPythonHelper().
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
    try {
      const result = await callPythonHelper<unknown>(pyCommand, (args || {}) as Record<string, unknown>)

      // Screenshot returns base64 image data
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
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
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
