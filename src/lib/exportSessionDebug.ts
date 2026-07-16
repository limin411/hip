import i18n from '@/i18n'
import { exportTextFile, type ExportTextFileResult } from '@/lib/exportTextFile'

/** Safe default filename for a session debug JSON export. */
export function defaultDebugExportFilename(
  sessionId: string,
  now: Date = new Date(),
): string {
  const safe = sessionId.replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 32) || 'session'
  const day = now.toISOString().slice(0, 10)
  return `hip-debug-${safe}-${day}.json`
}

/** Save a redacted session debug bundle via native save dialog (or download fallback). */
export async function exportSessionDebugBundle(
  json: string,
  sessionId: string,
): Promise<ExportTextFileResult> {
  return exportTextFile({
    content: json,
    defaultPath: defaultDebugExportFilename(sessionId),
    title: i18n.t('chat.exportDebug'),
    filters: [{ name: 'JSON', extensions: ['json'] }],
    mime: 'application/json',
  })
}
