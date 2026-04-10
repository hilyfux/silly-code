/**
 * debug-wrap.mjs — Fetch 拦截器（纯净版）
 *
 * silly-code 基础调试设施。通过 --import 注入，拦截所有 globalThis.fetch 调用。
 * 不需要代理服务器，不需要证书，零配置。
 *
 * 用法：
 *   # 基础模式 — 看所有请求
 *   node --import ./pipeline/debug-wrap.mjs pipeline/build/cli-patched.js -p "say hello"
 *
 *   # 配合环境变量
 *   SILLY_DEBUG_BODY=1    — 显示 request body（前 500 字符）
 *   SILLY_DEBUG_RESPONSE=1 — 显示 response body（前 500 字符）
 *   SILLY_DEBUG_FILTER=openai — 只显示匹配 URL
 *   SILLY_DEBUG_HEARTBEAT=1 — 显示 event loop 心跳
 *
 *   # 完整调试
 *   SILLY_DEBUG_BODY=1 SILLY_DEBUG_RESPONSE=1 SILLY_DEBUG_HEARTBEAT=1 \
 *   CLAUDE_CODE_USE_OPENAI=1 \
 *   node --import ./pipeline/debug-wrap.mjs pipeline/build/cli-patched.js -p "test"
 */

const SHOW_BODY = !!process.env.SILLY_DEBUG_BODY
const SHOW_RESPONSE = !!process.env.SILLY_DEBUG_RESPONSE
const FILTER = process.env.SILLY_DEBUG_FILTER || null
const SHOW_HEARTBEAT = !!process.env.SILLY_DEBUG_HEARTBEAT

const _realFetch = globalThis.fetch
let _reqCount = 0

function shouldShow(url) {
  if (!FILTER) return true
  return url.toLowerCase().includes(FILTER.toLowerCase())
}

function trunc(s, n = 500) {
  return s.length <= n ? s : s.slice(0, n) + `… (${s.length} total)`
}

globalThis.fetch = async function debugFetch(url, init = {}) {
  const id = ++_reqCount
  const urlStr = typeof url === 'string' ? url : url?.url || String(url)
  const method = init?.method || 'GET'

  if (!shouldShow(urlStr)) return _realFetch(url, init)

  const ts = new Date().toISOString().slice(11, 23)
  process.stderr.write(`\n[${ts}] #${id} ${method} ${urlStr}\n`)

  // Auth header (type only, not value)
  const h = init?.headers || {}
  const auth = h['Authorization'] || h['authorization']
  if (auth) {
    const kind = auth.startsWith('Bearer ') ? `Bearer ***${auth.slice(-6)}` : '***'
    process.stderr.write(`  Auth: ${kind}\n`)
  }

  // Request body
  if (SHOW_BODY && init?.body) {
    try {
      const preview = trunc(JSON.stringify(JSON.parse(init.body)), 500)
      process.stderr.write(`  Body: ${preview}\n`)
    } catch {
      process.stderr.write(`  Body: (${String(init.body).length} bytes, non-JSON)\n`)
    }
  }

  const start = Date.now()
  try {
    const resp = await _realFetch(url, init)
    const ms = Date.now() - start
    const ct = resp.headers?.get?.('content-type') || ''
    const isSSE = ct.includes('text/event-stream')

    process.stderr.write(`  → ${resp.status} ${ms}ms${isSSE ? ' [SSE]' : ''}\n`)

    // Response body (clone to not consume)
    if (SHOW_RESPONSE && !isSSE) {
      try {
        const clone = resp.clone()
        const text = await clone.text()
        process.stderr.write(`  Resp: ${trunc(text, 500)}\n`)
      } catch { /* ignore clone errors */ }
    }

    return resp
  } catch (err) {
    process.stderr.write(`  → ERROR ${Date.now() - start}ms: ${err.message}\n`)
    throw err
  }
}

// ── Error handlers ──
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`\n[UNHANDLED] ${reason}\n${reason?.stack || ''}\n`)
})
process.on('uncaughtException', (err) => {
  process.stderr.write(`\n[UNCAUGHT] ${err.message}\n${err.stack || ''}\n`)
})

// ── Heartbeat ──
if (SHOW_HEARTBEAT) {
  let hb = 0
  const timer = setInterval(() => {
    const handles = process._getActiveHandles?.()?.length ?? '?'
    process.stderr.write(`[HB] #${++hb} ${process.uptime().toFixed(1)}s handles=${handles}\n`)
  }, 2000)
  timer.unref()
}

process.stderr.write(`[SILLY-DEBUG] fetch interceptor active${FILTER ? ` (filter: ${FILTER})` : ''}\n`)
