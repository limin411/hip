import { useTranslation } from 'react-i18next'
import { KeyRound, FolderOpen, MessageSquare, CheckCircle2 } from 'lucide-react'
import { useProvidersStore } from '@/store/providersStore'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'
import { pickDirectory } from '@/ipc/dialog'
import { useDraftStore } from '@/store/draftStore'
import { cn } from '@/lib/utils'

/**
 * Empty-conversation onboarding:
 * - No API key → full three-step setup
 * - Code surface + has key but no folder → folder-focused card
 * Hidden once the user can actually send.
 */
export function FirstRunSetupCard({
  surface,
  hasFolder = false,
}: {
  surface: 'chat' | 'code'
  /** Code: project folder already bound on draft. */
  hasFolder?: boolean
}) {
  const { t } = useTranslation()
  const loaded = useProvidersStore((s) => s.loaded)
  const keyConfigured = useProvidersStore((s) => s.keyConfigured)
  const hasKey = Object.values(keyConfigured).some(Boolean)

  if (!loaded) return null

  // Ready to work: chat with key, or code with key + folder.
  if (hasKey && (surface === 'chat' || hasFolder)) return null

  const openModels = () => {
    useUiStore.getState().setSettingsPage('model')
    useUiStore.getState().setActiveView('settings')
  }

  const pickFolder = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    useDraftStore.getState().pickProject(dir)
  }

  // Path B: key ok, Code needs folder.
  if (hasKey && surface === 'code' && !hasFolder) {
    return (
      <div
        className="mb-6 rounded-xl border border-border bg-surface-muted/40 px-4 py-4"
        data-testid="first-run-setup"
        data-variant="code-folder"
        role="region"
        aria-label={t('chat.firstRun.folderTitle')}
      >
        <div className="text-body font-medium text-ink">{t('chat.firstRun.folderTitle')}</div>
        <p className="mt-1 text-meta text-ink-secondary">{t('chat.firstRun.folderSubtitle')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" data-testid="first-run-pick-folder" onClick={() => void pickFolder()}>
            <FolderOpen size={14} strokeWidth={1.75} className="mr-1.5" aria-hidden />
            {t('chat.firstRun.folderCta')}
          </Button>
        </div>
      </div>
    )
  }

  // Path A: no key — three steps.
  const steps = [
    {
      icon: KeyRound,
      title: t('chat.firstRun.step1Title'),
      body: t('chat.firstRun.step1Body'),
      done: false,
      action: (
        <Button size="sm" data-testid="first-run-add-key" onClick={openModels}>
          {t('chat.firstRun.step1Cta')}
        </Button>
      ),
    },
    {
      icon: surface === 'code' ? FolderOpen : MessageSquare,
      title:
        surface === 'code'
          ? t('chat.firstRun.step2CodeTitle')
          : t('chat.firstRun.step2ChatTitle'),
      body:
        surface === 'code'
          ? t('chat.firstRun.step2CodeBody')
          : t('chat.firstRun.step2ChatBody'),
      done: false,
      action:
        surface === 'code' ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="first-run-pick-folder"
            onClick={() => void pickFolder()}
          >
            {t('chat.firstRun.folderCta')}
          </Button>
        ) : undefined,
    },
    {
      icon: MessageSquare,
      title: t('chat.firstRun.step3Title'),
      body: t('chat.firstRun.step3Body'),
      done: false,
    },
  ] as const

  return (
    <div
      className="mb-6 rounded-xl border border-border bg-surface-muted/40 px-4 py-4"
      data-testid="first-run-setup"
      data-variant="no-key"
      role="region"
      aria-label={t('chat.firstRun.title')}
    >
      <div className="text-body font-medium text-ink">{t('chat.firstRun.title')}</div>
      <p className="mt-1 text-meta text-ink-secondary">{t('chat.firstRun.subtitle')}</p>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => {
          const Icon = step.icon
          return (
            <li key={i} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface text-ink-secondary',
                )}
                aria-hidden
              >
                {step.done ? (
                  <CheckCircle2 size={14} strokeWidth={1.75} className="text-success" />
                ) : (
                  <Icon size={14} strokeWidth={1.75} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-meta font-medium text-ink">
                  <span className="mr-1.5 tabular-nums text-ink-tertiary">{i + 1}.</span>
                  {step.title}
                </div>
                <p className="mt-0.5 text-caption text-ink-secondary">{step.body}</p>
                {'action' in step && step.action ? (
                  <div className="mt-2">{step.action}</div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
