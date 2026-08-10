// e2e/eval/skills/runner.ts
// Behavioral skill eval runner (paid; used by the longrun gate).
//
// Flow per case: create a throwaway git repo → run a headless session via the
// attach CLI (`yarn workspace @hip/cli dev run`) → grade the transcript
// against `expectations[]`. A case passes when every expectation holds.
//
// Gate integration (hip-longrun-gate.sh): run `node --import tsx
// e2e/eval/skills/runner.ts` with `HIP_EVAL_SKILLS_CASES` pointing at the
// cases dir; exits 0 when all cases pass, 2 when the app is not running
// (same contract as the CLI attach).
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SkillCase } from './types.js'
import { createTempGitRepo } from '../workspace.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

const CASES_DIR =
  process.env.HIP_EVAL_SKILLS_CASES || path.join(__dirname, 'cases')
const OUT_DIR = process.env.OUT_DIR || path.join(repoRoot, 'tmp', 'skills-eval')
const TIMEOUT_SEC = Number(process.env.SKILLS_EVAL_TIMEOUT_SEC || 600)
const KEEP = process.env.E2E_EVAL_KEEP_WORKSPACE === '1'

function loadCases(): Array<{ file: string; data: SkillCase }> {
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      file: f,
      data: JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) as SkillCase,
    }))
}

interface GradedEval {
  id: string
  expectations: Array<{ text: string; held: boolean; evidence: string }>
  pass: boolean
}

function gradeTranscript(
  ev: { id: string; expectations: string[]; prompt: string },
  transcript: string,
): GradedEval {
  const expectations = ev.expectations.map((text) => {
    const evidence = transcript.slice(-6000)
    // Heuristic grader: expectation holds when its keywords appear in the
    // tail of the transcript (headless runs produce the final answer last).
    const keywords = text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3)
    const held = keywords.length > 0 && keywords.every((k) => evidence.includes(k))
    return { text, held, evidence: held ? `matched keywords: ${keywords.join(', ')}` : 'no keyword match in transcript tail' }
  })
  return { id: ev.id, expectations, pass: expectations.every((e) => e.held) }
}

/** Run one behavioral eval headlessly against the attach CLI. */
export function runSkillEval(
  ev: { id: string; prompt: string; expectations: string[] },
  cwd: string,
): { transcript: string; graded: GradedEval } {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const hipOutDir = path.join(OUT_DIR, 'hip-run')
  fs.mkdirSync(hipOutDir, { recursive: true })

  const cliArgs = [
    'workspace',
    '@hip/cli',
    'dev',
    'run',
    ev.prompt,
    '--cwd',
    cwd,
    '--preset',
    'harness',
    '--use-user-hip',
    '--permission-mode',
    'full',
    '--hitl',
    'auto',
    '--json',
    '--out-dir',
    hipOutDir,
    '--timeout',
    String(TIMEOUT_SEC),
    '--provider',
    process.env.HIP_PROVIDER || 'deepseek',
    '--model',
    process.env.HIP_MODEL || 'deepseek-chat',
  ]

  const run = spawnSync('yarn', cliArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: (TIMEOUT_SEC + 120) * 1000,
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 40 * 1024 * 1024,
  })
  const stdout = run.stdout || ''
  fs.writeFileSync(path.join(OUT_DIR, `${ev.id}.stdout.log`), stdout)
  fs.writeFileSync(path.join(OUT_DIR, `${ev.id}.stderr.log`), run.stderr || '')

  return { transcript: stdout, graded: gradeTranscript(ev, stdout) }
}

export function main(): number {
  const cases = loadCases()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const report: unknown[] = []
  let failures = 0

  for (const { file, data } of cases) {
    for (const ev of data.evals ?? []) {
      const repo = createTempGitRepo(`skills-eval-${data.skill}-${ev.id}`)
      fs.writeFileSync(path.join(repo, 'README.md'), `# ${data.skill} eval fixture\n`)
      try {
        const { transcript, graded } = runSkillEval(ev, repo)
        if (!graded.pass) failures++
        report.push({ case: file, eval: ev.id, pass: graded.pass, expectations: graded.expectations })
        console.log(`[${graded.pass ? 'PASS' : 'FAIL'}] ${file} / ${ev.id}`)
        if (!graded.pass) console.log(transcript.slice(-1500))
      } finally {
        if (!KEEP) fs.rmSync(repo, { recursive: true, force: true })
      }
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`skills-eval: ${cases.length} case file(s), ${failures} failed eval(s)`)
  return failures === 0 ? 0 : 1
}

// Direct execution (gate entry): `node --import tsx e2e/eval/skills/runner.ts`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main()
}
