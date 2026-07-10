import type { PermissionMode, SkillMeta } from '@hip/protocol'
import { buildSystemPrompt, skillsBlock } from './system-prompt.js'

// ── State ──────────────────────────────────────────────────────────────────────

export interface InjectorState {
  cwd: string
  permissionMode: PermissionMode
  skills: SkillMeta[]
  tokenBudgetPercent: number
  /** When 'chat', system prompt omits heavy code/git guidance. */
  surface?: 'chat' | 'code'
  pendingSubagents?: { id: string; description: string; status: string }[]
  completedSubagents?: { id: string; description: string; status: string }[]
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

/** Wraps `skillsBlock()` to list available skills. */
export class SkillsListInjector implements ContextInjector {
  readonly id = 'skills-list'

  async inject(state: InjectorState): Promise<InjectResult> {
    if (state.skills.length === 0) return { systemMessages: [] }
    const block = skillsBlock(state.skills, state.cwd)
    return { systemMessages: block ? [block] : [] }
  }
}

/** Adds a permission-mode reminder. */
export class PermissionModeInjector implements ContextInjector {
  readonly id = 'permission-mode'

  async inject(state: InjectorState): Promise<InjectResult> {
    return { systemMessages: [`Current permission mode: ${state.permissionMode}.`] }
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
