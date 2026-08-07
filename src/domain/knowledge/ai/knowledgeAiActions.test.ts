import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  packKnowledgeAiPrompt,
  knowledgeAiActions,
} from './knowledgeAiActions'

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    createSession: vi.fn(() => 'sess_ai_1'),
    sendMessageToSession: vi.fn(),
  },
}))

vi.mock('@/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain')>()
  return {
    ...actual,
    DEFAULT_CONFIG: {
      llmProvider: 'deepseek',
      model: 'm',
      tools: [],
      surface: 'chat',
    },
    useDomainStore: {
      getState: () => ({
        sessions: [],
        activeSessionId: null,
      }),
    },
  }
})

describe('knowledgeAiActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('packs title outline selection and backlinks', () => {
    const prompt = packKnowledgeAiPrompt('summarize', {
      title: 'Notes',
      outline: ['Intro', 'Body'],
      selection: 'hello world',
      backlinks: ['A', 'B', 'C', 'D'],
    })
    expect(prompt).toContain('Document title: Notes')
    expect(prompt).toContain('- Intro')
    expect(prompt).toContain('hello world')
    expect(prompt).toContain('- A')
    expect(prompt).not.toContain('- D')
  })

  it('run creates chat session and sends message', async () => {
    const { sessionService } = await import('@/domain/sessionService')
    const res = knowledgeAiActions.run({
      action: 'continue',
      docContext: {
        title: 'T',
        outline: [],
        selection: 'partial',
      },
    })
    expect(res.sessionId).toBe('sess_ai_1')
    expect(sessionService.createSession).toHaveBeenCalled()
    expect(sessionService.sendMessageToSession).toHaveBeenCalledWith(
      'sess_ai_1',
      expect.stringContaining('partial'),
    )
  })
})
