import { describe, it, expect } from 'vitest'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import {
  resolveWorkflowDefForTurn,
  extractLastUserText,
} from './session-turn-runner.js'
import type { WorkflowDef } from '@hip/protocol'

const customDef: WorkflowDef = {
  id: 'custom',
  name: 'Custom',
  entry: ['n1'],
  nodes: [{ type: 'agent', id: 'n1', agentId: 'worker', inputTemplate: '{{input}}' }],
  edges: [],
}

describe('resolveWorkflowDefForTurn', () => {
  it('ignores orchMode and returns null when no pending def (no forced cluster-default)', () => {
    expect(resolveWorkflowDefForTurn({ orchMode: 'fast', pendingWorkflowDef: null })).toBeNull()
    expect(resolveWorkflowDefForTurn({ orchMode: 'dag', pendingWorkflowDef: null })).toBeNull()
  })

  it('returns explicit pendingWorkflowDef regardless of orchMode', () => {
    expect(resolveWorkflowDefForTurn({ orchMode: 'fast', pendingWorkflowDef: customDef })).toBe(customDef)
    expect(resolveWorkflowDefForTurn({ orchMode: 'dag', pendingWorkflowDef: customDef })).toBe(customDef)
  })
})

describe('extractLastUserText', () => {
  it('returns empty string when there is no human message', () => {
    expect(extractLastUserText([])).toBe('')
    expect(extractLastUserText([new AIMessage('hi'), new SystemMessage('sys')])).toBe('')
  })

  it('returns string content of the last HumanMessage', () => {
    const messages = [
      new HumanMessage('first'),
      new AIMessage('reply'),
      new HumanMessage('second user'),
    ]
    expect(extractLastUserText(messages)).toBe('second user')
  })

  it('joins text parts from array content', () => {
    const messages = [
      new HumanMessage({
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
      }),
    ]
    expect(extractLastUserText(messages)).toBe('hello world')
  })

  it('ignores non-text content parts', () => {
    const messages = [
      new HumanMessage({
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } },
          { type: 'text', text: 'caption' },
        ],
      }),
    ]
    expect(extractLastUserText(messages)).toBe('caption')
  })
})
