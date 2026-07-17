/** Format a parallel-run title for session list. */
export function parallelSlotTitle(runShort: string, index: number, total: number): string {
  return `P${index}/${total} · ${runShort}`
}

export function parallelHostTitle(runShort: string): string {
  return `Parallel host · ${runShort}`
}
