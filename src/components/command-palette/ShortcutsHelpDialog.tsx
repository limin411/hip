import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { detectIsMac, getKeybindHelp } from './keys'

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const entries = getKeybindHelp(detectIsMac())

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[220] bg-ink/20" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[230] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-surface p-4 shadow-overlay outline-none',
          )}
          data-testid="keyboard-shortcuts-dialog"
        >
          <Dialog.Title className="text-body font-medium text-ink">
            {t('commandPalette.shortcuts.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-meta text-ink-secondary">
            {t('commandPalette.shortcuts.description')}
          </Dialog.Description>
          <div className="mt-4 space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 text-body">
                <span className="text-ink-secondary">{t(e.labelKey)}</span>
                <kbd className="rounded bg-surface-muted px-2 py-0.5 font-mono text-caption text-ink-tertiary">
                  {e.combo}
                </kbd>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
