#!/usr/bin/env node
/**
 * debug-proxy.mjs — HTTP/HTTPS 纯净抓包代理
 *
 * silly-code 基础设施：拦截所有出站请求，记录完整请求/响应，
 * 支持 SSE 流式数据解析。
 *
 * 用法：
 *   node pipeline/debug-proxy.mjs                    # 默认端口 8877
 *   node pipeline/debug-proxy.mjs --port 9999        # 自定义端口
 *   node pipeline/debug-proxy.mjs --filter openai    # 只显示匹配 URL
 *   node pipeline/debug-proxy.mjs --body             # 显示完整 request body
 *   node pipeline/debug-proxy.mjs --response         # 显示完整 response body
 *   node pipeline/debug-proxy.mjs --sse              # 解析 SSE 事件流
 *
 * 配合使用：
 *   # 终端 1: 启动代理
 *   node pipeline/debug-proxy.mjs --sse --filter openai
 *
 *   # 终端 2: 通过代理运行
 *   HTTPS_PROXY=http://localhost:8877 HTTP_PROXY=http://localhost:8877 \
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *   CLAUDE_CODE_USE_OPENAI=1 node pipeline/build/cli-patched.js -p "say hello"
 *
 * 或者用 --import 模式（不需要代理，直接拦截 fetch）：
 *   node --import ./pipeline/debug-wrap.mjs pipeline/build/cli-patched.js -p "say hello"
 */

import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

// ── Args ──
const args = process.argv.slice(2)
const getArg = (name, def) => {
  const idx = args.indexOf(name)
  if (idx === -1) return def
  return args[idx + 1] || def
}
const hasFlag = (name) => args.includes(name)

const PORT = parseInt(getArg('--port', '8877'))
const FILTER = getArg('--filter', null)
const SHOW_BODY = hasFlag('--body')
const SHOW_RESPONSE = hasFlag('--response')
const PARSE_SSE = hasFlag('--sse')
const VERBOSE = hasFlag('--verbose')

// ── Colors ──
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

let reqCount = 0

function log(color, ...parts) {
  process.stderr.write(parts.map(p => `${color}${p}${C.reset}`).join(' ') + '\n')
}

function shouldShow(url) {
  if (!FILTER) return true
  return url.toLowerCase().includes(FILTER.toLowerCase())
}

function formatHeaders(headers) {
  const safe = { ...headers }
  if (safe.authorization) {
    const val = safe.authorization
    safe.authorization = val.startsWith('Bearer ')
      ? `Bearer ***${val.slice(-6)}`
      : '***'
  }
  return safe
}

function truncate(str, max = 500) {
  if (str.length <= max) return str
  return str.slice(0, max) + `... (${str.length} total)`
}

// ── HTTPS CONNECT tunnel (for HTTPS_PROXY mode) ──
function handleConnect(clientReq, clientSocket, head) {
  const id = ++reqCount
  const [host, port] = clientReq.url.split(':')
  const targetPort = parseInt(port || '443')

  if (!shouldShow(host)) {
    // Still proxy but don't log
  } else {
    log(C.cyan, `[#${id}] CONNECT ${host}:${targetPort}`)
  }

  const serverSocket = require('node:net').connect(targetPort, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) serverSocket.write(head)
    clientSocket.pipe(serverSocket)
    serverSocket.pipe(clientSocket)
  })

  serverSocket.on('error', (err) => {
    log(C.red, `[#${id}] CONNECT error: ${err.message}`)
    clientSocket.end()
  })

  clientSocket.on('error', () => serverSocket.destroy())
}

// ── HTTP proxy request ──
function handleRequest(clientReq, clientRes) {
  const id = ++reqCount
  const targetUrl = clientReq.url
  if (!shouldShow(targetUrl)) return proxyPass(clientReq, clientRes, targetUrl, id, false)

  const ts = new Date().toISOString().slice(11, 23)
  log(C.bold, `\n${'─'.repeat(60)}`)
  log(C.green, `[#${id}] ${ts} ${clientReq.method} ${targetUrl}`)

  if (VERBOSE) {
    log(C.dim, `  Headers: ${JSON.stringify(formatHeaders(clientReq.headers))}`)
  }

  proxyPass(clientReq, clientRes, targetUrl, id, true)
}

