import type { SessionConfig } from '@hip/protocol'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { getActiveModel, cheapModelFor } from '../config/providers.js'
import { withoutLangSmithTracing } from '../observability/langsmith.js'
import { buildChatModel } from './model-factory.js'

const TITLE_LEN = 40

function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) + '…' : oneLine || '新对话'
}

/** Normalize a generated/echoed title: one line, no wrapping quotes, no trailing punctuation, bounded length. */
export function sanitizeTitle(raw: string): string {
  const oneLine = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'""''「」『』]+/, '')
    .replace(/["'""''「」『』]+$/, '')
    .replace(/[。.！!？?，,、；;：:]+$/, '')
    .trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) : oneLine
}

export type TitleGenerator = (input: {
  firstUserMessage: string
  firstReply: string
  /** Kept for call-site compatibility; title LLM is not traced. */
  sessionId?: string
}) => Promise<string>

const TITLE_SYSTEM_PROMPT =
  'You generate a very short title (at most 6 words, or about 16 Chinese characters) for a chat conversation. ' +
  'Use the same language as the user. Reply with ONLY the title — no quotes, no trailing punctuation.'

/** Production title generator: one cheap completion. Not used when a model is injected (tests). */
export function buildDefaultTitleGenerator(_config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = buildChatModel({ providerID, modelID: cheapModelFor(providerID, modelID), baseURL })
    // Title refine is a product side-effect, not part of the agent turn graph.
    // Force-off LangSmith so it never posts a root run (hip.model / hip.title).
    const res = await withoutLangSmithTracing(() =>
      model.invoke([
        new SystemMessage(TITLE_SYSTEM_PROMPT),
        new HumanMessage(`${firstUserMessage}\n\n[assistant reply]: ${firstReply.slice(0, 200)}`),
      ]),
    )
    return typeof res.content === 'string' ? res.content : ''
  }
}

export { deriveTitle, TITLE_LEN }
