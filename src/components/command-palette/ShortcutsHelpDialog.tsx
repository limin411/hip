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
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[220] bg-overlay backdrop-blur-[2px] motion-reduce:backdrop-blur-none',
            'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
          )}
        />
        <Dialog.Content
          className={cn(
            // Center with flex + inset (not translate); modalMotion is scale-only.
            'fixed inset-0 z-[230] m-auto h-fit w-[min(24rem,calc(100vw-2rem))]',
            'rounded-xl border border-border bg-surface p-5 shadow-overlay outline-none',
            'data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out',
          )}
          data-testid="keyboard-shortcuts-dialog"
        >
          <Dialog.Title className="text-body font-semibold tracking-tight text-ink">
            {t('commandPalette.shortcuts.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-meta text-ink-secondary">
            {t('commandPalette.shortcuts.description')}
          </Dialog.Description>
          <div className="mt-4 space-y-1">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 text-body">
                <span className="text-ink-secondary">{t(e.labelKey)}</span>
                <kbd className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-caption text-ink-tertiary">
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
