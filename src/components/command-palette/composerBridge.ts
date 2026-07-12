/** Lets the global palette / context menus write into the active composer when present. */

export type ComposerHandlers = {
  /** Insert at caret (or append); preserves existing draft. */
  insert: (text: string) => void
  /** Replace entire composer value (skill handoff). */
  replace: (text: string) => void
}

type LegacyInserter = (text: string) => void

let handlers: ComposerHandlers | null = null

/** Register insert + replace handlers. Pass null to clear. */
export function registerComposerHandlers(next: ComposerHandlers | null): void {
  handlers = next
}

/**
 * Legacy single-fn registration: used as BOTH insert and replace.
 * Prefer `registerComposerHandlers` when insert and replace differ (InputBar).
 */
export function registerComposerInserter(fn: LegacyInserter | null): void {
  if (!fn) {
    handlers = null
    return
  }
  handlers = { insert: fn, replace: fn }
}

/** Insert at caret / append. Returns true if a handler was registered and invoked. */
export function insertComposerText(text: string): boolean {
  if (!handlers) return false
  handlers.insert(text)
  return true
}

/** Replace entire composer. Returns true if a handler was registered and invoked. */
export function replaceComposerText(text: string): boolean {
  if (!handlers) return false
  handlers.replace(text)
  return true
}

export function hasComposerInserter(): boolean {
  return handlers != null
}

/**
 * Retry until the composer mounts (e.g. after selectSession from History).
 * Resolves true if the action succeeded within the attempt budget.
 */
function schedule(fn: () => void, ms: number): void {
  const g = globalThis as typeof globalThis & {
    setTimeout?: (cb: () => void, ms: number) => unknown
    requestAnimationFrame?: (cb: () => void) => unknown
  }
  if (ms <= 0 && typeof g.requestAnimationFrame === 'function') {
    g.requestAnimationFrame(() => fn())
    return
  }
  if (typeof g.setTimeout === 'function') {
    g.setTimeout(fn, ms)
    return
  }
  // Last resort (tests without timers): run sync on next microtask.
  void Promise.resolve().then(fn)
}

function whenReady(
  tryOnce: () => boolean,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<boolean> {
  const attempts = opts?.attempts ?? 8
  const intervalMs = opts?.intervalMs ?? 40
  return new Promise((resolve) => {
    let n = 0
    const tick = () => {
      if (tryOnce()) {
        resolve(true)
        return
      }
      n += 1
      if (n >= attempts) {
        resolve(false)
        return
      }
      schedule(tick, intervalMs)
    }
    // Allow React to commit after navigation before first try.
    schedule(tick, 0)
  })
}

export function insertComposerTextWhenReady(
  text: string,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<boolean> {
  return whenReady(() => insertComposerText(text), opts)
}

export function replaceComposerTextWhenReady(
  text: string,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<boolean> {
  return whenReady(() => replaceComposerText(text), opts)
}
