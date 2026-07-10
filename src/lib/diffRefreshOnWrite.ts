/** Write-like tools that should trigger a workspace diff refresh (Sprint B). */
export const DIFF_REFRESH_TOOLS = new Set(['write_file', 'edit_file', 'git_commit'])

export function shouldRefreshDiffOnToolFinish(name: string, status: string): boolean {
  return status === 'finished' && DIFF_REFRESH_TOOLS.has(name)
}

/** Debounce helper: trailing call within `ms` window. */
export function createDebouncedFn(fn: (sessionId: string) => void, ms: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return (sessionId: string) => {
    const prev = timers.get(sessionId)
    if (prev) clearTimeout(prev)
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId)
        fn(sessionId)
      }, ms),
    )
  }
}
