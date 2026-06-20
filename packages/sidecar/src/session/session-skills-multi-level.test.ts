import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'

let root: string
let globalSkillsDir: string
let projectSkillsDir: string
let cwd: string
const prevEnv: Record<string, string | undefined> = {}
function setEnv(k: string, v: string) { prevEnv[k] = process.env[k]; process.env[k] = v }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-sess-mlvl-'))

  // Global skills dir
  globalSkillsDir = join(root, 'global-skills')
  mkdirSync(globalSkillsDir, { recursive: true })

  // Global skill: formatter (will be overridden by project)
  const fmtDir = join(globalSkillsDir, 'formatter')
  mkdirSync(fmtDir, { recursive: true })
  writeFileSync(join(fmtDir, 'SKILL.md'), '---\nname: Global Formatter\ndescription: Format code (global)\n---\nGlobal version', 'utf8')

  // Global skill: linter (no project override)
  const lintDir = join(globalSkillsDir, 'linter')
  mkdirSync(lintDir, { recursive: true })
  writeFileSync(join(lintDir, 'SKILL.md'), '---\nname: Global Linter\ndescription: Lint code (global)\n---\nLinter global', 'utf8')

  // Project root with .hip/skills/
  cwd = join(root, 'project')
  mkdirSync(cwd, { recursive: true })
  projectSkillsDir = join(cwd, '.hip', 'skills')
  mkdirSync(projectSkillsDir, { recursive: true })

  // Project skill: formatter (overrides global with same id)
  const projFmtDir = join(projectSkillsDir, 'formatter')
  mkdirSync(projFmtDir, { recursive: true })
  writeFileSync(join(projFmtDir, 'SKILL.md'), '---\nname: Project Formatter\ndescription: Format code (project)\n---\nProject version', 'utf8')

  // Project-only skill: deployer
  const deployDir = join(projectSkillsDir, 'deployer')
  mkdirSync(deployDir, { recursive: true })
  writeFileSync(join(deployDir, 'SKILL.md'), '---\nname: Deployer\ndescription: Deploy project\n---\nDeploy skill', 'utf8')

  // Empty config files
  const skillsCfg = join(root, 'skills.json')
  writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
  const mcpPath = join(root, 'mcp.json')
  writeFileSync(mcpPath, JSON.stringify({ servers: [] }), 'utf8')

  setEnv('HIP_SKILLS_DIR', globalSkillsDir)
  setEnv('HIP_SKILLS_PATH', skillsCfg)
  setEnv('HIP_MCP_SERVERS_PATH', mcpPath)
  setEnv('HIP_AGENTS_PATH', '')
})
afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(root, { recursive: true, force: true })
})

/** A runner that captures the system prompt and returns text. */
class SystemPromptCapturingRunner implements ModelRunner {
  systemSeen = ''
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.systemSeen = String(messages[0]?.content ?? '')
    opts.onText('done')
    return new AIMessage('done')
  }
}

describe('Multi-level skills: project overrides global, scope tags', () => {
  it('project skill overrides global with same id — project description wins', async () => {
    const runner = new SystemPromptCapturingRunner()
    const session = new Session('s1', { llmProvider: 'deepseek', model: '', tools: [], cwd } as any, undefined, undefined, undefined, 60_000, runner)
    await session.sendMessage('hello', () => {}, 'u1')

    // Project version of formatter should appear, not global
    expect(runner.systemSeen).toContain('Project Formatter')
    expect(runner.systemSeen).not.toContain('Global Formatter')
    expect(runner.systemSeen).toContain('Format code (project)')
    expect(runner.systemSeen).not.toContain('Format code (global)')
    // Project name appears with (project) scope tag
    expect(runner.systemSeen).toMatch(/Project Formatter\s*\(project\)/)
  }, 30_000)

  it('global-only skill appears without project override', async () => {
    const runner = new SystemPromptCapturingRunner()
    const session = new Session('s2', { llmProvider: 'deepseek', model: '', tools: [], cwd } as any, undefined, undefined, undefined, 60_000, runner)
    await session.sendMessage('hello', () => {}, 'u2')

    // Linter is global-only, no scope tag
    expect(runner.systemSeen).toContain('Global Linter')
    expect(runner.systemSeen).toContain('Lint code (global)')
    // No (project) tag on the linter line (it's global)
    expect(runner.systemSeen).not.toMatch(/Linter\s*\(project\)/)
  }, 30_000)

  it('project-only skill appears with (project) scope tag', async () => {
    const runner = new SystemPromptCapturingRunner()
    const session = new Session('s3', { llmProvider: 'deepseek', model: '', tools: [], cwd } as any, undefined, undefined, undefined, 60_000, runner)
    await session.sendMessage('hello', () => {}, 'u3')

    expect(runner.systemSeen).toContain('Deployer')
    expect(runner.systemSeen).toContain('Deploy project')
    expect(runner.systemSeen).toMatch(/Deployer\s*\(project\)/)
  }, 30_000)

  it('without cwd, only global skills are loaded (backward compat)', async () => {
    const runner = new SystemPromptCapturingRunner()
    const session = new Session('s4', { llmProvider: 'deepseek', model: '', tools: [], cwd: '' } as any, undefined, undefined, undefined, 60_000, runner)
    await session.sendMessage('hello', () => {}, 'u4')

    // Only global skills should appear
    expect(runner.systemSeen).toContain('Global Formatter')
    expect(runner.systemSeen).toContain('Format code (global)')
    expect(runner.systemSeen).toContain('Global Linter')
    // No project skills
    expect(runner.systemSeen).not.toContain('Deployer')
    expect(runner.systemSeen).not.toContain('(project)')
  }, 30_000)
})
