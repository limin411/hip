/**
 * Knowledge → Agent AI actions (Phase 3).
 * Packs doc context and opens a chat session with the global default model.
 */

import { sessionService } from '@/domain/sessionService'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import type { SessionConfig } from '@hip/protocol'

export type KnowledgeAiActionId =
  | 'continue'
  | 'summarize'
  | 'toTasks'
  | 'explain'
  | 'rewrite'

export type KnowledgeAiDocContext = {
  title: string
  /** Heading outline labels. */
  outline: string[]
  /** Selected text or local window around caret. */
  selection: string
  /** Optional surrounding body window for large docs. */
  bodyWindow?: string
  /** Top backlink titles. */
  backlinks?: string[]
  spaceId?: string | null
  docId?: string | null
}

const ACTION_PROMPTS: Record<KnowledgeAiActionId, string> = {
  continue: 'Continue writing from the selection. Match tone and structure. Output only the continuation markdown.',
  summarize: 'Summarize the document context concisely in markdown bullet points.',
  toTasks: 'Extract actionable tasks as a GFM task list (- [ ] …).',
  explain: 'Explain the selected text or code clearly. Use markdown.',
  rewrite: 'Rewrite the selection for clarity and flow. Output only the rewritten markdown.',
}

export function packKnowledgeAiPrompt(
  action: KnowledgeAiActionId,
  ctx: KnowledgeAiDocContext,
): string {
  const parts: string[] = [
    ACTION_PROMPTS[action],
    '',
    `Document title: ${ctx.title || '(untitled)'}`,
  ]
  if (ctx.outline.length) {
    parts.push('Outline:', ...ctx.outline.map((h) => `- ${h}`))
  }
  if (ctx.backlinks?.length) {
    parts.push('Backlinks:', ...ctx.backlinks.slice(0, 3).map((b) => `- ${b}`))
  }
  if (ctx.selection.trim()) {
    parts.push('', 'Selection:', '```', ctx.selection.trim(), '```')
  } else if (ctx.bodyWindow?.trim()) {
    parts.push('', 'Document window:', '```', ctx.bodyWindow.trim().slice(0, 6000), '```')
  }
  return parts.join('\n')
}

export type KnowledgeAiRunResult = {
  sessionId: string
  prompt: string
}

/**
 * Create (or reuse pattern) a chat session and send the packed prompt.
 * Caller inserts AI result into the editor after the user confirms.
 */
export function runKnowledgeAiAction(opts: {
  action: KnowledgeAiActionId
  docContext: KnowledgeAiDocContext
  /** Override session config; default follows active/global chat config. */
  config?: Partial<SessionConfig>
  activate?: boolean
}): KnowledgeAiRunResult {
  const prompt = packKnowledgeAiPrompt(opts.action, opts.docContext)
  const active = useDomainStore.getState().sessions.find(
    (s) => s.id === useDomainStore.getState().activeSessionId,
  )
  const base: SessionConfig = {
    ...DEFAULT_CONFIG,
    ...(active?.config ?? {}),
    surface: 'chat',
    ...opts.config,
  }
  const sessionId = sessionService.createSession(base, {
    activate: opts.activate !== false,
  })
  sessionService.sendMessageToSession(sessionId, prompt)
  return { sessionId, prompt }
}

/** Convenience alias matching the plan name. */
export const knowledgeAiActions = {
  run: runKnowledgeAiAction,
  pack: packKnowledgeAiPrompt,
  actionIds: [
    'continue',
    'summarize',
    'toTasks',
    'explain',
    'rewrite',
  ] as const satisfies readonly KnowledgeAiActionId[],
}
