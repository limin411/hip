import type { SkillMeta, PermissionMode } from '@hip/protocol'
import { SystemContext } from './system-context.js'
import type { Source } from './system-context.js'

// ── State ────────────────────────────────────────────────────────────────────

/** Snapshot of session state used by fragments to decide activation / rendering. */
export interface FragmentState {
  /** Token budget pressure: 0..100 where 100 means nearly exhausted. */
  tokenBudgetPercent?: number
  /** Subagents that are currently running. */
  pendingSubagents?: Array<{ id: string; description: string; status: 'running' | 'completed' | 'failed' }>
  /** Subagents that have already finished (completed or failed). */
  completedSubagents?: Array<{ id: string; description: string; status: 'running' | 'completed' | 'failed' }>
  /** Set of registered skills (id → metadata). */
  skills?: SkillMeta[]
  mcpCatalog?: string
  /** Current working directory. */
  cwd?: string
  /** Active permission mode. */
  permissionMode?: 'chat' | 'edit' | 'full'
  /** Per-conversation user instructions injected into the system message. */
  customSystemPrompt?: string
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

// ── Source-backed fragment adapter ────────────────────────────────────────────

/** A synthetic ContextFragment backed by a single SystemContext source baseline. */
class SourceBaselineFragment implements ContextFragment {
  readonly id: string
  readonly role = 'system' as const

  constructor(id: string, private readonly text: string) {
    this.id = id
  }

  isActive(): boolean {
    return true
  }

  render(): string {
    return this.text
  }

  estimatedTokens(): number {
    return Math.ceil(this.text.length / 4)
  }
}

/** Resolve every source from a SystemContext and assemble its baseline text. */
async function assembleFromSystemContext(
  systemContext: SystemContext,
): Promise<{ text: string; tokens: number; fragments: ContextFragment[] }> {
  const generation = await systemContext.initialize()
  const fragments: ContextFragment[] = []
  let tokens = 0

  for (const source of systemContext.getSources()) {
    const entry = generation.snapshot[source.key]
    if (entry === undefined) continue
    const value = source.codec.decode(entry.value)
    const text = source.baseline(value)
    fragments.push(new SourceBaselineFragment(source.key, text))
    tokens += Math.ceil(text.length / 4)
  }

  return { text: generation.baseline, tokens, fragments }
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
  assemble(state: FragmentState): { text: string; tokens: number; fragments: ContextFragment[] }
  /** Assemble the full context by resolving Sources from a SystemContext. */
  assemble(
    systemContext: SystemContext,
  ): Promise<{ text: string; tokens: number; fragments: ContextFragment[] }>
  assemble(
    input: FragmentState | SystemContext,
  ):
    | { text: string; tokens: number; fragments: ContextFragment[] }
    | Promise<{ text: string; tokens: number; fragments: ContextFragment[] }> {
    if (input instanceof SystemContext) {
      return assembleFromSystemContext(input)
    }
    const active = this.getActiveFragments(input)
    const text = active.map((f) => f.render(input)).join('\n\n')
    const tokens = active.reduce((sum, f) => sum + f.estimatedTokens(input), 0)
    return { text, tokens, fragments: active }
  }
}
