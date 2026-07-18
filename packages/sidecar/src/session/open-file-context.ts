/**
 * Context source: currently focused / previewed file for "fix this" (spec E4 open_file).
 */
import type { ContextInjector, InjectorState, InjectResult } from './context-injector.js'

export interface OpenFileContextState extends InjectorState {
  openFilePath?: string
  openFileExcerpt?: string
}

export class OpenFileContextInjector implements ContextInjector {
  readonly id = 'workspace.open_file'

  async inject(state: InjectorState): Promise<InjectResult> {
    const s = state as OpenFileContextState
    const path = s.openFilePath?.trim()
    if (!path) return { systemMessages: [] }
    const excerpt = s.openFileExcerpt?.trim()
    const body = excerpt
      ? `# Open file in user preview\n\nPath: \`${path}\`\n\nExcerpt:\n\`\`\`\n${excerpt.slice(0, 4000)}\n\`\`\``
      : `# Open file in user preview\n\nPath: \`${path}\`\n\nWhen the user says "fix this" / "这个" without a path, prefer this file.`
    return { systemMessages: [body] }
  }
}

/** Pure helper for tests / session turn wiring. */
export function renderOpenFileContext(path: string, excerpt?: string): string {
  const inj = new OpenFileContextInjector()
  // sync projection without async for unit tests
  const excerptPart = excerpt?.trim()
    ? `\n\nExcerpt:\n\`\`\`\n${excerpt.trim().slice(0, 4000)}\n\`\`\``
    : `\n\nWhen the user says "fix this" / "这个" without a path, prefer this file.`
  return `# Open file in user preview\n\nPath: \`${path.trim()}\`${excerptPart}`
}
