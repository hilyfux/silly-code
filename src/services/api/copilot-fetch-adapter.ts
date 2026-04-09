/**
 * Copilot Fetch Adapter
 *
 * Intercepts fetch calls from the Anthropic SDK and routes them to
 * GitHub Copilot's Chat Completions API, translating between
 * Anthropic Messages API and OpenAI Chat Completions format.
 */
import { getCopilotAccessToken } from '../oauth/copilot-client.js'
import { COPILOT_CHAT_COMPLETIONS_URL } from '../../constants/copilot-oauth.js'

export const COPILOT_MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', contextWindow: 128_000 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextWindow: 128_000 },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', contextWindow: 200_000 },
  { id: 'o3', label: 'OpenAI o3', contextWindow: 200_000 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextWindow: 128_000 },
] as const

interface AnthropicContentBlock {
  type: string; text?: string; id?: string; name?: string
  input?: Record<string, unknown>; tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: { type: string; media_type: string; data: string }
  [key: string]: unknown
}

interface AnthropicMessage { role: string; content: string | AnthropicContentBlock[] }
interface AnthropicTool { name: string; description?: string; input_schema?: Record<string, unknown> }

interface ChatMessage {
  role: string
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

function translateMessages(
  system: string | Array<{ type: string; text?: string }> | undefined,
  messages: AnthropicMessage[],
): ChatMessage[] {
  const out: ChatMessage[] = []
  if (system) {
    const text = typeof system === 'string' ? system
      : Array.isArray(system) ? system.filter(b => b.type === 'text').map(b => b.text!).join('\n') : ''
    if (text) out.push({ role: 'system', content: text })
  }
  for (const msg of messages) {
    if (typeof msg.content === 'string') { out.push({ role: msg.role, content: msg.content }); continue }
    if (!Array.isArray(msg.content)) continue
    if (msg.role === 'user') {
      const toolResults = msg.content.filter(b => b.type === 'tool_result')
      const other = msg.content.filter(b => b.type !== 'tool_result')
      for (const b of toolResults) {
        const text = typeof b.content === 'string' ? b.content
          : Array.isArray(b.content) ? b.content.filter(c => c.type === 'text').map(c => c.text!).join('\n') : ''
        out.push({ role: 'tool', tool_call_id: b.tool_use_id!, content: text || '(empty)' })
      }
      if (other.length > 0) {
        const parts = other.map(b => {
          if (b.type === 'text') return { type: 'text' as const, text: b.text! }
          if (b.type === 'image' && b.source?.type === 'base64')
            return { type: 'image_url' as const, image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
          return null
        }).filter(Boolean) as Array<{ type: string; text?: string; image_url?: { url: string } }>
        if (parts.length === 1 && parts[0].type === 'text') out.push({ role: 'user', content: parts[0].text })
        else if (parts.length > 0) out.push({ role: 'user', content: parts })
      }
    } else if (msg.role === 'assistant') {
      const textBlocks = msg.content.filter(b => b.type === 'text')
      const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use')
      const text = textBlocks.map(b => b.text!).join('\n\n')
      const toolCalls = toolUseBlocks.map(b => ({
        id: b.id!, type: 'function' as const,
        function: { name: b.name!, arguments: JSON.stringify(b.input || {}) },
      }))
      const assistantMsg: ChatMessage = { role: 'assistant' }
      if (text) assistantMsg.content = text
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
      out.push(assistantMsg)
    }
  }
  return out
}

function translateTools(tools: AnthropicTool[]): Array<Record<string, unknown>> {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } },
  }))
}

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

