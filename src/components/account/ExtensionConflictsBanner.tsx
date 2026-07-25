import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ExtensionConflict, McpServerConfig } from '@hip/protocol'
import { useExtensionStore } from '@/store/extensionStore'
import { useHipConfigStore, useMcpServers } from '@/store/hipConfigStore'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { wsClient } from '@/ipc/ws-client'

function conflictLabel(c: ExtensionConflict): string {
  switch (c.kind) {
    case 'mcp_capability_duplicate':
      return `MCP capability duplicate (${c.fingerprint ?? 'unknown'})`
    case 'mcp_id_shadow':
      return `MCP id "${c.winner.configId ?? c.loser.configId ?? '?'}" shadowed`
    case 'mcp_name_veto':
      return `MCP id "${c.winner.configId ?? '?'}" disabled (veto)`
    case 'skill_id_shadow':
      return `Skill "${c.winner.configId ?? c.loser.configId ?? '?'}" shadowed`
    case 'skill_disabled':
      return `Skill "${c.winner.configId ?? '?'}" disabled`
    default:
      return c.message
  }
}

export interface ExtensionConflictsBannerProps {
  /** Project cwd for inspect; omit for sidecar default. */
  cwd?: string
  className?: string
  /**
   * When true (default), show a compact remediation strip only if there are
   * actionable capability conflicts. Loading and errors never render here —
   * those go to bottom-right toasts via extensionStore.
   */
  showRemediation?: boolean
}

/**
 * Settings helper: loads extension registry (toasts load/errors + conflict summary
 * bottom-right). Optionally shows a compact remediation strip for MCP capability
 * duplicates — never a full-page loading/error banner.
 */
export function ExtensionConflictsBanner({
  cwd,
  className,
  showRemediation = true,
}: ExtensionConflictsBannerProps) {
  const { t } = useTranslation()
  const notable = useExtensionStore((s) => s.notableConflicts)
  const loading = useExtensionStore((s) => s.loading)
  const inspect = useExtensionStore((s) => s.inspect)
  const servers = useMcpServers()
  const updateSection = useHipConfigStore((s) => s.updateSection)

  useEffect(() => {
    void inspect(cwd)
  }, [inspect, cwd])

  const refresh = async () => {
    await inspect(cwd, { force: true })
    try {
      wsClient.send({ type: 'plugin:reload' })
    } catch {
      /* offline */
    }
    toast.message(
      t('settings.extensions.refreshed', { defaultValue: 'Extension registry refreshed' }),
      { duration: 2_500 },
    )
  }

  /** Keep user MCP, allow duplicate so both can run (explicit opt-in). */
  const allowDuplicateFor = async (id: string) => {
    await updateSection('mcpServers', (prev) =>
      (prev ?? []).map((s: McpServerConfig) =>
        s.id === id ? { ...s, allowDuplicate: true } : s,
      ),
    )
    await refresh()
  }

  /** Disable user MCP so plugin MCP can fill capability after reload. */
  const disableUserMcp = async (id: string) => {
    await updateSection('mcpServers', (prev) =>
      (prev ?? []).map((s: McpServerConfig) =>
        s.id === id ? { ...s, enabled: false } : s,
      ),
    )
    await refresh()
  }

  const capabilityConflicts = notable.filter((c) => c.kind === 'mcp_capability_duplicate')
  const actionable = capabilityConflicts
    .map((c) => {
      const winnerId = c.winner.configId
      const loserId = c.loser.configId
      const userId =
        servers.find((s) => s.id === winnerId)?.id ??
        servers.find((s) => s.id === loserId)?.id
      return userId ? { conflict: c, userId } : null
    })
    .filter((x): x is { conflict: ExtensionConflict; userId: string } => x != null)

  // Loading / errors / empty: nothing on-page (toasts handle status).
  if (!showRemediation || actionable.length === 0) return null

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface-subtle/60 px-3 py-2 text-xs text-ink-secondary',
        className,
      )}
      role="status"
      data-testid="extension-conflicts-banner"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink">
          {t('settings.extensions.remediationHint', {
            defaultValue: 'Resolve MCP capability overlap:',
          })}
        </span>
        {actionable.slice(0, 2).map(({ userId }, i) => (
          <div key={`remediate-${userId}-${i}`} className="flex flex-wrap gap-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() => void allowDuplicateFor(userId)}
            >
              {t('settings.extensions.allowBoth', {
                defaultValue: 'Allow both',
              })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => void disableUserMcp(userId)}
            >
              {t('settings.extensions.preferPlugin', {
                defaultValue: 'Disable user MCP',
              })}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {t('settings.extensions.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>
      <ul className="mt-1.5 list-inside list-disc space-y-0.5 opacity-80">
        {notable.slice(0, 3).map((c, i) => (
          <li key={`${c.kind}-${i}`}>{conflictLabel(c)}</li>
        ))}
      </ul>
    </div>
  )
}
