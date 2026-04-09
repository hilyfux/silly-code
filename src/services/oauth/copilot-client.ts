/**
 * GitHub Copilot OAuth client.
 *
 * Uses GitHub Device Flow to authenticate, then exchanges the GitHub token
 * for a short-lived Copilot token (expires ~30 min, auto-refreshed).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import {
  COPILOT_GITHUB_CLIENT_ID,
  COPILOT_GITHUB_DEVICE_CODE_URL,
  COPILOT_GITHUB_ACCESS_TOKEN_URL,
  COPILOT_TOKEN_URL,
  COPILOT_SCOPES,
} from '../../constants/copilot-oauth.js'
import { openBrowser } from '../../utils/browser.js'

export type CopilotTokens = {
  githubToken: string
  copilotToken: string
  copilotExpiresAt: number
}

const DATA_DIR = process.env.SILLY_CODE_DATA || join(process.env.HOME || '', '.silly-code')
const TOKEN_PATH = join(DATA_DIR, 'copilot-oauth.json')

export function saveCopilotTokens(tokens: CopilotTokens): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 })
}

export function loadCopilotTokens(): CopilotTokens | null {
  if (!existsSync(TOKEN_PATH)) return null
  try {
    const data = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'))
    if (data.githubToken && data.copilotToken) return data
  } catch {}
  return null
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const resp = await fetch(COPILOT_GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: COPILOT_GITHUB_CLIENT_ID,
      scope: COPILOT_SCOPES,
    }),
  })
  if (!resp.ok) throw new Error(`Device code request failed: ${resp.status}`)
  return resp.json()
}

async function pollForGitHubToken(deviceCode: string, interval: number): Promise<string> {
  while (true) {
    await new Promise(r => setTimeout(r, interval * 1000))
    const resp = await fetch(COPILOT_GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: COPILOT_GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = await resp.json() as Record<string, string>
    if (data.access_token) return data.access_token
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') { interval += 5; continue }
    if (data.error === 'expired_token') throw new Error('Device code expired. Try again.')
    if (data.error === 'access_denied') throw new Error('Access denied by user.')
    throw new Error(`Unexpected error: ${data.error}`)
  }
}

async function exchangeForCopilotToken(githubToken: string): Promise<{ token: string; expiresAt: number }> {
  const resp = await fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
    },
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Copilot token exchange failed (${resp.status}): ${text}`)
  }
  const data = await resp.json() as { token: string; expires_at: number }
  return { token: data.token, expiresAt: data.expires_at * 1000 }
}

export async function getCopilotAccessToken(): Promise<string> {
  let tokens = loadCopilotTokens()
  if (!tokens) throw new Error('Not logged in to Copilot. Run: silly login copilot')
  const BUFFER_MS = 2 * 60 * 1000
  if (tokens.copilotExpiresAt - BUFFER_MS < Date.now()) {
    const { token, expiresAt } = await exchangeForCopilotToken(tokens.githubToken)
    tokens = { ...tokens, copilotToken: token, copilotExpiresAt: expiresAt }
    saveCopilotTokens(tokens)
  }
  return tokens.copilotToken
}

export async function loginCopilot(): Promise<CopilotTokens> {
  console.log('\n  GitHub Copilot — Device Flow Login\n')
  const device = await requestDeviceCode()
  console.log(`  Open: ${device.verification_uri}`)
  console.log(`  Code: ${device.user_code}\n`)
  console.log('  Waiting for authorization...')
  openBrowser(device.verification_uri)
  const githubToken = await pollForGitHubToken(device.device_code, device.interval)
  console.log('  GitHub authorized. Exchanging for Copilot token...')
  const { token, expiresAt } = await exchangeForCopilotToken(githubToken)
  const tokens: CopilotTokens = { githubToken, copilotToken: token, copilotExpiresAt: expiresAt }
  saveCopilotTokens(tokens)
  console.log('  Copilot login successful!\n')
  return tokens
}
