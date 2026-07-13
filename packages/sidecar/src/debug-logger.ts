import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEBUG_ENABLED = process.env.HIP_DEBUG === '1'
const LOG_DIR = join(homedir(), '.hip', 'logs')
const BASE_NAME = DEBUG_ENABLED ? 'sidecar-debug' : 'sidecar'
const MAX_SIZE = 5 * 1024 * 1024  // 5 MB
const MAX_FILES = 5
let ready = false

function ensure(): void {
  if (ready) return
  ready = true
  try { mkdirSync(LOG_DIR, { recursive: true }) } catch { /* best effort */ }
}

function filePath(suffix: string): string {
  return join(LOG_DIR, `${BASE_NAME}${suffix}.log`)
}

function rotate(): void {
  for (let i = MAX_FILES - 1; i >= 0; i--) {
    const src = filePath(i === 0 ? '' : `.${i}`)
    if (!existsSync(src)) continue
    if (i >= MAX_FILES - 1) { try { unlinkSync(src) } catch { /* ok */ }; continue }
    const dst = filePath(`.${i + 1}`)
    try { renameSync(src, dst) } catch { /* best effort */ }
  }
}

function write(level: string, tag: string, msg: string, data?: Record<string, unknown>): void {
  ensure()
  const ts = new Date().toISOString()
  const extra = data ? ' ' + JSON.stringify(data) : ''
  const line = `[${ts}] [${level}] [${tag}] ${msg}${extra}\n`
  const p = filePath('')
  try {
    if (existsSync(p)) {
      try { if (statSync(p).size >= MAX_SIZE) rotate() } catch { /* proceed */ }
    }
    appendFileSync(p, line)
  } catch { /* silent — logging must never crash the app */ }
}

export function logInfo(tag: string, msg: string, data?: Record<string, unknown>): void {
  write('INFO', tag, msg, data)
}

export function logDebug(tag: string, msg: string, data?: Record<string, unknown>): void {
  if (!DEBUG_ENABLED) return
  write('DEBUG', tag, msg, data)
}

export function logDebugEveryN(tag: string, n: number, msg: string, data?: Record<string, unknown>): () => void {
  let c = 0
  return () => { c++; if (c % n === 1 || n <= 1) logDebug(tag, msg, { ...data, seq: c }) }
}

/**
 * Structured debug line for observability observations (E2).
 * Same HIP_DEBUG gate as logDebug; never throws.
 * Prefer this over ad-hoc logDebug when emitting parent links / loop mirrors
 * so log greps can key on `[observation]`.
 */
export function logObservation(msg: string, data?: Record<string, unknown>): void {
  try {
    logDebug('observation', msg, data)
  } catch {
    /* logging must never crash the app */
  }
}