async function translateCopilotStreamToAnthropic(copilotResponse: Response, model: string): Promise<Response> {
  const messageId = `msg_copilot_${Date.now()}`
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let contentBlockIndex = 0
      let currentTextBlockStarted = false
      let inToolCall = false
      let currentToolCallId = ''
      let hadToolCalls = false
      let inputTokens = 0
      let outputTokens = 0

      controller.enqueue(encoder.encode(formatSSE('message_start', JSON.stringify({
        type: 'message_start',
        message: { id: messageId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      }))))
      controller.enqueue(encoder.encode(formatSSE('ping', JSON.stringify({ type: 'ping' }))))

      try {
        const reader = copilotResponse.body?.getReader()
        if (!reader) { finishStream(controller, encoder, 0, 0, false); return }
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('event:') || !trimmed.startsWith('data: ')) continue
            const dataStr = trimmed.slice(6)
            if (dataStr === '[DONE]') continue
            let chunk: Record<string, unknown>
            try { chunk = JSON.parse(dataStr) } catch { continue }
            const choices = chunk.choices as Array<Record<string, unknown>> | undefined
            if (!choices || choices.length === 0) {
              const usage = chunk.usage as Record<string, number> | undefined
              if (usage) { inputTokens = usage.prompt_tokens || inputTokens; outputTokens = usage.completion_tokens || outputTokens }
              continue
            }
            const delta = choices[0].delta as Record<string, unknown> | undefined
            if (!delta) continue
            const content = delta.content as string | undefined
            if (content) {
              if (!currentTextBlockStarted) {
                controller.enqueue(encoder.encode(formatSSE('content_block_start', JSON.stringify({ type: 'content_block_start', index: contentBlockIndex, content_block: { type: 'text', text: '' } }))))
                currentTextBlockStarted = true
              }
              controller.enqueue(encoder.encode(formatSSE('content_block_delta', JSON.stringify({ type: 'content_block_delta', index: contentBlockIndex, delta: { type: 'text_delta', text: content } }))))
              outputTokens++
            }
            const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
            if (toolCalls) {
              for (const tc of toolCalls) {
                const fn = tc.function as Record<string, string> | undefined
                if (!fn) continue
                if (fn.name) {
                  if (currentTextBlockStarted) {
                    controller.enqueue(encoder.encode(formatSSE('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }))))
                    contentBlockIndex++; currentTextBlockStarted = false
                  }
                  if (inToolCall) {
                    controller.enqueue(encoder.encode(formatSSE('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }))))
                    contentBlockIndex++
                  }
                  currentToolCallId = (tc.id as string) || `toolu_${Date.now()}`
                  inToolCall = true; hadToolCalls = true
                  controller.enqueue(encoder.encode(formatSSE('content_block_start', JSON.stringify({
                    type: 'content_block_start', index: contentBlockIndex,
                    content_block: { type: 'tool_use', id: currentToolCallId, name: fn.name, input: {} },
                  }))))
                }
                if (fn.arguments) {
                  controller.enqueue(encoder.encode(formatSSE('content_block_delta', JSON.stringify({
                    type: 'content_block_delta', index: contentBlockIndex,
                    delta: { type: 'input_json_delta', partial_json: fn.arguments },
                  }))))
                }
              }
            }
            const finishReason = choices[0].finish_reason as string | undefined
            if (finishReason) {
              if (currentTextBlockStarted) { controller.enqueue(encoder.encode(formatSSE('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex })))); currentTextBlockStarted = false }
              if (inToolCall) { controller.enqueue(encoder.encode(formatSSE('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex })))); inToolCall = false }
            }
          }
        }
      } catch (err) {
        if (!currentTextBlockStarted) {
          controller.enqueue(encoder.encode(formatSSE('content_block_start', JSON.stringify({ type: 'content_block_start', index: contentBlockIndex, content_block: { type: 'text', text: '' } }))))
          currentTextBlockStarted = true
        }
        controller.enqueue(encoder.encode(formatSSE('content_block_delta', JSON.stringify({ type: 'content_block_delta', index: contentBlockIndex, delta: { type: 'text_delta', text: `\n\n[Error: ${String(err)}]` } }))))
      }
      if (currentTextBlockStarted) controller.enqueue(encoder.encode(formatSSE('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }))))
      if (inToolCall) controller.enqueue(encoder.encode(formatSSE('content_block_stop', JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex }))))
      finishStream(controller, encoder, outputTokens, inputTokens, hadToolCalls)
    },
  })

  function finishStream(controller: ReadableStreamDefaultController, encoder: TextEncoder, outputTokens: number, inputTokens: number, hadToolCalls: boolean) {
    controller.enqueue(encoder.encode(formatSSE('message_delta', JSON.stringify({
      type: 'message_delta', delta: { stop_reason: hadToolCalls ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens },
    }))))
    controller.enqueue(encoder.encode(formatSSE('message_stop', JSON.stringify({ type: 'message_stop', usage: { input_tokens: inputTokens, output_tokens: outputTokens } }))))
    controller.close()
  }

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'x-request-id': messageId },
  })
}

export function createCopilotFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/v1/messages')) return globalThis.fetch(input, init)

    let anthropicBody: Record<string, unknown>
    try {
      const bodyText = init?.body instanceof ReadableStream ? await new Response(init.body).text()
        : typeof init?.body === 'string' ? init.body : '{}'
      anthropicBody = JSON.parse(bodyText)
    } catch { anthropicBody = {} }

    const model = anthropicBody.model as string || 'claude-sonnet-4'
    const chatMessages = translateMessages(anthropicBody.system as string | undefined, (anthropicBody.messages || []) as AnthropicMessage[])
    const chatBody: Record<string, unknown> = { model, messages: chatMessages, stream: true }
    const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]
    if (anthropicTools.length > 0) { chatBody.tools = translateTools(anthropicTools); chatBody.tool_choice = 'auto' }
    if (anthropicBody.temperature !== undefined) chatBody.temperature = anthropicBody.temperature

    const copilotToken = await getCopilotAccessToken()
    const copilotResponse = await globalThis.fetch(COPILOT_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${copilotToken}`,
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'vscode/1.99.0',
        'Editor-Plugin-Version': 'copilot-chat/0.25.0',
      },
      body: JSON.stringify(chatBody),
    })

    if (!copilotResponse.ok) {
      const errorText = await copilotResponse.text()
      return new Response(JSON.stringify({
        type: 'error', error: { type: 'api_error', message: `Copilot API error (${copilotResponse.status}): ${errorText}` },
      }), { status: copilotResponse.status, headers: { 'Content-Type': 'application/json' } })
    }

    return translateCopilotStreamToAnthropic(copilotResponse, model)
  }
}
