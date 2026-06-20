import type { SkillMeta } from '@hip/protocol'

// ── State ────────────────────────────────────────────────────────────────────

/** Snapshot of session state used by fragments to decide activation / rendering. */
export interface FragmentState {
  /** Token budget pressure: 0..100 where 100 means nearly exhausted. */
  tokenBudgetPercent?: number
  /** Whether the session currently has subagents (any state). */
  hasSubagents?: boolean
  /** Subagents that are currently running. */
  pendingSubagents?: Array<{ id: string; description: string; status: 'running' | 'completed' | 'failed' }>
  /** Subagents that have already finished (completed or failed). */
  completedSubagents?: Array<{ id: string; description: string; status: 'running' | 'completed' | 'failed' }>
  /** Set of registered skills (id → metadata). */
  skills?: SkillMeta[]
  /** Known MCP server names. */
  mcpCatalog?: string[]
  /** Current working directory. */
  cwd?: string
  /** Active permission mode. */
  permissionMode?: 'chat' | 'edit' | 'full'
  /** Per-conversation user instructions injected into the system message. */
  customSystemPrompt?: string
  /** UI language. */
  language?: 'en' | 'zh-CN' | 'zh-TW'
}

// ── Fragment ─────────────────────────────────────────────────────────────────

/** A pluggable unit of context injected into the model's prompt. */
export interface ContextFragment {
  /** Unique identifier (e.g. "system-prompt", "token-budget"). */
  id: string
  /** The OpenAI message role for this fragment's output. */
  role: 'developer' | 'user' | 'system'
  /** Whether this fragment should be active given the current session state. */
  isActive(state: FragmentState): boolean
  /** Produce the text to inject into the prompt. */
  render(state: FragmentState): string
  /** Estimated number of tokens the rendered output will consume. */
  estimatedTokens(state: FragmentState): number
}

// ── Registry ─────────────────────────────────────────────────────────────────

/** Holds a collection of ContextFragments assembled into a prompt. */
export class FragmentRegistry {
  private readonly fragments: ContextFragment[] = []

  /** Register a fragment. Throws if another fragment with the same id is already registered. */
  register(fragment: ContextFragment): void {
    if (this.fragments.some((f) => f.id === fragment.id)) {
      throw new Error(`Duplicate fragment id: ${fragment.id}`)
    }
    this.fragments.push(fragment)
  }

  /** Return all registered fragments whose `isActive(state)` returns true, in registration order. */
  getActiveFragments(state: FragmentState): ContextFragment[] {
    return this.fragments.filter((f) => f.isActive(state))
  }

  /** Assemble the full context from all active fragments. */
  assemble(state: FragmentState): { text: string; tokens: number; fragments: ContextFragment[] } {
    const active = this.getActiveFragments(state)
    const text = active.map((f) => f.render(state)).join('\n\n')
    const tokens = active.reduce((sum, f) => sum + f.estimatedTokens(state), 0)
    return { text, tokens, fragments: active }
  }
}
