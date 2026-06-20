import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type AIMessage as AIMsg } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import { AgentProfileManager } from './agent-profile-manager.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { SkillMeta } from '@hip/protocol'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-plan-profile-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('plan profile', () => {
  it('AgentProfileManager plan profile has the expected allowed tools', () => {
    const mgr = new AgentProfileManager()
    mgr.setActiveProfile('plan')
    const profile = mgr.getActiveProfile()
    expect(profile.id).toBe('plan')
    expect(profile.mode).toBe('primary')
    expect(profile.allowedTools).toEqual([
      'read_file',
      'ls',
      'glob',
      'grep',
      'write_todos',
      'use_skill',
      'web_search',
      'web_fetch',
    ])
    expect(profile.blockedTools).toBeUndefined()
  })

  it('buildTools with plan profile allows write_todos but not write_file', () => {
    const mgr = new AgentProfileManager()
    mgr.setActiveProfile('plan')
    const profile = mgr.getActiveProfile()

    // Provide a dummy skill dir so use_skill tool is built (filtered by allowedTools after build)
    const skillDir = mkdtempSync(join(tmpdir(), 'hip-plan-skill-'))
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Test skill\nDummy skill body.')
    const dummySkill: SkillMeta = { id: 'test-skill', name: 'test-skill', description: 'A test skill', dir: skillDir, hasScripts: false }
    try {
      const tools = buildTools('/tmp', undefined, '/tmp', undefined, {
        permissionMode: 'edit',
        allowedTools: profile.allowedTools,
        blockedTools: profile.blockedTools,
        skills: [dummySkill],
        webSearchEnabled: true,
      })
      const names = tools.map((t) => t.name)
      expect(names).toContain('write_todos')
      expect(names).not.toContain('write_file')
      expect(names).not.toContain('edit_file')
      expect(names).not.toContain('git_commit')
      expect(names).not.toContain('run_script')
      expect(names).not.toContain('task')
      expect(names).not.toContain('dispatch_agent')
      expect(names).toContain('read_file')
      expect(names).toContain('ls')
      expect(names).toContain('glob')
      expect(names).toContain('grep')
      expect(names).toContain('use_skill')
      expect(names).toContain('web_search')
      expect(names).toContain('web_fetch')
    } finally {
      rmSync(skillDir, { recursive: true, force: true })
    }
  })

  it('routeAfterCompact routes to planner when planningMode is plan and plan not approved', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_todos', args: { todos: [{ content: 'step 1', status: 'pending' }] }, id: 'p1' }] }),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('plan a project')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'none',
        },
        {
          configurable: {
            ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, activeProfileId: 'plan' },
          },
        },
      )
      expect(out.status).toBe('awaiting_user')
      expect(out.planningMode).toBe('plan')
      expect(out.planStatus).toBe('ready')
      expect(out.plan).toEqual([{ content: 'step 1', status: 'pending' }])
    })
  })

  it('routeAfterCompact routes directly to agent when activeProfileId is plan but plan already approved', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('executing the plan')])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('do it')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step 1', status: 'pending' }],
        },
        {
          configurable: {
            ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, activeProfileId: 'plan' },
          },
          recursionLimit: 20,
        },
      )
      // Plan already approved, so route directly to agent (skip planner)
      expect(out.status).toBe('running')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('executing the plan')
    })
  })

  it('routeAfterCompact routes to agent when activeProfileId is not plan but planningMode is plan and approved', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('executing approved plan')])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('do it')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step 1', status: 'pending' }],
        },
        {
          configurable: {
            ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, activeProfileId: 'supervisor' },
          },
          recursionLimit: 20,
        },
      )
      // Supervisor profile with approved plan → agent
      expect(out.status).toBe('running')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('executing approved plan')
    })
  })

  it('routeAfterCompact routes to agent when activeProfileId is not plan and planningMode is fast', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('quick answer')])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hello')],
          steps: 0,
          planningMode: 'fast',
          planStatus: 'none',
        },
        {
          configurable: {
            ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, activeProfileId: 'supervisor' },
          },
        },
      )
      expect(out.status).toBe('running')
      expect(out.planningMode).toBe('fast')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('quick answer')
    })
  })
})
