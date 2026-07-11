import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { Summarizer } from './compaction.js'
import { KEEP_RECENT_TURNS } from './compaction.js'

const fakeSummarizer: Summarizer = {
  async summarize() { return '早期对话摘要' },
}

function getMessages(session: Session): BaseMessage[] {
  return (session as unknown as { messages: BaseMessage[] }).messages
}

function seedLongHistory(session: Session): void {
  const msgs = getMessages(session)
  msgs.push(
    new SystemMessage({ id: 'sys', content: 'you are hip' }),
    new HumanMessage({ id: 'u1', content: 'goal' }),
    new AIMessage({ id: 'a1', content: 'r1' }),
    new HumanMessage({ id: 'u2', content: 'q2' }),
    new AIMessage({ id: 'a2', content: 'r2' }),
    new HumanMessage({ id: 'u3', content: 'q3' }),
    new AIMessage({ id: 'a3', content: 'r3' }),
    new HumanMessage({ id: 'u4', content: 'q4' }),
    new AIMessage({ id: 'a4', content: 'r4' }),
    new HumanMessage({ id: 'u5', content: 'q5' }),
    new AIMessage({ id: 'a5', content: 'r5' }),
  )
}

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-compact-now-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('Session.compactNow', () => {
  it('returns nothing_to_compact when history is too short', async () => {
    const session = new Session(
      's-short',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeSummarizer,
    )
    getMessages(session).push(
      new HumanMessage({ id: 'u1', content: 'hi' }),
      new AIMessage({ id: 'a1', content: 'hello' }),
    )
    const result = await session.compactNow()
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('nothing_to_compact')
    expect(result.messagesBefore).toBe(result.messagesAfter)
  })

  it('applies summary in place (not at end) when history is long enough', async () => {
    const session = new Session(
      's-long',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeSummarizer,
    )
    seedLongHistory(session)
    const before = getMessages(session).length
    expect(before).toBeGreaterThan(KEEP_RECENT_TURNS * 2)

    const result = await session.compactNow()
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(true)
    expect(result.messagesAfter).toBeLessThan(result.messagesBefore)

    const msgs = getMessages(session)
    const texts = msgs.map((m) => (typeof m.content === 'string' ? m.content : ''))
    expect(texts.some((t) => t.includes('早期对话摘要'))).toBe(true)
    // Summary is not the last message — recent turns trail it
    expect(texts[texts.length - 1]).not.toContain('早期对话摘要')
    expect(texts[texts.length - 1]).toContain('r5')
    // Middle verbatim reply is gone
    expect(texts.some((t) => t === 'r2')).toBe(false)
  })

  it('refuses while a turn is running', async () => {
    const session = new Session(
      's-busy',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fakeSummarizer,
    )
    seedLongHistory(session)
    session.running = true
    const result = await session.compactNow()
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('session_busy')
  })
})
