import type { SessionConfig } from '@hip/protocol'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { getActiveModel, cheapModelFor } from '../config/providers.js'
import { buildChatModel } from './model-factory.js'
import { stripRoundtableFrame } from './roundtable/detect.js'

const TITLE_LEN = 40

type AppLanguage = NonNullable<SessionConfig['language']>

function deriveTitle(content: string): string {
  const oneLine = stripRoundtableFrame(content).replace(/\s+/g, ' ').trim()
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
  /** App UI language for this generation (from SessionConfig.language). */
  language?: SessionConfig['language']
}) => Promise<string>

/** Human-readable language label for the title LLM prompt. */
export function titleLanguageLabel(lang: AppLanguage): string {
  if (lang === 'zh-CN') return 'Simplified Chinese (zh-CN)'
  if (lang === 'zh-TW') return 'Traditional Chinese (zh-TW)'
  if (lang === 'ja') return 'Japanese (ja)'
  if (lang === 'ko') return 'Korean (ko)'
  return 'English (en)'
}

/**
 * System prompt for session auto-title.
 * Language follows the app UI setting (SessionConfig.language), not the user's message language.
 */
export function buildTitleSystemPrompt(language: AppLanguage = 'en'): string {
  const label = titleLanguageLabel(language)
  return (
    'You generate a very short title (at most 6 words, or about 16 Chinese characters) for a chat conversation. ' +
    `Write the title in ${label}. Match the app UI language (${language}), not necessarily the user's message language. ` +
    'Reply with ONLY the title — no quotes, no trailing punctuation.'
  )
}

/** Production title generator: one cheap completion. Not used when a model is injected (tests). */
export function buildDefaultTitleGenerator(config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply, language }) => {
    const lang: AppLanguage = language ?? config.language ?? 'en'
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = buildChatModel({ providerID, modelID: cheapModelFor(providerID, modelID), baseURL })
    // Title refine is a product side-effect, not part of the agent turn graph.
    const res = await model.invoke([
      new SystemMessage(buildTitleSystemPrompt(lang)),
      new HumanMessage(`${firstUserMessage}\n\n[assistant reply]: ${firstReply.slice(0, 200)}`),
    ])
    return typeof res.content === 'string' ? res.content : ''
  }
}

export { deriveTitle, TITLE_LEN }
