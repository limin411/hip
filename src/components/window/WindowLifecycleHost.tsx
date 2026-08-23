import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useDomainStore } from '@/domain'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'
import {
  syncActiveEditorToDraft,
  useKnowledgeStore,
} from '@/store/knowledgeStore'
import { countActiveWork } from '@/lib/activeWork'
import {
  isMainWindowVisible,
  listenClosePrompt,
  listenExitConfirm,
  listenOpenSettings,
  listenWindowHidden,
  setWindowPolicy,
  traySetLabels,
  traySetStatus,
  windowCancelExit,
  windowCloseDecision,
  windowExitHideInstead,
  windowForceQuit,
} from '@/ipc/windowPolicy'
import { openSettingsOverlay } from '@/components/layout/sidebarActions'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { useUiStore } from '@/store/uiStore'
import { useUpdatesStore } from '@/store/updatesStore'
import { listenUpdatesAvailable, listenUpdatesProgress } from '@/ipc/updates'
import { toast } from 'sonner'

/**
 * Phase 2 host: first-close / ask dialog, exit confirm when work is running,
 * first-hide notification, and throttled tray tooltip updates.
 */
export function WindowLifecycleHost() {
  const { t } = useTranslation()
  const [closeOpen, setCloseOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [unsavedOpen, setUnsavedOpen] = useState(false)
  const [remember, setRemember] = useState(true)
  const [pick, setPick] = useState<'hide' | 'quit'>('hide')
  const [work, setWork] = useState(() => countActiveWork())
  /** After unsaved dialog: continue to first-close policy prompt. */
  const [pendingPolicyPrompt, setPendingPolicyPrompt] = useState(false)

  const updateSection = useHipConfigStore((s) => s.updateSection)

  // Flush knowledge buffer before hide/quit when dirty.
  const flushKnowledgeIfNeeded = useCallback(async (): Promise<boolean> => {
    try {
      syncActiveEditorToDraft({ leaveActiveLeaf: false })
      const store = useKnowledgeStore.getState()
      if (!store.hasUnsavedChanges()) return true
      return await store.flushSave()
    } catch {
      return false
    }
  }, [])

  // beforeunload for browser/dev: prompt when knowledge dirty
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        if (useKnowledgeStore.getState().hasUnsavedChanges()) {
          e.preventDefault()
          e.returnValue = ''
        }
      } catch {
        // ignore
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ── Shell events ──────────────────────────────────────────────
  useEffect(() => {
    let unsubs: Array<() => void> = []
    let cancelled = false
    void (async () => {
      try {
        const u1 = await listenClosePrompt(() => {
          if (cancelled) return
          // If knowledge has unsaved changes, intercept first.
          try {
            syncActiveEditorToDraft({ leaveActiveLeaf: false })
            if (useKnowledgeStore.getState().hasUnsavedChanges()) {
              setPendingPolicyPrompt(true)
              setUnsavedOpen(true)
              return
            }
          } catch {
            // fall through
          }
          setPick('hide')
          setRemember(true)
          setCloseOpen(true)
        })
        const u2 = await listenExitConfirm(() => {
          if (cancelled) return
          const w = countActiveWork()
          if (w.total === 0) {
            void windowForceQuit()
            return
          }
          setWork(w)
          setExitOpen(true)
        })
        const u3 = await listenWindowHidden(() => {
          if (cancelled) return
          void handleFirstHideHint()
        })
        const u4 = await listenOpenSettings(() => {
          if (cancelled) return
          openSettingsOverlay() // tray/menu → General
        })
        // Update events are process-level (NOT mounted under the settings
        // tree): progress survives unmount, and the wake loop result lands in
        // the store even when the settings page is closed.
        const u5 = await listenUpdatesProgress((p) => {
          if (cancelled) return
          useUpdatesStore.getState().setProgress(p)
        })
        const u6 = await listenUpdatesAvailable((r) => {
          if (cancelled) return
          // Always write the store first — an open General page must update
          // even though we skip the toast (KD-13).
          useUpdatesStore.getState().setLastResult(r)
          const { overlay, settingsPage } = useUiStore.getState()
          if (overlay === 'settings' && settingsPage === 'general') {
            return
          }
          toast(t('settings.updates.toastTitle', { tag: r.latestTag ?? '' }), {
            action: {
              label: t('settings.updates.toastAction'),
              onClick: () => openSettingsOverlay(), // no page → General
            },
            cancel: {
              label: t('settings.updates.toastSnooze'),
              // "Later" only closes the toast — snooze state is Rust-side.
              onClick: () => {},
            },
          })
        })
        if (cancelled) {
          u1()
          u2()
          u3()
          u4()
          u5()
          u6()
        } else {
          unsubs = [u1, u2, u3, u4, u5, u6]
        }
      } catch {
        /* non-tauri */
      }
    })()
    return () => {
      cancelled = true
      for (const u of unsubs) u()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  // ── Agent complete notification while hidden (Phase 3) ────────
  useEffect(() => {
    const prev = new Map<string, string>()
    for (const s of useDomainStore.getState().sessions) {
      prev.set(s.id, s.status)
    }
    return useDomainStore.subscribe((state) => {
      const cfg = useHipConfigStore.getState().config.window
      if (cfg?.notifyOnAgentComplete === false) return
      for (const s of state.sessions) {
        const was = prev.get(s.id)
        prev.set(s.id, s.status)
        if (was !== 'running') continue
        if (s.status !== 'idle' && s.status !== 'error') continue
        void (async () => {
          const visible = await isMainWindowVisible()
          if (visible) return
          try {
            if (typeof Notification === 'undefined') return
            if (Notification.permission === 'denied') return
            if (Notification.permission !== 'granted') {
              const p = await Notification.requestPermission()
              if (p !== 'granted') return
            }
            const title =
              s.status === 'error'
                ? t('tray.agentFailedTitle')
                : t('tray.agentCompleteTitle')
            const body =
              s.status === 'error'
                ? t('tray.agentFailedBody', { title: s.title || s.id })
                : t('tray.agentCompleteBody', { title: s.title || s.id })
            const n = new Notification(title, { body })
            n.onclick = () => {
              void import('@/ipc/windowPolicy').then((m) => m.showMainWindow())
            }
          } catch {
            /* ignore */
          }
        })()
      }
    })
  }, [t])

  const handleFirstHideHint = useCallback(async () => {
    const cfg = useHipConfigStore.getState().config
    if (cfg.window?.hideHintShown) return
    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          new Notification(t('tray.hideHintTitle'), { body: t('tray.hideHintBody') })
        } else if (Notification.permission !== 'denied') {
          const perm = await Notification.requestPermission()
          if (perm === 'granted') {
            new Notification(t('tray.hideHintTitle'), { body: t('tray.hideHintBody') })
          }
        }
      }
    } catch {
      /* ignore */
    }
    void updateSection('window', (prev) => ({ ...(prev ?? {}), hideHintShown: true }))
  }, [t, updateSection])

  // ── Tray menu + tooltip i18n ──────────────────────────────────
  useEffect(() => {
    void traySetLabels({
      showMain: t('tray.showMain'),
      openSettings: t('tray.openSettings'),
      quit: t('tray.quit'),
      tooltipIdle: t('tray.tooltipIdle'),
    })
  }, [t])

  // ── Tray tooltip (throttled, localized) ───────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const push = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const w = countActiveWork()
        const label =
          w.runningSessions > 0 || w.runningTasks > 0
            ? t('tray.tooltipRunning', {
                agents: w.runningSessions,
                tasks: w.runningTasks,
              })
            : t('tray.tooltipIdle')
        void traySetStatus({
          runningAgents: w.runningSessions,
          runningTasks: w.runningTasks,
          label,
        })
      }, 500)
    }
    push()
    const unsubDomain = useDomainStore.subscribe(push)
    const unsubTasks = useTaskRuntimeStore.subscribe(push)
    return () => {
      unsubDomain()
      unsubTasks()
      if (timer) clearTimeout(timer)
    }
  }, [t])

  // ── Close prompt actions ──────────────────────────────────────
  const onCloseConfirm = async () => {
    setCloseOpen(false)
    // Silent flush before hide/quit so buffers are not lost.
    await flushKnowledgeIfNeeded()
    if (remember) {
      const trayEnabled = pick === 'hide' ? true : useHipConfigStore.getState().config.window?.trayEnabled === true
      await updateSection('window', (prev) => ({
        ...(prev ?? {}),
        closeAction: pick,
        trayEnabled,
        closePromptSeen: true,
      }))
      void setWindowPolicy(pick, trayEnabled, true)
    }
    // Shell applies hide/quit (and may still exit-confirm on quit).
    void windowCloseDecision(pick, remember)
  }

  const onCloseCancel = () => {
    setCloseOpen(false)
  }

  const onUnsavedSave = async () => {
    setUnsavedOpen(false)
    const ok = await flushKnowledgeIfNeeded()
    if (!ok) return
    if (pendingPolicyPrompt) {
      setPendingPolicyPrompt(false)
      setPick('hide')
      setRemember(true)
      setCloseOpen(true)
    }
  }

  const onUnsavedDiscard = () => {
    setUnsavedOpen(false)
    // Drop dirty buffer so close is not blocked again.
    const st = useKnowledgeStore.getState()
    if (st.activeDocId) {
      useKnowledgeStore.setState({ draftBody: st.docBody, saveState: 'idle' })
    }
    if (pendingPolicyPrompt) {
      setPendingPolicyPrompt(false)
      setPick('hide')
      setRemember(true)
      setCloseOpen(true)
    }
  }

  const onUnsavedCancel = () => {
    setUnsavedOpen(false)
    setPendingPolicyPrompt(false)
  }

  // ── Exit confirm actions ──────────────────────────────────────
  const onExitQuit = () => {
    setExitOpen(false)
    void (async () => {
      await flushKnowledgeIfNeeded()
      void windowForceQuit()
    })()
  }

  const onExitHide = () => {
    setExitOpen(false)
    void (async () => {
      await flushKnowledgeIfNeeded()
      void windowExitHideInstead()
    })()
  }

  const onExitCancel = () => {
    setExitOpen(false)
    void windowCancelExit()
  }

  return (
    <>
      <Modal
        open={unsavedOpen}
        onOpenChange={(o) => {
          if (!o) onUnsavedCancel()
        }}
        title={t('dialog.unsavedTitle')}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnsavedCancel}
              data-testid="unsaved-prompt-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnsavedDiscard}
              data-testid="unsaved-prompt-discard"
            >
              {t('dialog.unsavedDiscard')}
            </Button>
            <Button
              size="sm"
              onClick={() => void onUnsavedSave()}
              data-testid="unsaved-prompt-save"
            >
              {t('dialog.unsavedSave')}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 px-5 py-4" data-testid="unsaved-prompt-dialog">
          <p className="text-body text-ink">{t('dialog.unsavedBody')}</p>
        </div>
      </Modal>

      <Modal
        open={closeOpen}
        onOpenChange={(o) => {
          if (!o) onCloseCancel()
        }}
        title={t('dialog.closeWindowTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCloseCancel} data-testid="close-prompt-cancel">
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void onCloseConfirm()} data-testid="close-prompt-confirm">
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-5 py-4" data-testid="close-prompt-dialog">
          <p className="text-meta text-ink-secondary">{t('dialog.closeWindowBody')}</p>
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 hover:bg-state-hover">
              <input
                type="radio"
                name="close-action"
                checked={pick === 'hide'}
                onChange={() => setPick('hide')}
                className="mt-1"
                data-testid="close-prompt-hide"
              />
              <span>
                <span className="block text-body font-medium text-ink">{t('settings.closeActions.hide')}</span>
                <span className="block text-meta text-ink-tertiary">{t('dialog.closeWindowHideHint')}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 hover:bg-state-hover">
              <input
                type="radio"
                name="close-action"
                checked={pick === 'quit'}
                onChange={() => setPick('quit')}
                className="mt-1"
                data-testid="close-prompt-quit"
              />
              <span className="block text-body font-medium text-ink">{t('settings.closeActions.quit')}</span>
            </label>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-body text-ink">{t('dialog.closeWindowRemember')}</span>
            <Switch
              checked={remember}
              onCheckedChange={setRemember}
              data-testid="close-prompt-remember"
              ariaLabel={t('dialog.closeWindowRemember')}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={exitOpen}
        onOpenChange={(o) => {
          if (!o) onExitCancel()
        }}
        title={t('dialog.exitConfirmTitle')}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onExitCancel} data-testid="exit-confirm-cancel">
              {t('common.cancel')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onExitHide} data-testid="exit-confirm-hide">
              {t('dialog.exitConfirmHide')}
            </Button>
            <Button size="sm" onClick={onExitQuit} data-testid="exit-confirm-quit">
              {t('dialog.exitConfirmQuit')}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 px-5 py-4" data-testid="exit-confirm-dialog">
          <p className="text-body text-ink">{t('dialog.exitConfirmBody')}</p>
          <ul className="list-inside list-disc text-meta text-ink-secondary">
            {work.runningSessions > 0 ? (
              <li>{t('dialog.exitConfirmSessions', { count: work.runningSessions })}</li>
            ) : null}
            {work.runningTasks > 0 ? (
              <li>{t('dialog.exitConfirmTasks', { count: work.runningTasks })}</li>
            ) : null}
          </ul>
        </div>
      </Modal>
    </>
  )
}
