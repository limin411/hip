import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SidecarEntry {
  command: string
  args: string[]
  kind: 'bin' | 'ncc' | 'tsx-dev'
}

function tryPackageDist(): SidecarEntry | null {
  try {
    const require = createRequire(import.meta.url)
    const pkgJson = require.resolve('@hip/sidecar/package.json')
    const dist = join(dirname(pkgJson), 'dist', 'index.js')
    if (existsSync(dist)) {
      return { command: process.execPath, args: [dist], kind: 'ncc' }
    }
  } catch {
    /* package not resolvable */
  }
  return null
}

function findMonorepoRoot(start: string): string | null {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'packages', 'sidecar', 'src', 'main.ts'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function tryMonorepoTsx(): SidecarEntry | null {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))]
  for (const start of starts) {
    const root = findMonorepoRoot(start)
    if (!root) continue
    const main = join(root, 'packages', 'sidecar', 'src', 'main.ts')
    const tsxBin = join(root, 'node_modules', '.bin', 'tsx')
    if (existsSync(tsxBin) && existsSync(main)) {
      return { command: tsxBin, args: [main], kind: 'tsx-dev' }
    }
    const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    if (existsSync(tsxCli) && existsSync(main)) {
      return { command: process.execPath, args: [tsxCli, main], kind: 'tsx-dev' }
    }
  }
  return null
}

/** Resolve how to launch the sidecar process (design K12). */
export function resolveSidecarEntry(env: NodeJS.ProcessEnv = process.env): SidecarEntry {
  const bin = env.HIP_SIDECAR_BIN?.trim()
  if (bin) {
    if (/\.(c|m)?js$/i.test(bin)) {
      return { command: process.execPath, args: [bin], kind: 'bin' }
    }
    return { command: bin, args: [], kind: 'bin' }
  }

  // Prefer monorepo tsx when sources are present: ncc bundles may break on node:sqlite.
  // Production images / HIP_SIDECAR_BIN still pin the entry explicitly.
  const dev = tryMonorepoTsx()
  if (dev) return dev

  const ncc = tryPackageDist()
  if (ncc) return ncc

  throw Object.assign(new Error('sidecar entry not found'), { code: 'SIDECAR_ENTRY_NOT_FOUND' })
}

/** Parse handshake stdout lines; ignore leading garbage. */
export function parseHandshakeLine(line: string): { port: number; token: string } | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed) as unknown
    if (!obj || typeof obj !== 'object') return null
    const rec = obj as Record<string, unknown>
    if (typeof rec.port !== 'number' || typeof rec.token !== 'string') return null
    if (!Number.isFinite(rec.port) || rec.port <= 0) return null
    if (!rec.token) return null
    return { port: rec.port, token: rec.token }
  } catch {
    return null
  }
}

/** Extract last valid handshake from a multi-line log buffer. */
export function parseHandshakeFromLog(text: string): { port: number; token: string } | null {
  let last: { port: number; token: string } | null = null
  for (const line of text.split(/\r?\n/)) {
    const hit = parseHandshakeLine(line)
    if (hit) last = hit
  }
  return last
}
