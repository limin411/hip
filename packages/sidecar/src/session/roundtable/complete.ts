import { HumanMessage, SystemMessage, type AIMessage } from '@langchain/core/messages'
import type { ModelRunner } from '../model-runner.js'
import type { RoundtableCompleteFns } from './types.js'

function aiText(msg: AIMessage): string {
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          b != null &&
          typeof b === 'object' &&
          (b as { type?: string }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('')
  }
  return ''
}

/** Build LLM complete fns from session ModelRunner (no tools). */
export function completeFnsFromModelRunner(runner: ModelRunner): RoundtableCompleteFns {
  return {
    async complete({ system, user, signal }) {
      const msg = await runner.run([new SystemMessage(system), new HumanMessage(user)], {
        tools: [],
        bindTools: false,
        signal,
        onText: () => {},
        onReasoning: () => {},
      })
      return aiText(msg)
    },
  }
}

/** Scripted responses for unit tests (FIFO). */
export function scriptedCompleteFns(responses: string[]): RoundtableCompleteFns {
  const queue = [...responses]
  return {
    async complete({ signal }) {
      if (signal.aborted) {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }
      const next = queue.shift()
      if (next === undefined) throw new Error('scripted LLM exhausted')
      return next
    },
  }
}
