#!/usr/bin/env node
/**
 * Visual craft elevation hygiene (PR-10).
 * Fails on focus-prefixed accent ring debt and banned hover dialects under src/components.
 * Intentionally does NOT ban bare selection rings (Appendix B: DAG, ChatPane highlight, etc.).
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')

function rg(pattern, extraArgs = '') {
  try {
    return execSync(
      `grep -RInE ${JSON.stringify(pattern)} ${JSON.stringify(src)} --include='*.tsx' --include='*.ts' ${extraArgs} || true`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function filterNoise(lines) {
  return lines.filter(
    (l) =>
      !l.includes('.test.') &&
      !l.includes('focusClasses.ts') &&
      !l.includes('check-visual-dialects') &&
      !l.includes('focus-visible:ring-accent/10') &&
      !l.includes('focus-within:ring-accent/10'),
  )
}

const failures = []

// Focus-prefixed accent rings other than Field /10
const focusAccent = filterNoise(
  rg('focus(-visible|-within)?:[^=]*ring-accent'),
).filter((l) => !l.includes('ring-accent/10'))
if (focusAccent.length) {
  failures.push(['focus-prefixed ring-accent (non-Field)', focusAccent])
}

const focusRing = filterNoise(rg('ring-focus-ring'))
if (focusRing.length) {
  failures.push(['ring-focus-ring', focusRing])
}

const hoverMuted = filterNoise(rg('hover:bg-surface-muted'))
if (hoverMuted.length) {
  failures.push(['hover:bg-surface-muted', hoverMuted])
}

const hoverAccent = filterNoise(rg('hover:bg-accent-subtle'))
if (hoverAccent.length) {
  failures.push(['hover:bg-accent-subtle', hoverAccent])
}

const rounded5 = filterNoise(rg('rounded-\\[5px\\]'))
if (rounded5.length) {
  failures.push(['rounded-[5px]', rounded5])
}

const rich = filterNoise(rg('richColors'))
if (rich.length) {
  failures.push(['richColors', rich])
}

if (failures.length) {
  console.error('check-visual-dialects: FAIL\n')
  for (const [name, lines] of failures) {
    console.error(`## ${name} (${lines.length})`)
    for (const line of lines.slice(0, 40)) console.error(line)
    if (lines.length > 40) console.error(`… +${lines.length - 40} more`)
    console.error('')
  }
  process.exit(1)
}

console.log('check-visual-dialects: OK')
