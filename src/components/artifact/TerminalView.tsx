import { useCallback } from 'react'
import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { sessionService } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'

/**
 * Code-panel Terminal tab body.
 * PR-1: empty / no-cwd shell only (no xterm / PTY yet).
 * Full interactive TTY lands in PR-3.
 */
export function TerminalView() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const cwd = useActiveSession()?.config.cwd

  const chooseFolder = useCallback(async () => {
    if (!sessionId) return
    const dir = await pickDirectory()
    if (!dir) return
    sessionService.setProjectDir(sessionId, dir)
  }, [sessionId])

  if (!cwd) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary"
        data-testid="terminal-view-empty"
      >
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[240px] text-body font-medium text-ink-secondary">
          {t('artifact.terminalView.noCwd')}
        </div>
        <div className="max-w-[240px] text-meta">{t('artifact.terminalView.noCwdDesc')}</div>
        <button
          type="button"
          data-testid="terminal-select-folder"
          onClick={() => void chooseFolder()}
          className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('artifact.terminalView.selectFolder')}
        </button>
      </div>
    )
  }

  // Placeholder until PR-3 wires xterm + PTY. Keeps panel_view-terminal mountable under flag.
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-tertiary"
      data-testid="terminal-view-placeholder"
    >
      <div className="max-w-[280px] truncate font-mono text-meta text-ink-secondary" title={cwd}>
        {cwd}
      </div>
      <div className="max-w-[240px] text-meta">{t('artifact.terminalView.starting')}</div>
    </div>
  )
}
