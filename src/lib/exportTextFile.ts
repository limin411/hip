import { invoke } from '@tauri-apps/api/core'
import { pickSavePath } from '@/ipc/dialog'

/** Browser / non-Tauri fallback: trigger a download of text content. */
export function downloadText(
  filename: string,
  data: string,
  mime = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export type ExportTextFileResult = 'saved' | 'cancelled' | 'failed'

/**
 * Native save dialog + write. Falls back to a browser download when the Tauri
 * write command is unavailable (unit tests, plain web).
 */
export async function exportTextFile(opts: {
  content: string
  defaultPath: string
  title?: string
  filters?: { name: string; extensions: string[] }[]
  mime?: string
}): Promise<ExportTextFileResult> {
  let dest: string | null
  try {
    dest = await pickSavePath({
      defaultPath: opts.defaultPath,
      title: opts.title,
      filters: opts.filters,
    })
  } catch {
    return 'failed'
  }
  if (!dest) return 'cancelled'

  try {
    await invoke('write_text_file', { path: dest, contents: opts.content })
    return 'saved'
  } catch {
    try {
      const name = dest.replace(/^.*[/\\]/, '') || opts.defaultPath
      downloadText(name, opts.content, opts.mime ?? 'text/plain;charset=utf-8')
      return 'saved'
    } catch {
      return 'failed'
    }
  }
}
