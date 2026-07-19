#!/usr/bin/env node
/**
 * Offline dogfood / policy harness for product + ops progressive disclosure.
 *
 * Checks (no paid LLM required):
 * 1. yarn product:content:check (product + ops SoT embeds fresh)
 * 2. Always-on system prompt contains critical coding/product rules
 * 3. Built-in skills hip + hip-coding materialize and appear in L1 skills block
 * 4. Product Q matrix: each question class maps to expected skill / always-on cue
 * 5. Parallel-fanout always-on cues present without loading hip-coding body
 *
 * Optional live mode (not implemented as paid calls here): set DOGFOOD_LIVE=1 later.
 *
 * Usage:
 *   yarn prompt:dogfood
 *   node --import tsx scripts/product-prompt-dogfood.mjs
 *
 * Exit 0 on all pass; 1 on any failure. JSON summary on stdout last line if --json.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const wantJson = process.argv.includes('--json')

const results = []
function pass(id, detail = '') {
  results.push({ id, ok: true, detail })
}
function fail(id, detail) {
  results.push({ id, ok: false, detail })
}

function runCheck(id, fn) {
  try {
    fn()
    pass(id)
  } catch (e) {
    fail(id, e instanceof Error ? e.message : String(e))
  }
}

// ── 1. SoT embeds ──────────────────────────────────────────────────────────
runCheck('sot.product+ops.fresh', () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/generate-product-content.mjs'), '--check'], {
    cwd: ROOT,
    stdio: 'pipe',
  })
  execFileSync(process.execPath, [join(ROOT, 'scripts/generate-ops-content.mjs'), '--check'], {
    cwd: ROOT,
    stdio: 'pipe',
  })
})

// ── 2–5. Import sidecar modules via tsx dynamic path ───────────────────────
const dataDir = mkdtempSync(join(tmpdir(), 'hip-prompt-dogfood-'))
process.env.HIP_DATA_DIR = dataDir

try {
  const { buildSystemPrompt, skillsBlock } = await import(
    join(ROOT, 'packages/sidecar/src/session/system-prompt.ts')
  )
  const { getBuiltinSkills } = await import(
    join(ROOT, 'packages/sidecar/src/session/product/builtin-skills.ts')
  )
  const { PRODUCT_HELP_GUIDANCE } = await import(
    join(ROOT, 'packages/sidecar/src/session/product/content.ts')
  )
  const { CODING_SKILL_MD } = await import(
    join(ROOT, 'packages/sidecar/src/session/ops/content.ts')
  )

  const skills = getBuiltinSkills()
  const ids = skills.map((s) => s.id).sort()

  runCheck('builtins.ids', () => {
    if (!ids.includes('hip') || !ids.includes('hip-coding')) {
      throw new Error(`expected hip + hip-coding, got ${ids.join(',')}`)
    }
  })

  const codeBare = buildSystemPrompt({ cwd: '/tmp/proj', surface: 'code' })
  const codeWithSkills = buildSystemPrompt({
    cwd: '/tmp/proj',
    surface: 'code',
    skills,
  })
  const chatWithSkills = buildSystemPrompt({
    cwd: '/tmp/proj',
    surface: 'chat',
    skills,
  })

  /** Always-on critical rules (must not require skill load). */
  const ALWAYS_ON = [
    { id: 'always.parallel', re: /task_batch/i, in: codeBare },
    { id: 'always.parallel.critical', re: /parallel fan-out|CRITICAL/i, in: codeBare },
    { id: 'always.simple.direct', re: /simple, single-step/i, in: codeBare },
    { id: 'always.edit_file', re: /Prefer edit_file|edit_file/i, in: codeBare },
    { id: 'always.anti_phantom', re: /MUST NOT claim/i, in: codeBare },
    { id: 'always.git', re: /git_commit/i, in: codeBare },
    { id: 'always.product.facts', re: /Product facts \(hip\)|auth\.json/i, in: codeBare },
    { id: 'always.pointer.coding', re: /hip-coding/i, in: codeBare },
  ]

  for (const c of ALWAYS_ON) {
    runCheck(c.id, () => {
      if (!c.re.test(c.in)) throw new Error(`missing ${c.re} in always-on prompt`)
    })
  }

  runCheck('always.no.long.batch.elaboration', () => {
    if (/same tool-call batch/.test(codeBare)) {
      throw new Error('long dispatch_agent batch elaboration leaked into always-on BASE')
    }
  })

  runCheck('skills.l1.lists.both', () => {
    const block = skillsBlock(skills, '/tmp/proj')
    if (!block.includes('hip') || !block.includes('hip-coding')) {
      throw new Error(`L1 skills block missing builtins:\n${block}`)
    }
  })

  runCheck('skills.guidance.when.hip.present', () => {
    if (!codeWithSkills.includes('use_skill({ name: "hip" })')) {
      throw new Error('product help guidance missing when hip skill listed')
    }
    if (!PRODUCT_HELP_GUIDANCE.includes('use_skill')) {
      throw new Error('PRODUCT_HELP_GUIDANCE broken')
    }
  })

  runCheck('skills.coding.body.has.parallel.depth', () => {
    if (!/task_batch/.test(CODING_SKILL_MD) || !/research source of truth/.test(CODING_SKILL_MD)) {
      throw new Error('hip-coding skill body missing deep parallel policy')
    }
  })

  runCheck('chat.shorter.than.code', () => {
    if (chatWithSkills.length >= codeWithSkills.length) {
      throw new Error(`chat ${chatWithSkills.length} >= code ${codeWithSkills.length}`)
    }
  })

  /**
   * Product Q matrix: offline classification of what the prompt *enables*.
   * Score = fraction of cases where the expected always-on cue or skill is available.
   */
  const PRODUCT_Q = [
    {
      q: 'What is hip?',
      expectAlways: [/you are hip/i, /Product facts/i],
      expectSkill: 'hip',
    },
    {
      q: 'Where are API keys stored?',
      expectAlways: [/auth\.json/],
      expectSkill: 'hip',
    },
    {
      q: 'How do I enable memory?',
      expectAlways: [/Memory|memory/i],
      expectSkill: 'hip',
    },
    {
      q: 'Check module A and B in parallel',
      expectAlways: [/task_batch/i, /parallel/i],
      expectSkill: 'hip-coding',
    },
    {
      q: 'How should I commit?',
      expectAlways: [/git_commit/],
      expectSkill: 'hip-coding',
    },
  ]

  let qPass = 0
  for (const row of PRODUCT_Q) {
    const alwaysOk = row.expectAlways.every((re) => re.test(codeWithSkills))
    const skillOk = skills.some((s) => s.id === row.expectSkill || s.name === row.expectSkill)
    const ok = alwaysOk && skillOk
    if (ok) qPass++
    results.push({
      id: `matrix.${row.expectSkill}.${row.q.slice(0, 24)}`,
      ok,
      detail: ok ? '' : `always=${alwaysOk} skill=${skillOk}`,
    })
  }
  const hitRate = PRODUCT_Q.length ? qPass / PRODUCT_Q.length : 0
  runCheck('matrix.hit_rate_100', () => {
    if (hitRate < 1) throw new Error(`product matrix hit rate ${hitRate} < 1`)
  })

  // size budget soft check
  runCheck('size.code_bare_under_4k', () => {
    if (codeBare.length > 4200) {
      throw new Error(`code bare prompt ${codeBare.length} chars exceeds 4200 soft budget`)
    }
  })

  const summary = {
    ok: results.every((r) => r.ok),
    hitRate,
    codeBareChars: codeBare.length,
    codeWithSkillsChars: codeWithSkills.length,
    builtinSkills: ids,
    results,
  }

  if (!wantJson) {
    for (const r of results) {
      const mark = r.ok ? 'PASS' : 'FAIL'
      console.error(`${mark}  ${r.id}${r.detail ? ` — ${r.detail}` : ''}`)
    }
    console.error(
      `\nsummary: ok=${summary.ok} hitRate=${hitRate} codeBare=${codeBare.length} withSkills=${codeWithSkills.length}`,
    )
  }
  // Always one-line JSON on stdout (tests parse the last non-empty line).
  console.log(JSON.stringify(summary))

  rmSync(dataDir, { recursive: true, force: true })
  process.exit(summary.ok ? 0 : 1)
} catch (e) {
  rmSync(dataDir, { recursive: true, force: true })
  console.error(e)
  process.exit(1)
}
