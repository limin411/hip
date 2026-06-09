import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from './session.js'

const apiKey = process.env.DEEPSEEK_API_KEY
type Ev = { type: string; [k: string]: unknown }

// P0 guard: the default (reasoner) path must delegate, call write_file, write a real file,
// AND surface reasoning. Pre-fix this fails on the reasoning assertion because langchain's v3
// stream drops reasoning_content; the ReasoningChatOpenAI re-projection in buildModel restores it.
// (Also guards the withConfig/_streamResponseChunks override against future @langchain bumps.)
describe.skipIf(!apiKey)('P0 guard: default reasoner path captures reasoning + writes files', () => {
  it(
    'delegates, calls write_file, writes a file, and emits reasoning under the default reasoner model',
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'hip-reasoner-'))
      const session = new Session('it-reasoner-default', { llmProvider: 'deepseek', model: '', tools: [], cwd, thinking: true })
      const events: Ev[] = []
      await session.sendMessage('Create a file at /hello.html containing a minimal valid HTML page that says Hello.', (m) => events.push(m as Ev))

      const wroteFileTool = events.some((e) => e.type === 'tool:started' && e.name === 'write_file')
      const filesOnDisk = readdirSync(cwd, { recursive: true }) as string[]
      const reasoningCaptured = events.some((e) => e.type === 'reasoning:delta')
      const completed = events.some((e) => e.type === 'message:complete')

      expect(completed).toBe(true)
      expect(wroteFileTool).toBe(true)
      expect(filesOnDisk.some((f) => f.endsWith('.html'))).toBe(true)
      expect(reasoningCaptured).toBe(true)
    },
    180_000,
  )
})
