#!/usr/bin/env node
// scripts/eval-gates.mjs — declarative reliability gates + append-only evidence ledger.
//
// Why this exists: a benchmark you cannot trend is just a screenshot. Each gate
// pairs an invariant with a *quantifiable* oracle, the commands that prove it,
// and the assertions that back it. Every run appends one line to an append-only
// ledger, which is what makes "is this stable yet?" answerable.
//
// Discipline (borrowed from the reference harnesses, do not relax):
//   - A low score is DATA, not an infrastructure failure. Never coerce failures
//     to zero to keep a dashboard green.
//   - A command that cannot be run (missing tool, timeout, platform gap) is
//     `unverifiable`, which BLOCKS. It never quietly counts as a pass.
//   - Self-skipping tests are fine; an unexplained skip is not a pass either.
//
// Usage:
//   node scripts/eval-gates.mjs                # run all gates
//   node scripts/eval-gates.mjs --gate <id>    # run one gate
//   node scripts/eval-gates.mjs --list         # print the registry
//   HIP_EVAL_ROOT=<dir>                        # override output root
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { homedir, platform, arch, release } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const GATES_FILE = join(here, 'eval-gates.json')

const args = process.argv.slice(2)
const argValue = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (flag) => args.includes(flag)

const registry = JSON.parse(readFileSync(GATES_FILE, 'utf8'))
const outRoot = process.env.HIP_EVAL_ROOT || join(homedir(), '.hip', 'eval-runs')
const gateDir = join(outRoot, 'gates')
mkdirSync(gateDir, { recursive: true })
const ledgerPath = join(gateDir, 'ledger.jsonl')

if (hasFlag('--list')) {
  for (const g of registry.gates) {
    console.log(`${g.id.padEnd(38)} ${g.maturity.padEnd(12)} ${g.title}`)
  }
  process.exit(0)
}

/** Run one shell string. Returns an honest result — never throws. */
function runCommand(cmd, timeoutMs) {
  const started = Date.now()
  try {
    const res = spawnSync(cmd, {
      cwd: repoRoot,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    })
    const durationMs = Date.now() - started
    if (res.error) {
      return { ok: false, reason: 'spawn-error', detail: String(res.error.message ?? res.error), durationMs }
    }
    if (res.signal) {
      return { ok: false, reason: 'killed-by-signal', detail: `signal=${res.signal}`, durationMs }
    }
    if (typeof res.status !== 'number') {
      return { ok: false, reason: 'no-exit-status', detail: 'unknown', durationMs }
    }
    const tail = (res.stdout || '').trim().split('\n').slice(-12).join('\n')
    return { ok: res.status === 0, reason: res.status === 0 ? 'passed' : 'nonzero-exit', detail: tail, exitCode: res.status, durationMs }
  } catch (err) {
    return { ok: false, reason: 'runner-exception', detail: String(err?.message ?? err), durationMs: Date.now() - started }
  }
}

const PER_GATE_TIMEOUT_MS = 15 * 60 * 1000
const only = argValue('--gate')
const startedAt = new Date()
const results = []

for (const gate of registry.gates) {
  if (only && gate.id !== only) continue
  const cmdStart = Date.now()
  const commandResults = (gate.commands ?? []).map((c) => runCommand(c, PER_GATE_TIMEOUT_MS))
  const durationSeconds = Number(((Date.now() - cmdStart) / 1000).toFixed(2))

  const allOk = commandResults.length > 0 && commandResults.every((r) => r.ok)
  const anyFailure = commandResults.some((r) => !r.ok)
  const gaps = (gate.knownGaps ?? []).filter((g) => !g.platform || g.platform === platform())

  let status
  if (commandResults.length === 0) status = 'unverifiable'
  else if (allOk) status = 'passed'
  else if (anyFailure) status = 'failed'
  else status = 'unverifiable'

  results.push({
    id: gate.id,
    maturity: gate.maturity,
    title: gate.title,
    invariant: gate.invariant,
    oracle: gate.oracle,
    status,
    durationSeconds,
    commands: (gate.commands ?? []).map((c, i) => ({
      command: c,
      ...commandResults[i],
    })),
    knownGaps: gaps,
    assertionRefs: gate.assertionRefs ?? [],
  })

  const mark = status === 'passed' ? 'PASS' : status === 'failed' ? 'FAIL' : 'UNVERIFIABLE'
  console.log(`[${mark}] ${gate.id} (${gate.maturity}) ${durationSeconds}s`)
}

// ── Append-only evidence ledger ─────────────────────────────────────────────
const evidence = {
  schemaVersion: 1,
  date: startedAt.toISOString().slice(0, 10),
  at: startedAt.toISOString(),
  platform: platform(),
  arch: arch(),
  osRelease: release(),
  node: process.version,
  head: runCommand('git rev-parse --short HEAD', 10_000).detail?.trim() || 'unknown',
  dirty: (runCommand('git status --porcelain', 20_000).detail ?? '').trim().length > 0,
  gates: results.map((r) => ({ id: r.id, maturity: r.maturity, status: r.status, durationSeconds: r.durationSeconds })),
}
appendFileSync(ledgerPath, JSON.stringify(evidence) + '\n')

// ── Soak / promotion eligibility (derived from the ledger, never guessed) ───
function readLedger() {
  if (!existsSync(ledgerPath)) return []
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l) } catch { return null }
    })
    .filter(Boolean)
}

