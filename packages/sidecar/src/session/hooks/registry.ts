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

export class HookRegistry {
  private hooks: Hook[] = []
  private activeHooks = new Set<Hook>()

  register(hook: Hook): void {
    this.hooks.push(hook)
  }

  async fire(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const matching = this.hooks.filter(
      (h) => h.event === event && matcherMatches(h.matcher, ctx.toolName),
    )

    for (const hook of matching) {
      if (this.activeHooks.has(hook)) {
        throw new ReentrancyError()
      }
      this.activeHooks.add(hook)
      try {
        const result = await Promise.race([
          hook.handler(ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Hook timed out')), HOOK_TIMEOUT_MS),
          ),
        ])
        if (result.kind !== 'allow') {
          return result
        }
      } catch (err) {
        if (err instanceof ReentrancyError) throw err
        return { kind: 'deny', reason: 'Hook crashed or timed out' }
      } finally {
        this.activeHooks.delete(hook)
      }
    }

    return { kind: 'allow' }
  }
}
