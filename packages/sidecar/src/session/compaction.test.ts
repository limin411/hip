import { describe, it, expect } from 'vitest'
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import { estimateTokens, compactMessages, type Summarizer } from './compaction.js'

const fakeSummarizer = (capture?: (m: BaseMessage[]) => void): Summarizer => ({
  async summarize(m) { capture?.(m); return '摘要内容' },
})

describe('estimateTokens', () => {
  it('counts chars / 3 across messages', () => {
    expect(estimateTokens([new HumanMessage('123456')])).toBe(2)
  })
})

describe('compactMessages', () => {
  const build = (): BaseMessage[] => [
    new SystemMessage({ id: 'sys', content: 'you are hip' }),
    new HumanMessage({ id: 'u1', content: '原始目标：做个网页' }),
    new AIMessage({ id: 'a1', content: '老的中间回复' }),
    new HumanMessage({ id: 'u2', content: '中间追问' }),
    new AIMessage({ id: 'a2', content: '中间回复' }),
    new HumanMessage({ id: 'u3', content: '最近的问题' }),
    new AIMessage({ id: 'a3', content: '最近的回复' }),
  ]

  it('pins system + first user + recent K turns and summarizes the middle', async () => {
    let seen: BaseMessage[] = []
    const result = await compactMessages(build(), { keepRecentTurns: 1, summarizer: fakeSummarizer((m) => { seen = m }) })
    expect(result).not.toBeNull()
    expect(seen.map((m) => m.id)).toEqual(['a1', 'u2', 'a2'])
    expect(result!.summary.id).toBe('a1')
    expect(typeof result!.summary.content === 'string' ? result!.summary.content : '').toContain('[对话摘要]')
    expect(result!.removeIds).toEqual(['u2', 'a2'])
  })

  it('returns null when there is no middle (too few turns)', async () => {
    const few: BaseMessage[] = [
      new SystemMessage({ id: 'sys', content: 's' }),
      new HumanMessage({ id: 'u1', content: 'goal' }),
      new AIMessage({ id: 'a1', content: 'reply' }),
    ]
    expect(await compactMessages(few, { keepRecentTurns: 3, summarizer: fakeSummarizer() })).toBeNull()
  })
})
