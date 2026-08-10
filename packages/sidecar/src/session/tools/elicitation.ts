// packages/sidecar/src/session/tools/elicitation.ts
// `ask_user` tool (G3): agent pauses the turn to ask a clarifying question.
// The tool registers a pending elicitation and returns a deferred placeholder;
// the agent node then checks `coordinator.paused` and stops the turn. When the
// user answers, the placeholder ToolMessage content is rewritten with the
// answer so the next turn sees the question resolved.
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { ElicitationCoordinator } from '../elicitation.js'
import { ELICITATION_PENDING_PREFIX } from '../elicitation.js'

export function buildElicitationTool(
  coordinator: ElicitationCoordinator | undefined,
): StructuredToolInterface[] {
  if (!coordinator) return []

  const askUser = tool(
    async ({ question, options, context }) => {
      const e = coordinator.register(question, { options, context })
      return `${ELICITATION_PENDING_PREFIX} ${e.id}: ${question}`
    },
    {
      name: 'ask_user',
      description:
        'Pause and ask the user a clarifying question. Use this when the task boundary is ambiguous: ' +
        'scope, acceptance criteria, destructive operations, or a choice between approaches. ' +
        'The turn pauses until the user answers (or times out after 10 minutes, in which case ' +
        'continue with your best judgement). Prefer this over guessing on big multi-step work.',
      schema: z.object({
        question: z.string().describe('The question to ask the user, concise and specific.'),
        options: z
          .array(z.string())
          .optional()
          .describe('Optional answer options the user can pick from (plain strings).'),
        context: z
          .string()
          .optional()
          .describe('Optional context for the user: why this matters and what happens on each choice.'),
      }),
    },
  )

  return [askUser]
}
