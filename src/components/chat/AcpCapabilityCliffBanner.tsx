import { useMemo } from 'react'
import { create } from 'zustand'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { useAgents, useHipConfigStore } from '@/store/hipConfigStore'
import { isExternalPrimary } from '@/lib/sessionAgent'
import { Button } from '@/components/ui/Button'
import { ActionBanner } from '@/components/ui/ActionBanner'

/** Session-local dismiss keys: `${scopeId}:${agentId}` — agent change re-shows the banner. */
interface CliffDismissState {
  dismissed: Record<string, true>
  dismiss: (key: string) => void
}

export const useCliffDismissStore = create<CliffDismissState>((set) => ({
  dismissed: {},
  dismiss: (key) => set((s) => (s.dismissed[key] ? s : { dismissed: { ...s.dismissed, [key]: true } })),
}))

function dismissKey(scopeId: string, agentId: string): string {
  return `${scopeId}:${agentId}`
}

/**
 * Sticky banner above the composer when the primary runtime is an external ACP agent.
 * Shows capability cliff (no hip tools/skills/delegation) and MCP forward status.
 */
export function AcpCapabilityCliffBanner() {
  const { t } = useTranslation()
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const draft = useDraftStore((s) => s.draft)
  const agents = useAgents()
  const forwardMcp = useHipConfigStore((s) => s.config.acp?.forwardMcp === true)
  const dismissed = useCliffDismissStore((s) => s.dismissed)
  const dismiss = useCliffDismissStore((s) => s.dismiss)

  const resolved = useMemo(() => {
    if (activeId && session) {
      const agentId = session.config.agentId
      if (!isExternalPrimary(agentId)) return null
      const name = agents.find((a) => a.id === agentId)?.name ?? agentId!
      return { scopeId: activeId, agentId: agentId!, agentName: name }
    }
    // Draft new-conversation surface
    const agentId = draft?.agentId
    if (!isExternalPrimary(agentId) || !draft) return null
    const name = agents.find((a) => a.id === agentId)?.name ?? agentId!
    return { scopeId: `draft:${draft.tempId}`, agentId: agentId!, agentName: name }
  }, [activeId, session, draft, agents])

  if (!resolved) return null

  const key = dismissKey(resolved.scopeId, resolved.agentId)
  if (dismissed[key]) return null

  return (
    <ActionBanner
      tone="warning"
      role="status"
      data-testid="acp-capability-cliff-banner"
      title={t('chat.acpCliff.title')}
      description={t('chat.acpCliff.body', { name: resolved.agentName })}
      meta={forwardMcp ? t('chat.acpCliff.mcpOn') : t('chat.acpCliff.mcpOff')}
      actions={
        <Button
          size="sm"
          variant="ghost"
          data-testid="acp-cliff-dismiss"
          onClick={() => dismiss(key)}
        >
          {t('chat.acpCliff.dismiss')}
        </Button>
      }
    />
  )
}