function proxyPass(clientReq, clientRes, targetUrl, id, showLogs) {
  const bodyChunks = []

  clientReq.on('data', (chunk) => bodyChunks.push(chunk))
  clientReq.on('end', () => {
    const body = Buffer.concat(bodyChunks)

    if (showLogs && SHOW_BODY && body.length > 0) {
      try {
        const parsed = JSON.parse(body.toString())
        log(C.yellow, `  Body: ${truncate(JSON.stringify(parsed, null, 2), 1000)}`)
      } catch {
        log(C.yellow, `  Body: (${body.length} bytes, non-JSON)`)
      }
    }

    const parsed = new URL(targetUrl)
    const mod = parsed.protocol === 'https:' ? https : http
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: clientReq.method,
      headers: { ...clientReq.headers, host: parsed.host },
    }

    const start = Date.now()
    const proxyReq = mod.request(options, (proxyRes) => {
      const ms = Date.now() - start
      const isSSE = (proxyRes.headers['content-type'] || '').includes('text/event-stream')

      if (showLogs) {
        const statusColor = proxyRes.statusCode < 300 ? C.green : proxyRes.statusCode < 400 ? C.yellow : C.red
        log(statusColor, `[#${id}] → ${proxyRes.statusCode} in ${ms}ms${isSSE ? ' (SSE stream)' : ''}`)
      }

      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)

      if (showLogs && isSSE && PARSE_SSE) {
        let buf = ''
        let eventCount = 0
        proxyRes.on('data', (chunk) => {
          clientRes.write(chunk)
          buf += chunk.toString()
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              log(C.magenta, `  SSE event: ${line.slice(7)}`)
              eventCount++
            } else if (line.startsWith('data: ') && VERBOSE) {
              const d = line.slice(6).trim()
              if (d !== '[DONE]') {
                try {
                  const parsed = JSON.parse(d)
                  const preview = JSON.stringify(parsed).slice(0, 200)
                  log(C.dim, `  SSE data: ${preview}`)
                } catch {
                  log(C.dim, `  SSE data: ${truncate(d, 100)}`)
                }
              } else {
                log(C.magenta, `  SSE: [DONE]`)
              }
            }
          }
        })
        proxyRes.on('end', () => {
          if (eventCount > 0) log(C.magenta, `  SSE total: ${eventCount} events`)
          clientRes.end()
        })
      } else if (showLogs && SHOW_RESPONSE) {
        const resChunks = []
        proxyRes.on('data', (chunk) => { clientRes.write(chunk); resChunks.push(chunk) })
        proxyRes.on('end', () => {
          const resBody = Buffer.concat(resChunks).toString()
          try {
            log(C.blue, `  Response: ${truncate(JSON.stringify(JSON.parse(resBody), null, 2), 1000)}`)
          } catch {
            log(C.blue, `  Response: (${resBody.length} bytes)`)
          }
          clientRes.end()
        })
      } else {
        proxyRes.pipe(clientRes)
      }
    })

    proxyReq.on('error', (err) => {
      if (showLogs) log(C.red, `[#${id}] → ERROR: ${err.message}`)
      clientRes.writeHead(502)
      clientRes.end(`Proxy error: ${err.message}`)
    })

    if (body.length > 0) proxyReq.write(body)
    proxyReq.end()
  })
}

// ── Server ──
const server = http.createServer(handleRequest)
server.on('connect', handleConnect)

server.listen(PORT, () => {
  log(C.bold, `\n  silly-code debug proxy`)
  log(C.cyan, `  Listening on http://localhost:${PORT}`)
  log(C.dim, `  Filter: ${FILTER || '(all)'}`)
  log(C.dim, `  Options: ${[
    SHOW_BODY && 'body',
    SHOW_RESPONSE && 'response',
    PARSE_SSE && 'sse',
    VERBOSE && 'verbose',
  ].filter(Boolean).join(', ') || '(default)'}`)
  log(C.dim, ``)
  log(C.dim, `  Usage with silly-code:`)
  log(C.dim, `  HTTPS_PROXY=http://localhost:${PORT} NODE_TLS_REJECT_UNAUTHORIZED=0 \\`)
  log(C.dim, `  CLAUDE_CODE_USE_OPENAI=1 node pipeline/build/cli-patched.js -p "test"`)
  log(C.dim, ``)
})
