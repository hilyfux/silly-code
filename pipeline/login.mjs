#!/usr/bin/env node
/**
 * login.mjs — silly-code OAuth 登录工具
 *
 * 用法：
 *   node pipeline/login.mjs copilot    # GitHub Copilot 登录
 *   node pipeline/login.mjs codex      # OpenAI Codex 登录（TODO）
 *   node pipeline/login.mjs status     # 查看所有 token 状态
 *
 * Token 存储在 ~/.silly-code/ 目录下。
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DATA_DIR = process.env.SILLY_CODE_DATA || path.join(process.env.HOME || '~', '.silly-code')

// ── Colors ──
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
}

function log(color, msg) { console.log(`${color}${msg}${C.reset}`) }

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
}

// ── GitHub Copilot OAuth (Device Flow) ──────────────────────

// VS Code GitHub Copilot client ID (public, used by all Copilot clients)
const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98'

async function loginCopilot() {
  log(C.bold, '\n  🔑 GitHub Copilot 登录\n')

  // Step 1: Request device code
  log(C.dim, '  请求设备码...')
  const codeResp = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: 'read:user',
    }),
  })

  if (!codeResp.ok) {
    log(C.red, `  错误: ${codeResp.status} ${await codeResp.text()}`)
    process.exit(1)
  }

  const codeData = await codeResp.json()
  const { device_code, user_code, verification_uri, expires_in, interval } = codeData

  // Step 2: Show user the code
  log(C.cyan, `  ────────────────────────────────────`)
  log(C.bold, `  打开浏览器访问: ${C.cyan}${verification_uri}`)
  log(C.bold, `  输入验证码:     ${C.yellow}${user_code}`)
  log(C.cyan, `  ────────────────────────────────────`)
  log(C.dim, `  有效期 ${Math.floor(expires_in / 60)} 分钟，等待授权...\n`)

  // Step 3: Poll for token
  const pollInterval = (interval || 5) * 1000
  const deadline = Date.now() + expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval))

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const tokenData = await tokenResp.json()

    if (tokenData.access_token) {
      // Step 4: Exchange for Copilot token
      log(C.green, '  ✓ GitHub 授权成功，获取 Copilot token...')

      const copilotResp = await fetch('https://api.github.com/copilot_internal/v2/token', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Editor-Version': 'vscode/1.85.0',
          'Copilot-Integration-Id': 'vscode-chat',
          'Accept': 'application/json',
        },
      })

      if (!copilotResp.ok) {
        log(C.red, `  Copilot token 获取失败: ${copilotResp.status}`)
        log(C.red, `  ${await copilotResp.text()}`)
        log(C.yellow, '  确认你的 GitHub 账号有 Copilot 订阅')
        process.exit(1)
      }

      const copilotData = await copilotResp.json()

      // Step 5: Save
      ensureDir()
      const tokenFile = path.join(DATA_DIR, 'copilot-oauth.json')
      const saved = {
        githubToken: tokenData.access_token,
        copilotToken: copilotData.token,
        copilotExpiresAt: (copilotData.expires_at || 0) * 1000,
        savedAt: new Date().toISOString(),
      }
      fs.writeFileSync(tokenFile, JSON.stringify(saved, null, 2), { mode: 0o600 })

      log(C.green, `  ✓ Copilot token 已保存到 ${tokenFile}`)
      log(C.green, `  ✓ Token 有效期至 ${new Date(saved.copilotExpiresAt).toLocaleString()}`)
      log(C.dim, `  运行时会自动刷新 Copilot token\n`)
      log(C.bold, `  测试: CLAUDE_CODE_USE_COPILOT=1 node pipeline/build/cli-patched.js -p "say hello"\n`)
      return
    }

    if (tokenData.error === 'authorization_pending') {
      process.stdout.write('.')
      continue
    }

    if (tokenData.error === 'slow_down') {
      await new Promise(r => setTimeout(r, 5000))
      continue
    }

    if (tokenData.error === 'expired_token') {
      log(C.red, '\n  验证码已过期，请重新运行')
      process.exit(1)
    }

    log(C.red, `\n  未知错误: ${JSON.stringify(tokenData)}`)
    process.exit(1)
  }

  log(C.red, '\n  超时，请重新运行')
  process.exit(1)
}

// ── OpenAI Codex OAuth (PKCE Browser Flow) ───────────────────

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_REDIRECT_PORT = 1455
const CODEX_REDIRECT_URI = `http://localhost:${CODEX_REDIRECT_PORT}/auth/callback`

async function loginCodex() {
  log(C.bold, '\n  🔑 OpenAI Codex 登录\n')

  const { randomBytes, createHash } = await import('node:crypto')
  const http = await import('node:http')
  const { URL } = await import('node:url')

  // Generate PKCE
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email offline_access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  })
  const authUrl = `${CODEX_AUTH_URL}?${params}`

  // Start local callback server — must be listening BEFORE we open the browser
  const server = http.createServer()
  let codeResolve, codeReject
  const codePromise = new Promise((resolve, reject) => {
    codeResolve = resolve
    codeReject = reject
  })

  server.on('request', (req, res) => {
    const url = new URL(req.url, `http://localhost:${CODEX_REDIRECT_PORT}`)
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404)
      res.end()
      return
    }

    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    if (error) {
      res.end('<html><body><h2>Authentication failed</h2><p>You can close this window.</p></body></html>')
      server.close()
      codeReject(new Error(`OAuth error: ${error}`))
      return
    }
    if (returnedState !== state) {
      res.end('<html><body><h2>State mismatch</h2><p>Please try again.</p></body></html>')
      server.close()
      codeReject(new Error('State mismatch'))
      return
    }

    res.end('<html><body><h2>✅ 登录成功!</h2><p>可以关闭此窗口了。</p></body></html>')
    server.close()
    codeResolve(code)
  })

  // Wait for server to be ready, THEN open browser
  await new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log(C.red, `  错误: 端口 ${CODEX_REDIRECT_PORT} 已被占用`)
        log(C.dim, `  请关闭占用该端口的程序后重试`)
        reject(err)
      } else {
        reject(err)
      }
    })
    server.listen(CODEX_REDIRECT_PORT, () => {
      log(C.dim, `  回调服务器已启动 (port ${CODEX_REDIRECT_PORT})`)
      resolve()
    })
  })

  // Timeout after 5 minutes
  const timeout = setTimeout(() => {
    server.close()
    codeReject(new Error('Login timeout (5 min)'))
  }, 300000)

  // Now open browser
  log(C.cyan, `  ────────────────────────────────────`)
  log(C.bold, `  打开浏览器进行 OpenAI 登录...`)
  log(C.dim, `  如果浏览器没有自动打开，请手动访问:`)
  log(C.dim, `  ${authUrl.slice(0, 80)}...`)
  log(C.cyan, `  ────────────────────────────────────`)
  log(C.dim, `  等待浏览器授权回调...\n`)

  const { execFile } = await import('node:child_process')
  execFile('open', [authUrl])

  // Wait for callback
  let code
  try {
    code = await codePromise
  } catch (e) {
    clearTimeout(timeout)
    log(C.red, `  错误: ${e.message}`)
    process.exit(1)
  }
  clearTimeout(timeout)

  log(C.green, '  ✓ 授权成功，交换 token...')

  // Exchange code for tokens
  const tokenResp = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code,
      redirect_uri: CODEX_REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!tokenResp.ok) {
    log(C.red, `  Token 交换失败: ${tokenResp.status}`)
    log(C.red, `  ${await tokenResp.text()}`)
    process.exit(1)
  }

  const tokenData = await tokenResp.json()

  // Try to exchange for API-compatible token
  let apiToken = null
  if (tokenData.id_token) {
    log(C.dim, '  尝试获取 API 兼容 token...')
    const exchangeResp = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: CODEX_CLIENT_ID,
        requested_token: 'openai-api-key',
        subject_token: tokenData.id_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      }),
    })
    if (exchangeResp.ok) {
      const exchangeData = await exchangeResp.json()
      apiToken = exchangeData.access_token || null
    }
  }

  // Save tokens
  ensureDir()
  const tokenFile = path.join(DATA_DIR, 'codex-oauth.json')
  const saved = {
    access_token: apiToken || tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    id_token: tokenData.id_token || null,
    expires_in: tokenData.expires_in,
    savedAt: new Date().toISOString(),
    method: apiToken ? 'api-key-exchange' : 'oauth-access-token',
  }
  fs.writeFileSync(tokenFile, JSON.stringify(saved, null, 2), { mode: 0o600 })

  log(C.green, `  ✓ Token 已保存到 ${tokenFile}`)
  log(C.green, `  ✓ 方式: ${saved.method}`)
  if (saved.expires_in) log(C.dim, `  Token 有效期: ${Math.floor(saved.expires_in / 60)} 分钟`)
  log(C.dim, `\n  测试: CLAUDE_CODE_USE_OPENAI=1 node pipeline/build/cli-patched.js -p "say hello"\n`)
}

// ── Status check ──────────────────────────────────────────

function showStatus() {
  log(C.bold, '\n  silly-code token 状态\n')

  const tokens = [
    { name: 'Copilot', file: 'copilot-oauth.json', check: (d) => d.githubToken ? '✓ GitHub token' : '✗' },
    { name: 'Codex', file: 'codex-oauth.json', check: (d) => d.access_token ? '✓ token' : '✗' },
  ]

  for (const t of tokens) {
    const fp = path.join(DATA_DIR, t.file)
    if (!fs.existsSync(fp)) {
      log(C.red, `  ✗ ${t.name}: 未登录`)
      continue
    }
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
      const status = t.check(data)
      const age = data.savedAt ? ` (saved ${data.savedAt})` : ''
      log(C.green, `  ${status} ${t.name}${C.dim}${age}`)
    } catch {
      log(C.red, `  ✗ ${t.name}: token 文件损坏`)
    }
  }
  console.log()
}

// ── Main ──────────────────────────────────────────────────

const cmd = process.argv[2]

switch (cmd) {
  case 'copilot':
    await loginCopilot()
    break
  case 'codex':
    await loginCodex()
    break
  case 'status':
    showStatus()
    break
  default:
    log(C.bold, '\n  silly-code login\n')
    log(C.dim, '  用法:')
    log(C.dim, '    node pipeline/login.mjs copilot   — GitHub Copilot 登录')
    log(C.dim, '    node pipeline/login.mjs codex     — OpenAI Codex 登录 (WIP)')
    log(C.dim, '    node pipeline/login.mjs status    — 查看 token 状态\n')
    break
}
