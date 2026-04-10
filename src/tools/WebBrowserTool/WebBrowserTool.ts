import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const FETCH_TIMEOUT_MS = 30_000

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('The URL of the web page to fetch'),
    selector: z.string().optional().describe('Optional keyword hint to filter content'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    content: z.string().describe('Text content extracted from the web page'),
    url: z.string().describe('The URL that was fetched'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ').trim()
}

export const WebBrowserTool = buildTool({
  name: 'WebBrowser',
  searchHint: 'fetch and read web page content from the internet',
  maxResultSizeChars: 200_000,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  async description() { return 'Fetch and read web page content' },
  async prompt() { return 'Fetch and read web page content' },
  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  renderToolUseMessage(input) { return `Fetching: ${input.url ?? ''}` },
  renderToolResultMessage(output) { return (output as Output).content || '(no content)' },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.content || '(no content)' }
  },
  async call({ url, selector }, { abortController }) {
    const timer_ctrl = new AbortController()
    const timer = setTimeout(() => timer_ctrl.abort(), FETCH_TIMEOUT_MS)
    const signal = AbortSignal.any
      ? AbortSignal.any([abortController.signal, timer_ctrl.signal])
      : timer_ctrl.signal
    try {
      const response = await fetch(url, {
        signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; silly-code/1.0)' },
      })
      if (!response.ok) {
        return { data: { url, content: `Error: HTTP ${response.status} ${response.statusText}` } }
      }
      let text = stripHtml(await response.text())
      if (selector) {
        const idx = text.toLowerCase().indexOf(selector.toLowerCase())
        if (idx !== -1) text = text.slice(Math.max(0, idx - 200), idx + 2000)
      }
      return { data: { url, content: text.slice(0, 50_000) } }
    } catch (err) {
      return { data: { url, content: `Error fetching page: ${err instanceof Error ? err.message : String(err)}` } }
    } finally {
      clearTimeout(timer)
    }
  },
} satisfies ToolDef<InputSchema, Output>)
