/**
 * Dependency Manager — cohesive management of all external binary dependencies.
 *
 * Reads deps.json (project root) as the single source of truth.
 * Provides: checkAll(), checkDep(), installDep(), checkForSelfUpdate()
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

export type PlatformInfo = {
  url: string
  binary: string
  extractPath: string
  sha256?: string
}

export type DepEntry = {
  version: string
  versionConstraint: string
  versionCmd: string
  installUrl?: string
  required: boolean
  description: string
  systemProvided?: boolean
  platforms?: Record<string, PlatformInfo>
}

export type DepsManifest = {
  $schema: string
  description: string
  selfUpdate: {
    repo: string
    branch: string
    checkUrl: string
    checkInterval: number
  }
  deps: Record<string, DepEntry>
  npm: {
    lockfile: string
    installCmd: string
    fallbackCmd: string
  }
  lastChecked: string | null
  checkInterval: number
}

export type DepStatus = {
  name: string
  required: boolean
  installed: boolean
  currentVersion: string | null
  wantedVersion: string
  needsUpdate: boolean
  description: string
  systemProvided: boolean
}

const BIN_DIR = join(homedir(), '.local', 'bin')
const STATE_FILE = join(homedir(), '.silly-code', 'deps-state.json')

function getManifestPath(): string {
  // Walk up from __dirname to find project root (where deps.json lives)
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'deps.json')
    if (existsSync(candidate)) return candidate
    dir = join(dir, '..')
  }
  // Fallback: SILLY_CODE_HOME or default install location
  const installDir = process.env.SILLY_CODE_HOME || join(homedir(), '.local', 'share', 'silly-code')
  return join(installDir, 'deps.json')
}

export function loadManifest(): DepsManifest {
  const path = getManifestPath()
  if (!existsSync(path)) {
    throw new Error(`deps.json not found at ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

function getCurrentVersion(dep: DepEntry): string | null {
  try {
    const out = execSync(dep.versionCmd, {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function getPlatformKey(): string {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `${os}-${arch}`
}

/**
 * Compare semver strings: returns -1, 0, or 1
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

/**
 * Check if version satisfies constraint like ">=1.3.11"
 */
function satisfiesConstraint(version: string, constraint: string): boolean {
  const match = constraint.match(/^(>=?)(\S+)$/)
  if (!match) return true
  const [, op, target] = match
  const cmp = compareSemver(version, target!)
  if (op === '>=') return cmp >= 0
  if (op === '>') return cmp > 0
  return true
}

export function checkDep(name: string, dep: DepEntry): DepStatus {
  const current = getCurrentVersion(dep)
  const installed = current !== null
  const needsUpdate = installed
    ? !satisfiesConstraint(current, dep.versionConstraint)
    : dep.required

  return {
    name,
    required: dep.required,
    installed,
    currentVersion: current,
    wantedVersion: dep.version,
    needsUpdate,
    description: dep.description,
    systemProvided: dep.systemProvided || false,
  }
}

export function checkAll(): DepStatus[] {
  const manifest = loadManifest()
  return Object.entries(manifest.deps).map(([name, dep]) => checkDep(name, dep))
}

/**
 * Install or update a single binary dependency.
 * Returns true on success.
 */
export async function installDep(name: string): Promise<boolean> {
  const manifest = loadManifest()
  const dep = manifest.deps[name]
  if (!dep) throw new Error(`Unknown dependency: ${name}`)
  if (dep.systemProvided) {
    console.error(`${name} is system-provided — install it via your package manager`)
    return false
  }

  // Special case: bun
  if (name === 'bun' && dep.installUrl) {
    try {
      execSync(`curl -fsSL ${dep.installUrl} | bash`, {
        stdio: 'inherit',
        timeout: 120000,
      })
      return true
    } catch {
      return false
    }
  }

  // Binary download from platforms map
  if (!dep.platforms) {
    console.error(`No platform binaries defined for ${name}`)
    return false
  }

  const platKey = getPlatformKey()
  const platInfo = dep.platforms[platKey]
  if (!platInfo) {
    console.error(`No binary for platform ${platKey} — install ${name} manually`)
    return false
  }

  const version = dep.version
  const url = platInfo.url.replace(/\$\{VERSION\}/g, version)
  const extractPath = platInfo.extractPath.replace(/\$\{VERSION\}/g, version)

  mkdirSync(BIN_DIR, { recursive: true })

  try {
    const tmpDir = `/tmp/silly-dep-${name}-${Date.now()}`
    execSync(`mkdir -p ${tmpDir}`, { stdio: 'pipe' })

    // Download and extract
    execSync(`curl -fsSL "${url}" | tar xz -C "${tmpDir}"`, {
      stdio: 'inherit',
      timeout: 60000,
    })

    // Move binary
    const srcPath = join(tmpDir, extractPath)
    const destPath = join(BIN_DIR, platInfo.binary)
    execSync(`mv "${srcPath}" "${destPath}" && chmod +x "${destPath}"`, {
      stdio: 'inherit',
    })

    // Cleanup
    execSync(`rm -rf "${tmpDir}"`, { stdio: 'pipe' })

    return true
  } catch (e) {
    console.error(`Failed to install ${name}: ${e}`)
    return false
  }
}

/**
 * Check if silly-code itself has updates available.
 * Compares local HEAD against remote HEAD (GitHub API, lightweight).
 */
export async function checkForSelfUpdate(): Promise<{
  hasUpdate: boolean
  localCommit: string
  remoteCommit: string | null
  error?: string
}> {
  let localCommit = 'unknown'
  try {
    localCommit = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {}

  const manifest = loadManifest()
  const checkUrl = manifest.selfUpdate.checkUrl

  try {
    const resp = await fetch(checkUrl, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) {
      return { hasUpdate: false, localCommit, remoteCommit: null, error: `HTTP ${resp.status}` }
    }
    const data = (await resp.json()) as { sha: string }
    const remoteCommit = data.sha
    return {
      hasUpdate: localCommit !== remoteCommit,
      localCommit,
      remoteCommit,
    }
  } catch (e: any) {
    return { hasUpdate: false, localCommit, remoteCommit: null, error: e.message }
  }
}

/**
 * Save last-checked timestamp to state file.
 */
export function saveCheckState(): void {
  const dir = join(homedir(), '.silly-code')
  mkdirSync(dir, { recursive: true })
  const state = { lastChecked: new Date().toISOString() }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

/**
 * Should we run an update check? (Based on checkInterval)
 */
export function shouldCheck(): boolean {
  const manifest = loadManifest()
  try {
    if (!existsSync(STATE_FILE)) return true
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    const last = new Date(state.lastChecked).getTime()
    const now = Date.now()
    return now - last > manifest.checkInterval * 1000
  } catch {
    return true
  }
}

/**
 * Quick summary for CLI display.
 */
export function formatDepStatus(statuses: DepStatus[]): string {
  const lines: string[] = []
  for (const s of statuses) {
    const icon = s.installed ? (s.needsUpdate ? '⚠' : '✓') : '✗'
    const ver = s.currentVersion || 'not installed'
    const want = s.needsUpdate ? ` (want ${s.wantedVersion})` : ''
    lines.push(`  ${icon} ${s.name}: ${ver}${want} — ${s.description}`)
  }
  return lines.join('\n')
}
