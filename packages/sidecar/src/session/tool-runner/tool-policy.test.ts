import { describe, it, expect } from 'vitest'
import { defaultToolPolicy } from './tool-policy.js'
import type { ToolPolicy } from './tool-policy.js'
import { SELF_GATED_TOOLS } from '../tools.js'

function makePolicy(selfGated: Set<string> = new Set<string>()): ToolPolicy {
  return defaultToolPolicy({ selfGatedTools: selfGated })
}

describe('defaultToolPolicy', () => {
  describe('read tools', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)
    const readTools = ['read_file', 'ls', 'glob', 'grep', 'use_skill', 'web_search', 'web_fetch']

    for (const toolName of readTools) {
      it(`classifies ${toolName} as low risk, approval none in edit mode`, () => {
        const c = policy.classify(toolName, 'edit')
        expect(c).toEqual({ risk: 'low', approval: 'none' })
      })

      it(`classifies ${toolName} as low risk, approval none in full mode`, () => {
        const c = policy.classify(toolName, 'full')
        expect(c).toEqual({ risk: 'low', approval: 'none' })
      })

      it(`classifies ${toolName} as low risk, approval none in chat mode`, () => {
        const c = policy.classify(toolName, 'chat')
        expect(c).toEqual({ risk: 'low', approval: 'none' })
      })
    }
  })

  describe('write tools', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)
    const writeTools = ['write_file', 'edit_file']

    for (const toolName of writeTools) {
      it(`classifies ${toolName} as medium risk, approval none in edit mode`, () => {
        const c = policy.classify(toolName, 'edit')
        expect(c).toEqual({ risk: 'medium', approval: 'none' })
      })

      it(`classifies ${toolName} as medium risk, approval none in chat mode`, () => {
        const c = policy.classify(toolName, 'chat')
        expect(c).toEqual({ risk: 'medium', approval: 'none' })
      })
    }
  })

  describe('write_todos', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)

    it('classifies write_todos as low risk, approval none', () => {
      const c = policy.classify('write_todos', 'edit')
      expect(c).toEqual({ risk: 'low', approval: 'none' })
    })
  })

  describe('run_script (self-gated)', () => {
    it('classifies as high risk, approval self in edit mode', () => {
      const policy = makePolicy(SELF_GATED_TOOLS)
      const c = policy.classify('run_script', 'edit')
      expect(c).toEqual({ risk: 'high', approval: 'self' })
    })

    it('classifies as high risk, approval auto_allow in full mode', () => {
      const policy = makePolicy(SELF_GATED_TOOLS)
      const c = policy.classify('run_script', 'full')
      expect(c).toEqual({ risk: 'high', approval: 'auto_allow' })
    })

    it('classifies as high risk, approval self in chat mode (notionally)', () => {
      const policy = makePolicy(SELF_GATED_TOOLS)
      const c = policy.classify('run_script', 'chat')
      expect(c).toEqual({ risk: 'high', approval: 'self' })
    })

    it('falls back to medium risk when not in selfGatedTools', () => {
      const policy = makePolicy()
      const c = policy.classify('run_script', 'edit')
      expect(c).toEqual({ risk: 'medium', approval: 'none' })
    })
  })

  describe('task and dispatch_agent (delegate)', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)

    it('classifies task as medium risk, approval none', () => {
      const c = policy.classify('task', 'edit')
      expect(c).toEqual({ risk: 'medium', approval: 'none' })
    })

    it('classifies dispatch_agent as medium risk, approval none', () => {
      const c = policy.classify('dispatch_agent', 'edit')
      expect(c).toEqual({ risk: 'medium', approval: 'none' })
    })
  })

  describe('mcp tools', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)

    it('classifies mcp__server__tool as medium risk, approval ask in edit mode', () => {
      const c = policy.classify('mcp__github__search_repos', 'edit')
      expect(c).toEqual({ risk: 'medium', approval: 'ask' })
    })

    it('classifies mcp__server__tool as medium risk, approval ask in chat mode', () => {
      const c = policy.classify('mcp__github__search_repos', 'chat')
      expect(c).toEqual({ risk: 'medium', approval: 'ask' })
    })

    it('classifies mcp__another__get_data as medium risk, approval auto_allow in full mode', () => {
      const c = policy.classify('mcp__another__get_data', 'full')
      expect(c).toEqual({ risk: 'medium', approval: 'auto_allow' })
    })
  })

  describe('git tools', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)
    const gitTools = [
      'git_commit',
      'git_create_branch',
      'git_switch_branch',
      'git_worktree_create',
      'git_worktree_list',
      'git_worktree_remove',
    ]

    for (const toolName of gitTools) {
      it(`classifies ${toolName} as medium risk, approval none`, () => {
        const c = policy.classify(toolName, 'edit')
        expect(c).toEqual({ risk: 'medium', approval: 'none' })
      })
    }
  })

  describe('generate_agent', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)

    it('classifies generate_agent as medium risk, approval none', () => {
      const c = policy.classify('generate_agent', 'edit')
      expect(c).toEqual({ risk: 'medium', approval: 'none' })
    })
  })

  describe('mode variations', () => {
    it('classifies write_file the same across chat and edit modes', () => {
      const policy = makePolicy(SELF_GATED_TOOLS)
      expect(policy.classify('write_file', 'chat')).toEqual(policy.classify('write_file', 'edit'))
    })

    it('classifies read_file identically across all three modes', () => {
      const policy = makePolicy(SELF_GATED_TOOLS)
      const chat = policy.classify('read_file', 'chat')
      const edit = policy.classify('read_file', 'edit')
      const full = policy.classify('read_file', 'full')
      expect(chat).toEqual(edit)
      expect(edit).toEqual(full)
    })

    it('only run_script changes classification by mode', () => {
      const policy = makePolicy(SELF_GATED_TOOLS)
      const edit = policy.classify('run_script', 'edit')
      const full = policy.classify('run_script', 'full')
      expect(edit.approval).toBe('self')
      expect(full.approval).toBe('auto_allow')
      expect(edit.risk).toBe('high')
      expect(full.risk).toBe('high')
    })
  })

  describe('unknown tools', () => {
    const policy = makePolicy(SELF_GATED_TOOLS)

    it('classifies unknown tool as medium risk, approval ask in edit mode', () => {
      const c = policy.classify('some_unknown_tool', 'edit')
      expect(c).toEqual({ risk: 'medium', approval: 'ask' })
    })

    it('classifies unknown tool as medium risk, approval none in full mode', () => {
      const c = policy.classify('some_unknown_tool', 'full')
      expect(c).toEqual({ risk: 'medium', approval: 'none' })
    })
  })

  describe('custom selfGatedTools', () => {
    it('classifies a custom self-gated tool as high risk, approval self in edit mode', () => {
      const custom = new Set(['custom_script'])
      const policy = makePolicy(custom)
      const c = policy.classify('custom_script', 'edit')
      expect(c).toEqual({ risk: 'high', approval: 'self' })
    })

    it('classifies a custom self-gated tool as high risk, approval auto_allow in full mode', () => {
      const custom = new Set(['custom_script'])
      const policy = makePolicy(custom)
      const c = policy.classify('custom_script', 'full')
      expect(c).toEqual({ risk: 'high', approval: 'auto_allow' })
    })
  })
})
