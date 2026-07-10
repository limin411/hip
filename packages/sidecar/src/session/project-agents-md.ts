/**
 * Inject project guidance files (AGENTS.md / CLAUDE.md / .hip/MEMORY.md) into the system context.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContextInjector, InjectorState, InjectResult } from './context-injector.js'

/** Max chars per guidance file to keep system prompts bounded. */
export const MAX_PROJECT_GUIDANCE_CHARS = 48_000

/** Lookup order: first existing file wins for "agents" style instructions. */
export const PROJECT_AGENTS_CANDIDATES = [
  'AGENTS.md',
  'CLAUDE.md',
  'Claude.md',
  '.hip/AGENTS.md',
] as const

export const PROJECT_MEMORY_CANDIDATES = ['.hip/MEMORY.md', 'MEMORY.md'] as const

function readBounded(path: string, maxChars: number): string | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf8')
    if (!raw.trim()) return null
    if (raw.length <= maxChars) return raw
    return `${raw.slice(0, maxChars)}\n\n…(truncated)`
  } catch {
    return null
  }
}

/**
 * Load the first matching project agents/instructions file under cwd.
 * Pure helper for tests.
 */
export function loadProjectAgentsMd(
  cwd: string,
  candidates: readonly string[] = PROJECT_AGENTS_CANDIDATES,
): { name: string; content: string } | null {
  if (!cwd) return null
  for (const name of candidates) {
    const content = readBounded(join(cwd, name), MAX_PROJECT_GUIDANCE_CHARS)
    if (content) return { name, content }
  }
  return null
}

/**
 * Load optional long-term project memory notes.
 */
export function loadProjectMemoryMd(
  cwd: string,
  candidates: readonly string[] = PROJECT_MEMORY_CANDIDATES,
): { name: string; content: string } | null {
  if (!cwd) return null
  for (const name of candidates) {
    const content = readBounded(join(cwd, name), MAX_PROJECT_GUIDANCE_CHARS)
    if (content) return { name, content }
  }
  return null
}

/** Context injector: inject AGENTS.md (or CLAUDE.md) + optional MEMORY.md. */
export class ProjectAgentsMdInjector implements ContextInjector {
  readonly id = 'project-agents-md'

  async inject(state: InjectorState): Promise<InjectResult> {
    const messages: string[] = []
    const agents = loadProjectAgentsMd(state.cwd)
    if (agents) {
      messages.push(
        `# Project instructions (${agents.name})\n\nFollow these project-specific rules and conventions:\n\n${agents.content}`,
      )
    }
    const memory = loadProjectMemoryMd(state.cwd)
    if (memory) {
      messages.push(
        `# Project memory (${memory.name})\n\nPersistent notes from prior work on this project:\n\n${memory.content}`,
      )
    }
    return { systemMessages: messages }
  }
}