const history = readLedger()
const policy = registry.blockingPromotion ?? { minimumSoakRuns: 5, minimumSoakDays: 3, maximumUnexplainedFlakes: 0 }
const soak = {}
for (const gate of registry.gates) {
  // Only runs that actually observed this gate count as evidence.
  const observing = history.filter((h) => h.gates?.some((g) => g.id === gate.id))
  const entries = observing.map((h) => h.gates.find((g) => g.id === gate.id))
  let consecutivePassing = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'passed') consecutivePassing++
    else break
  }
  const distinctDays = new Set(observing.map((h) => h.date)).size
  const unexplained = entries.filter((e) => e.status === 'unverifiable').length
  const eligible =
    consecutivePassing >= policy.minimumSoakRuns &&
    distinctDays >= policy.minimumSoakDays &&
    unexplained <= policy.maximumUnexplainedFlakes
  soak[gate.id] = {
    totalRuns: entries.length,
    consecutivePassing,
    distinctDays,
    unexplained,
    promotionEligible: gate.maturity === 'blocking' ? true : eligible,
    needed: policy,
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: evidence.at,
  platform: { os: evidence.platform, arch: evidence.arch, release: evidence.osRelease, node: evidence.node },
  git: { head: evidence.head, dirty: evidence.dirty },
  summary: {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    unverifiable: results.filter((r) => r.status === 'unverifiable').length,
    blockingFailed: results.filter((r) => r.maturity === 'blocking' && r.status !== 'passed').length,
    verdict: results.some((r) => r.maturity === 'blocking' && r.status !== 'passed') ? 'BLOCKED' : 'GREEN',
  },
  gates: results.map((r) => ({ ...r, soak: soak[r.id] })),
  ledgerPath,
  ledgerRuns: history.length,
}

const reportJson = join(gateDir, 'report.json')
writeFileSync(reportJson, JSON.stringify(report, null, 2))

// ── Markdown report ─────────────────────────────────────────────────────────
// ASCII-only markers: emoji/box-drawing get mangled by some readers on Windows
// and add nothing that the status word does not already say.
const icon = (s) => (s === 'passed' ? '[PASS]' : s === 'failed' ? '[FAIL]' : '[UNVERIFIABLE]')
const lines = []
lines.push('# hip agent reliability gates')
lines.push('')
lines.push(`Generated: \`${report.generatedAt}\`  `)
lines.push(`Platform: \`${report.platform.os}/${report.platform.arch}\` Node \`${report.platform.node}\`  `)
lines.push(`Commit: \`${report.git.head}\`${report.git.dirty ? ' (dirty working tree)' : ''}  `)
lines.push(`Ledger runs recorded: **${report.ledgerRuns}**`)
lines.push('')
lines.push(`## Verdict: ${report.summary.verdict}`)
lines.push('')
lines.push(`| | count |`)
lines.push(`|---|---|`)
lines.push(`| gates | ${report.summary.total} |`)
lines.push(`| passed | ${report.summary.passed} |`)
lines.push(`| failed | ${report.summary.failed} |`)
lines.push(`| unverifiable | ${report.summary.unverifiable} |`)
lines.push(`| **blocking failures** | **${report.summary.blockingFailed}** |`)
lines.push('')
lines.push('Maturity ladder: `experimental` -> `soak` -> `blocking`.')
lines.push('Only `blocking` gates affect the verdict; `experimental`/`soak` failures are recorded as data, not alarm.')
lines.push('')

for (const g of report.gates) {
  lines.push(`### ${icon(g.status)} ${g.id}`)
  lines.push('')
  lines.push(`\`${g.maturity}\` | ${g.status} | ${g.durationSeconds}s`)
  lines.push('')
  lines.push(`**Invariant** - ${g.invariant}`)
  lines.push('')
  lines.push(`**Oracle** - ${g.oracle}`)
  lines.push('')
  const s = g.soak
  if (s) {
    lines.push(`Soak: ${s.consecutivePassing} consecutive passes over ${s.distinctDays} day(s) of ${s.totalRuns} run(s) — promotion eligible: **${s.promotionEligible ? 'yes' : 'no'}** (needs ${s.needed.minimumSoakRuns} runs / ${s.needed.minimumSoakDays} days).`)
    lines.push('')
  }
  if (g.assertionRefs.length) {
    lines.push('Backing assertions:')
    for (const ref of g.assertionRefs) {
      lines.push(`- \`${ref.file}\` - ${ref.assertions.map((a) => `\`${a}\``).join(', ')}`)
    }
    lines.push('')
  }
  if (g.knownGaps.length) {
    lines.push('Known gaps on this platform:')
    for (const gap of g.knownGaps) {
      lines.push(`- ${gap.reason} (tracking: ${gap.tracking})`)
    }
    lines.push('')
  }
  for (const c of g.commands) {
    lines.push(`<details><summary><code>${c.command}</code> → ${c.reason} (exit ${c.exitCode ?? 'n/a'}, ${(c.durationMs / 1000).toFixed(2)}s)</summary>`)
    lines.push('')
    if (c.detail) lines.push('```', String(c.detail).slice(-4000), '```')
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }
}

lines.push('---')
lines.push('')
lines.push('Method notes: a gate whose command cannot be executed is reported `unverifiable` and blocks - it is never')
lines.push('treated as a pass. Failures are recorded as data, so an `experimental` gate may legitimately stay red while')
lines.push('its known gap is being closed.')
lines.push('')

const reportMd = join(gateDir, 'report.md')
writeFileSync(reportMd, lines.join('\n'))

console.log('')
console.log(`Verdict: ${report.summary.verdict}  (${report.summary.passed}/${report.summary.total} passed, ${report.summary.unverifiable} unverifiable)`)
console.log(`Report:  ${reportMd}`)
console.log(`Ledger:  ${ledgerPath} (${report.ledgerRuns} runs)`)

process.exit(report.summary.blockingFailed > 0 ? 1 : 0)
