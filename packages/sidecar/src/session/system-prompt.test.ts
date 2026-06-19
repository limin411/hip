import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildSystemPrompt, childSystemPrompt, buildManagedAgentPrompt } from './system-prompt.js'

describe('buildSystemPrompt', () => {
  it('includes the cwd, the path convention, and the anti-phantom rule', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toContain('/tmp/proj')
    expect(s).toContain('write_file')
    expect(s).toContain('write_todos')
    expect(s).toMatch(/delegate it to/i)
    expect(s).toMatch(/MUST NOT claim/i)
  })

  it('gives the agent the hip identity and forbids impersonating other assistants', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toMatch(/you are hip/i)
    expect(s).toMatch(/never claim/i)
    expect(s).toMatch(/Claude/)
  })

  it('appends per-conversation user instructions when present', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', userInstructions: 'Always answer in French.' })
    expect(s).toContain('Always answer in French.')
  })

  it('omits the user-instructions section when blank', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', userInstructions: '   ' })
    expect(s).not.toMatch(/Additional instructions/i)
  })

  it('includes proactive-commit + branch guidance for the git tools', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toMatch(/git_commit/)
    expect(s).toMatch(/git_create_branch/)
    expect(s).toMatch(/git_switch_branch/)
    expect(s).toMatch(/proactively|after a coherent unit/i)
  })

  it('orders git guidance after the cwd block and before the anti-phantom rule', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    const cwdIdx = s.indexOf('working directory')
    const gitIdx = s.indexOf('git_commit')
    const antiIdx = s.indexOf('MUST NOT claim')
    expect(cwdIdx).toBeGreaterThanOrEqual(0)
    expect(gitIdx).toBeGreaterThan(cwdIdx)
    expect(antiIdx).toBeGreaterThan(gitIdx)
  })
})

describe('childSystemPrompt', () => {
  it('carries the hip identity into delegated sub-agents', () => {
    const s = childSystemPrompt('refactor the parser', '/tmp/proj')
    expect(s).toMatch(/you are hip/i)
    expect(s).toMatch(/never claim/i)
    expect(s).toContain('refactor the parser')
  })
})

describe('buildManagedAgentPrompt', () => {
  it('embeds the persona, the cwd, and the granted tool names', () => {
    const p = buildManagedAgentPrompt({
      cwd: '/proj',
      persona: 'You are a meticulous code reviewer.',
      toolNames: ['read_file', 'grep'],
    })
    expect(p).toContain('You are a meticulous code reviewer.')
    expect(p).toContain('/proj')
    expect(p).toContain('read_file')
    expect(p).toContain('grep')
  })
  it('omits git guidance when no git tool is granted', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'] })
    expect(p).not.toContain('git_commit')
  })
  it('includes git guidance when a git tool is granted', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file', 'git_commit'] })
    expect(p).toContain('git_commit')
  })
  it('forbids claiming a non-hip identity', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: [] })
    expect(p).toContain('hip')
  })
})

describe('buildSystemPrompt skills block', () => {
  const skills = [
    { id: 'fmt', name: 'formatter', description: 'Format code', dir: '/s/fmt', hasScripts: true },
    { id: 'lint', name: 'linter', description: 'Lint code', dir: '/s/lint', hasScripts: false },
  ]

  it('omits the skills section when no skills are given', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).not.toMatch(/^## Skills$/m)
  })

  it('lists enabled skill names and descriptions and mentions use_skill', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills })
    expect(s).toMatch(/^## Skills$/m)
    expect(s).toContain('formatter')
    expect(s).toContain('Format code')
    expect(s).toContain('linter')
    expect(s).toMatch(/use_skill/)
  })

  it('omits the skills section when skills is an empty array', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: [] })
    expect(s).not.toMatch(/^## Skills$/m)
  })

  it('auto-invoke instruction tells model to call use_skill when task matches', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills })
    expect(s).toMatch(/When a user's task matches a skill's description, call use_skill/)
    expect(s).toMatch(/Only use skills listed below/)
  })
})

describe('skillsBlock autoInvoke filtering', () => {
  const skills = [
    { id: 'a', name: 'alpha', description: 'Alpha skill', dir: '/s/a', hasScripts: false, autoInvoke: true as const },
    { id: 'b', name: 'bravo', description: 'Bravo skill', dir: '/s/b', hasScripts: false, autoInvoke: false as const },
    { id: 'c', name: 'charlie', description: 'Charlie skill', dir: '/s/c', hasScripts: false },
  ]

  it('includes skills with autoInvoke=true', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: [skills[0]] })
    expect(s).toContain('alpha')
    expect(s).toContain('Alpha skill')
  })

  it('excludes skills with autoInvoke=false', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: [skills[1]] })
    expect(s).not.toMatch(/^## Skills$/m)
    expect(s).not.toContain('bravo')
  })

  it('includes skills where autoInvoke is undefined (default=true)', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: [skills[2]] })
    expect(s).toContain('charlie')
    expect(s).toContain('Charlie skill')
  })

  it('filters mixed: only autoInvoke !== false are listed', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills })
    expect(s).toContain('alpha')
    expect(s).toContain('charlie')
    expect(s).not.toContain('bravo')
  })

  it('omits entire skills section when ALL skills have autoInvoke=false', () => {
    const allOff = [
      { id: 'x', name: 'x', description: 'x', dir: '/s/x', hasScripts: false, autoInvoke: false as const },
      { id: 'y', name: 'y', description: 'y', dir: '/s/y', hasScripts: false, autoInvoke: false as const },
    ]
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: allOff })
    expect(s).not.toMatch(/^## Skills$/m)
  })
})

