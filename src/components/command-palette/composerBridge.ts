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
