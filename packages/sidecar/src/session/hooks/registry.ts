import type { Hook, HookEvent, HookContext, HookMatcher, HookResult } from '@hip/protocol'

const HOOK_TIMEOUT_MS = 5000

class ReentrancyError extends Error {
  constructor() {
    super('Hook re-entrancy detected')
    this.name = 'ReentrancyError'
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`)
}

function matchPattern(pattern: string, str: string): boolean {
  return globToRegex(pattern).test(str)
}

function matcherMatches(matcher: HookMatcher | undefined, toolName: string | undefined): boolean {
  if (matcher === undefined) return true
  if (toolName === undefined) return false
  const patterns = Array.isArray(matcher) ? matcher : [matcher]
  return patterns.some((p) => matchPattern(p, toolName))
}

/** Terminal hook result kinds that halt further hook execution. */
function isTerminal(kind: string): boolean {
  return kind === 'deny' || kind === 'ask'
}

/**
 * Aggregates hook results across all matching hooks for an event.
 *
 * Terminal kinds (`deny`, `ask`) short-circuit immediately.
 * Non-terminal kinds (`allow`, `modify`, `continue`) continue to the next
 * hook, and the final result combines all outcomes:
 * - Hooks are iterated in registration order; order matters for aggregation.
 * - `modifiedInput` from `modify` hooks is forwarded to subsequent hooks'
 *   toolInput context. The last `modify` hook wins for the final result.
 * - `additionalContexts` from all hooks are concatenated.
 * - The final `kind` reflects the strongest non-terminal result seen:
 *   `continue` > `modify` > `allow`.
 * - The final `reason` comes from the hook that set the strongest kind.
 * - The final `prompt` comes from the last `continue` response that provides one,
 *   falling back to earlier `continue` prompts.
 */
export class HookRegistry {
  private hooks: Hook[] = []
  private activeHooks = new Set<Hook>()

  register(hook: Hook): void {
    this.hooks.push(hook)
  }

  /** Remove all registered hooks. Idempotent. */
  clear(): void {
    this.hooks = []
  }

  /** Returns true if at least one registered hook matches the event and optional tool name. */
  hasMatchingHook(event: HookEvent, toolName?: string): boolean {
    return this.hooks.some((h) => h.event === event && matcherMatches(h.matcher, toolName))
  }

  async fire(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const matching = this.hooks.filter(
      (h) => h.event === event && matcherMatches(h.matcher, ctx.toolName),
    )

    let strongestKind: HookResult['kind'] = 'allow'
    let combinedReason: string | undefined
    let combinedPrompt: string | undefined
    const combinedContexts: string[] = []
    let currentInput: Record<string, unknown> | undefined = ctx.toolInput

    for (const hook of matching) {
      if (this.activeHooks.has(hook)) {
        throw new ReentrancyError()
      }
      this.activeHooks.add(hook)
      try {
        // Pass the current (possibly modified) input to the hook context.
        const hookCtx: HookContext = { ...ctx, toolInput: currentInput }
        const result = await Promise.race([
          hook.handler(hookCtx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Hook timed out')), HOOK_TIMEOUT_MS),
          ),
        ])

        // Terminal results short-circuit immediately.
        if (isTerminal(result.kind)) {
          return result
        }

        // Collect additionalContexts from all non-terminal hooks.
        if (result.additionalContexts?.length) {
          for (const c of result.additionalContexts) {
            combinedContexts.push(c)
          }
        }

        // Track the strongest non-terminal kind and keep the reason from the
        // hook that set that kind.
        if (result.kind === 'continue') {
          strongestKind = 'continue'
          combinedPrompt = result.prompt ?? combinedPrompt
          if (result.reason) combinedReason = result.reason
        } else if (result.kind === 'modify' && strongestKind !== 'continue') {
          strongestKind = 'modify'
          if (result.reason) combinedReason = result.reason
        } else if (result.kind === 'allow' && strongestKind === 'allow' && result.reason) {
          combinedReason = result.reason
        }

        // Forward modifiedInput to subsequent hooks.
        if (result.kind === 'modify' && result.modifiedInput) {
          currentInput = result.modifiedInput
        }
      } catch (err) {
        if (err instanceof ReentrancyError) throw err
        return { kind: 'deny', reason: 'Hook crashed or timed out' }
      } finally {
        this.activeHooks.delete(hook)
      }
    }

    // Build the aggregated result.
    const aggregated: HookResult = { kind: strongestKind }
    if (combinedReason) aggregated.reason = combinedReason
    if (combinedPrompt) aggregated.prompt = combinedPrompt
    if (combinedContexts.length) aggregated.additionalContexts = combinedContexts
    if (strongestKind === 'modify' && currentInput !== ctx.toolInput) aggregated.modifiedInput = currentInput
    return aggregated
  }
}