describe('buildManagedAgentPrompt skills block', () => {
  const skills = [{ id: 'fmt', name: 'formatter', description: 'Format code', dir: '/s/fmt', hasScripts: true }]

  it('injects the skills block when use_skill is in the granted tools', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill', 'read_file'], skills })
    expect(s).toMatch(/^## Skills$/m)
    expect(s).toContain('formatter')
  })

  it('omits the skills block when use_skill is not granted', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['read_file'], skills })
    expect(s).not.toMatch(/^## Skills$/m)
  })

  it('omits the skills block when no skills are provided even with use_skill granted', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill'] })
    expect(s).not.toMatch(/^## Skills$/m)
  })

  it('filters out autoInvoke=false skills in managed agent prompt', () => {
    const mixed = [
      { id: 'a', name: 'visible', description: 'Should appear', dir: '/s/a', hasScripts: false, autoInvoke: true as const },
      { id: 'b', name: 'hidden', description: 'Should NOT appear', dir: '/s/b', hasScripts: false, autoInvoke: false as const },
    ]
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill'], skills: mixed })
    expect(s).toContain('visible')
    expect(s).toContain('Should appear')
    expect(s).not.toContain('hidden')
    expect(s).not.toContain('Should NOT appear')
  })
})

describe('skillsBlock paths glob filtering', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hip-test-paths-'))
    writeFileSync(join(tmpDir, 'main.py'), '')
    writeFileSync(join(tmpDir, 'component.tsx'), '')
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  const pySkill = {
    id: 'py',
    name: 'python-helper',
    description: 'Python helper',
    dir: '/s/py',
    hasScripts: false,
    paths: ['**/*.py'],
  }
  const rsSkill = {
    id: 'rs',
    name: 'rust-helper',
    description: 'Rust helper',
    dir: '/s/rs',
    hasScripts: false,
    paths: ['**/*.rs'],
  }
  const multiSkill = {
    id: 'multi',
    name: 'multi-helper',
    description: 'Multi helper',
    dir: '/s/multi',
    hasScripts: false,
    paths: ['**/*.ts', '**/*.tsx'],
  }

  it('includes skill when cwd has matching files', () => {
    const s = buildSystemPrompt({ cwd: tmpDir, skills: [pySkill] })
    expect(s).toContain('python-helper')
    expect(s).toContain('Python helper')
  })

  it('excludes skill when cwd has no matching files', () => {
    const s = buildSystemPrompt({ cwd: tmpDir, skills: [rsSkill] })
    expect(s).not.toMatch(/^## Skills$/m)
    expect(s).not.toContain('rust-helper')
  })

  it('includes skill when cwd matches any of multiple patterns', () => {
    const s = buildSystemPrompt({ cwd: tmpDir, skills: [multiSkill] })
    expect(s).toContain('multi-helper')
  })

  it('excludes path-gated skill when no cwd files match any glob', () => {
    const skillsWithPath = [{ id: 'p', name: 'pathed', description: 'Has path', dir: '/s/p', hasScripts: false, paths: ['**/*.ts'] }]
    const s = buildSystemPrompt({ cwd: tmpDir, skills: skillsWithPath })
    expect(s).not.toContain('pathed')
  })

  it('mixes autoInvoke and paths: both filters apply', () => {
    const skills = [
      { id: 'a', name: 'alpha', description: 'Alpha', dir: '/s/a', hasScripts: false, autoInvoke: true as const, paths: ['**/*.py'] },
      { id: 'b', name: 'bravo', description: 'Bravo', dir: '/s/b', hasScripts: false, autoInvoke: false as const, paths: ['**/*.py'] },
      { id: 'c', name: 'charlie', description: 'Charlie', dir: '/s/c', hasScripts: false, paths: ['**/*.rs'] },
    ]
    const s = buildSystemPrompt({ cwd: tmpDir, skills })
    expect(s).toContain('alpha')
    expect(s).not.toContain('bravo')
    expect(s).not.toContain('charlie')
  })
})

describe('buildSystemPrompt permissionMode-aware cwd block', () => {
  it("edit mode (default) keeps the sandboxed-to-root wording", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', permissionMode: 'edit' })
    expect(s).toMatch(/sandboxed to it/i)
  })
  it("default (no permissionMode) keeps the sandboxed-to-root wording", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toMatch(/sandboxed to it/i)
  })
  it("chat mode says the agent is read-only and cannot write or run scripts", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', permissionMode: 'chat' })
    expect(s).toMatch(/read-only/i)
    expect(s).toMatch(/cannot write/i)
  })
  it("full mode says filesystem tools are NOT sandboxed and may read/write any directory", () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', permissionMode: 'full' })
    expect(s).toMatch(/not sandboxed/i)
    expect(s).toMatch(/any directory/i)
  })
})

describe('buildManagedAgentPrompt permissionMode-aware cwd block', () => {
  it("threads chat mode into the managed-agent cwd block (read-only)", () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'], permissionMode: 'chat' })
    expect(p).toMatch(/read-only/i)
  })
  it("threads full mode into the managed-agent cwd block (not sandboxed)", () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'], permissionMode: 'full' })
    expect(p).toMatch(/not sandboxed/i)
  })
})
