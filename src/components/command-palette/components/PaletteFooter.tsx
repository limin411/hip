import { useTranslation } from 'react-i18next'

export function PaletteFooter({ showBack }: { showBack?: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="global-command-palette-footer"
      className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-caption text-ink-tertiary"
    >
      <span>
        <kbd className="font-mono">↑↓</kbd> {t('commandPalette.footer.navigate')}
      </span>
      <span>
        <kbd className="font-mono">↵</kbd> {t('commandPalette.footer.run')}
      </span>
      {showBack ? (
        <span>
          <kbd className="font-mono">⌫</kbd> {t('commandPalette.footer.back')}
        </span>
      ) : (
        <span>
          <kbd className="font-mono">esc</kbd> {t('commandPalette.footer.close')}
        </span>
      )}
    </div>
  )
}
