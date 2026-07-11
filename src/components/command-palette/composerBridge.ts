/** Lets the global palette insert text into the active composer when present. */

type Inserter = (text: string) => void

let inserter: Inserter | null = null

export function registerComposerInserter(fn: Inserter | null): void {
  inserter = fn
}

/** Returns true if an inserter was registered and invoked. */
export function insertComposerText(text: string): boolean {
  if (!inserter) return false
  inserter(text)
  return true
}

export function hasComposerInserter(): boolean {
  return inserter != null
}

/**
 * Retry insert until the composer mounts (e.g. after selectSession from History).
 * Resolves true if text was inserted within the attempt budget.
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

export function insertComposerTextWhenReady(
  text: string,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<boolean> {
  const attempts = opts?.attempts ?? 8
  const intervalMs = opts?.intervalMs ?? 40
  return new Promise((resolve) => {
    let n = 0
    const tryOnce = () => {
      if (insertComposerText(text)) {
        resolve(true)
        return
      }
      n += 1
      if (n >= attempts) {
        resolve(false)
        return
      }
      schedule(tryOnce, intervalMs)
    }
    // Allow React to commit after navigation before first try.
    schedule(tryOnce, 0)
  })
}
