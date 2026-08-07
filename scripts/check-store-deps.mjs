#!/usr/bin/env node
/**
 * Store-layer dependency hygiene (spec docs/design/2026-08-07-session-service-decomposition-spec.md §5).
 *
 * Rules:
 *  R1/R2 — any `src/store/*.ts` → `src/store/*.ts` import must carry a
 *          `store-dep(read-only): <reason>` comment on the import statement
 *          (read-only query dependencies only). No write coupling exists
 *          anymore (R3 cancelled 2026-08 — terminal lifecycle writes moved to
 *          `src/domain/terminalLifecycle.ts`).
 *  R4    — `src/domain/actions/*` modules must not import each other
 *          (shared logic goes to src/lib or the facade).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storeDir = path.join(root, 'src', 'store')
const actionsDir = path.join(root, 'src', 'domain', 'actions')

/** Grandfathered write couplings (R3). R3 cancelled 2026-08 — do not re-add. */
const ALLOWLIST = new Set([])

function listTs(dir) {
  return execSync(`ls ${JSON.stringify(dir)}/*.ts 2>/dev/null || true`, { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('.test.'))
}

const failures = []

// ── store → store edges (R1/R2/R3) ──────────────────────────────────────────
for (const file of listTs(storeDir)) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const base = path.basename(file, '.ts')
  const importRe = /from\s+['"][^'"]*\/store\/([A-Za-z0-9_]+)['"]/g
  let m
  while ((m = importRe.exec(src))) {
    const dep = m[1]
    const key = `${base}->${dep}`
    if (ALLOWLIST.has(key)) continue
    // A store-dep(read-only) marker must appear in the import statement window
    // (marker can sit on the import line or the line above it).
    const lineStart = src.slice(0, m.index).split('\n').length
    const window = lines.slice(Math.max(0, lineStart - 2), lineStart + 1).join('\n')
    if (!/store-dep\(read-only\)/.test(window)) {
      failures.push(`store edge ${key} (${path.relative(root, file)}:${lineStart}) — add \`// store-dep(read-only): <reason>\` or use a domain action`)
    }
  }
}

// ── actions → actions edges (R4) ────────────────────────────────────────────
for (const file of listTs(actionsDir)) {
  const src = readFileSync(file, 'utf8')
  const base = path.basename(file, '.ts')
  const importRe = /from\s+['"][^'"]*\/(?:actions|domain\/actions)\/([A-Za-z0-9_]+)['"]/g
  let m
  while ((m = importRe.exec(src))) {
    const dep = m[1]
    if (dep !== base) {
      failures.push(`actions edge ${base} -> ${dep} (${path.relative(root, file)}) — actions modules must not import each other`)
    }
  }
}

if (failures.length) {
  console.error('check-store-deps: FAIL\n')
  for (const line of failures.slice(0, 40)) console.error(line)
  if (failures.length > 40) console.error(`… +${failures.length - 40} more`)
  process.exit(1)
}

console.log('check-store-deps: OK')
