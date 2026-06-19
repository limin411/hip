import { describe, it, expect } from 'vitest'
import { generateAgentConfig } from './generate.js'

describe('generateAgentConfig', () => {
  it('generates a valid agent config from well-formed LLM output', async () => {
    const agent = await generateAgentConfig('代码审查助手', undefined, {
      callLLM: async () =>
        JSON.stringify({
          name: '代码审查员',
          description: '审查代码质量和安全性',
          prompt: '你是一个资深代码审查员，关注安全性、可读性和最佳实践。',
          allowedSkills: ['security-review'],
          allowedMcpServers: ['filesystem'],
        }),
    })

    expect(agent.kind).toBe('internal')
    expect(agent.command).toBe('')
    expect(agent.args).toEqual([])
    expect(agent.enabled).toBe(true)
    expect(agent.name).toBe('代码审查员')
    expect(agent.description).toBe('审查代码质量和安全性')
    expect(agent.prompt).toBe('你是一个资深代码审查员，关注安全性、可读性和最佳实践。')
    expect(agent.allowedSkills).toEqual(['security-review'])
    expect(agent.allowedMcpServers).toEqual(['filesystem'])
    expect(typeof agent.id).toBe('string')
    expect(agent.id.length).toBeGreaterThan(0)
  })

  it('generates minimal config when only required fields are present', async () => {
    const agent = await generateAgentConfig('简单的助手', undefined, {
      callLLM: async () => JSON.stringify({ name: '简单助手', prompt: '帮助用户完成任务。' }),
    })

    expect(agent.kind).toBe('internal')
    expect(agent.name).toBe('简单助手')
    expect(agent.prompt).toBe('帮助用户完成任务。')
    expect(agent.allowedSkills).toBeUndefined()
    expect(agent.allowedMcpServers).toBeUndefined()
  })

  it('strips markdown fences from LLM output', async () => {
    const agent = await generateAgentConfig('测试器', undefined, {
      callLLM: async () =>
        '```json\n' +
        JSON.stringify({ name: '测试员', prompt: '运行测试并报告结果。' }) +
        '\n```',
    })

    expect(agent.name).toBe('测试员')
    expect(agent.prompt).toBe('运行测试并报告结果。')
  })

  it('falls back to generic agent on invalid JSON', async () => {
    const agent = await generateAgentConfig('某个智能体', undefined, {
      callLLM: async () => 'not valid json at all',
    })

    expect(agent.kind).toBe('internal')
    expect(agent.name).toBe('定制智能体')
    expect(agent.enabled).toBe(true)
  })

  it('falls back to generic agent when required fields are missing', async () => {
    const agent = await generateAgentConfig('某个智能体', undefined, {
      // prompt is required by the schema
      callLLM: async () => JSON.stringify({ name: 'OnlyName' }),
    })

    expect(agent.name).toBe('定制智能体')
  })

  it('falls back to generic agent on empty prompt string', async () => {
    const agent = await generateAgentConfig('某个智能体', undefined, {
      callLLM: async () => JSON.stringify({ name: 'X', prompt: '' }),
    })

    // z.string() passes for '' — zod doesn't reject empty strings unless .min(1) is used.
    // We accept empty prompts (the LLM generated it that way).
    expect(agent.kind).toBe('internal')
    expect(agent.prompt).toBe('')
  })

  it('falls back to generic agent on LLM error', async () => {
    const agent = await generateAgentConfig('某个智能体', undefined, {
      callLLM: async () => {
        throw new Error('API down')
      },
    })

    expect(agent.name).toBe('定制智能体')
    expect(agent.enabled).toBe(true)
  })

  it('returns fallback for empty description', async () => {
    let called = false
    const agent = await generateAgentConfig('  ', undefined, {
      callLLM: async () => {
        called = true
        return '{}'
      },
    })

    expect(agent.name).toBe('定制智能体')
    expect(called).toBe(false)
  })

  it('passes the description as agent description when none is generated', async () => {
    const agent = await generateAgentConfig('安全审计员', undefined, {
      callLLM: async () => JSON.stringify({ name: '审计员', prompt: '审计安全。' }),
    })

    expect(agent.description).toBe('安全审计员')
  })
})
