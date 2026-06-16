import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { HELP_SECTIONS, helpSectionById } from '@/lib/agentHelp'
import { cn } from '@/lib/utils'

/** Right-anchored, non-modal help drawer with a section mini-nav. Deep-linkable via `sectionId`. */
export function AgentHelpDrawer({
  open,
  sectionId,
  onOpenChange,
}: {
  open: boolean
  sectionId?: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<string>(sectionId ?? 'overview')
  useEffect(() => {
    if (open) setCurrent(sectionId ?? 'overview')
  }, [open, sectionId])

  const section = helpSectionById(current) ?? HELP_SECTIONS[0]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        {open && (
          <div className="pointer-events-auto fixed inset-0 z-40 bg-ink/30" onClick={() => onOpenChange(false)} />
        )}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className="pointer-events-auto fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-[92vw] flex-col border-l border-border bg-surface shadow-xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="text-body font-semibold text-ink">{t('settings.agents.help.title')}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1">
            <nav className="w-[136px] shrink-0 overflow-y-auto border-r border-border py-2">
              {HELP_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setCurrent(s.id)}
                  className={cn(
                    'block w-full px-3 py-1.5 text-left text-caption transition-colors',
                    s.id.startsWith('acp-') && 'pl-5',
                    s.id === current ? 'font-medium text-accent-strong' : 'text-ink-secondary hover:text-ink',
                  )}
                >
                  {t(s.titleKey)}
                  {s.status === 'coming-soon' && <span className="ml-1 text-ink-tertiary">· {t('settings.agents.acpPresetComingSoon')}</span>}
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              <h3 className="text-title font-semibold text-ink">{t(section.titleKey)}</h3>
              <div className="mt-3 space-y-3">
                {section.bodyKeys.map((key) => (
                  <p key={key} className="whitespace-pre-line text-body leading-relaxed text-ink-secondary">{t(key)}</p>
                ))}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
