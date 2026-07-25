import type { PermissionMode, SkillMeta } from '@hip/protocol'
import { buildSystemPrompt, skillsBlock } from './system-prompt.js'
import { formatCurrentTimeText } from './current-time.js'
import {
  filterSkillsForProfile,
  renderCapabilityNarrative,
  resolveAgentRuntimeProfile,
} from './agent-runtime-profile.js'

// ── State ──────────────────────────────────────────────────────────────────────

export interface InjectorState {
  cwd: string
  permissionMode: PermissionMode
  skills: SkillMeta[]
  tokenBudgetPercent: number
  /** Product surface — owns persona/body; permissionMode owns tool gates. */
  surface?: 'chat' | 'code' | 'knowledge'
  pendingSubagents?: { id: string; description: string; status: string }[]
  completedSubagents?: { id: string; description: string; status: string }[]
  /** Session id for memory prefetch + surface inference + skill filtering. */
  sessionId?: string
  /** When true, MemoryInjector may inject core snapshot + prefetch. */
  useMemories?: boolean
  /** Frozen core memory block for this project (host-cached). */
  memoryCoreSnapshot?: string
  /** Pinned/core item ids paired with memoryCoreSnapshot. */
  memoryCoreIds?: string[]
  /** Mutable accumulator of memory ids injected this turn (core + prefetch). */
  memoryIdsInjected?: Set<string>
  /** Last user text used as memory prefetch query. */
  prefetchQuery?: string
  /** Currently focused/previewed project-relative path (UI → context). */
  openFilePath?: string
  /** Optional short excerpt of the open file. */
  openFileExcerpt?: string
}

// ── Result ─────────────────────────────────────────────────────────────────────

export interface InjectResult {
  systemMessages: string[]
}

// ── Interface ──────────────────────────────────────────────────────────────────

export interface ContextInjector {
  readonly id: string
  inject(state: InjectorState): Promise<InjectResult>
}

// ── Registry ───────────────────────────────────────────────────────────────────

export class ContextInjectorRegistry {
  private readonly injectors: ContextInjector[] = []

  register(injector: ContextInjector): void {
    this.injectors.push(injector)
  }

  /** Run all registered injectors in registration order and collect results. */
  async injectAll(state: InjectorState): Promise<InjectResult[]> {
    const results: InjectResult[] = []
    for (const injector of this.injectors) {
      results.push(await injector.inject(state))
    }
    return results
  }
}

// ── Injector implementations ───────────────────────────────────────────────────

/** Wraps `buildSystemPrompt()` to produce the core system prompt. */
export class SystemPromptInjector implements ContextInjector {
  readonly id = 'system-prompt'

  async inject(state: InjectorState): Promise<InjectResult> {
    const prompt = buildSystemPrompt({
      cwd: state.cwd,
      skills: state.skills,
      permissionMode: state.permissionMode,
      surface: state.surface,
    })
    return { systemMessages: [prompt] }
  }
}

/** Injects wall-clock local + UTC time (minute precision) so the model can anchor "today" / relative time. */
export class CurrentTimeInjector implements ContextInjector {
  readonly id = 'current-time'

  async inject(_state: InjectorState): Promise<InjectResult> {
    return { systemMessages: [formatCurrentTimeText()] }
  }
}

/**
 * Lists available skills.
 * Prefer SystemPromptInjector (skills already embedded in buildSystemPrompt).
 * When used alone (tests / custom pipelines), still filters by surface profile.
 */
export class SkillsListInjector implements ContextInjector {
  readonly id = 'skills-list'

  async inject(state: InjectorState): Promise<InjectResult> {
    if (state.skills.length === 0) return { systemMessages: [] }
    const profile = resolveAgentRuntimeProfile({
      surface: state.surface,
      permissionMode: state.permissionMode,
      sessionId: state.sessionId,
      cwd: state.cwd,
    })
    const skills = filterSkillsForProfile(state.skills, profile)
    if (skills.length === 0) return { systemMessages: [] }
    const block = skillsBlock(skills, state.cwd)
    return { systemMessages: block ? [block] : [] }
  }
}

/** Adds a surface-aware capability reminder (never bare "permission mode: edit"). */
export class PermissionModeInjector implements ContextInjector {
  readonly id = 'permission-mode'

  async inject(state: InjectorState): Promise<InjectResult> {
    const narrative = renderCapabilityNarrative({
      surface: state.surface,
      permissionMode: state.permissionMode,
      sessionId: state.sessionId,
      cwd: state.cwd,
    })
    return { systemMessages: [narrative] }
  }
}

/** Adds a token-budget warning when remaining budget is below 30%. */
export class TokenBudgetInjector implements ContextInjector {
  readonly id = 'token-budget'

  async inject(state: InjectorState): Promise<InjectResult> {
    if (state.tokenBudgetPercent >= 30) return { systemMessages: [] }
    if (state.tokenBudgetPercent <= 10) {
      return {
        systemMessages: [
          'Your token budget is nearly exhausted. Finish quickly or compact the conversation.',
        ],
      }
    }
    return {
      systemMessages: [
        `You have approximately ${state.tokenBudgetPercent}% of your token budget remaining.`,
      ],
    }
  }
}

/** Wraps existing subagent-notification logic for pending / completed subagents. */
export class SubagentStatusInjector implements ContextInjector {
  readonly id = 'subagent-status'

  async inject(state: InjectorState): Promise<InjectResult> {
    const sections: string[] = []

    if (state.pendingSubagents && state.pendingSubagents.length > 0) {
      const pending = state.pendingSubagents
        .map((s) => `- ${s.description} (${s.id})`)
        .join('\n')
      sections.push(`Pending background tasks:\n${pending}`)
    }

    if (state.completedSubagents && state.completedSubagents.length > 0) {
      const completed = state.completedSubagents
        .map((s) => `- ${s.description} (${s.id}) — ${s.status}`)
        .join('\n')
      sections.push(`Completed background tasks:\n${completed}`)
    }

    return { systemMessages: sections }
  }
}
