import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
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
}

/**
 * Settings banner for notable extension conflicts from ExtensionRegistry.
 * Offers one-click remediations for common MCP capability duplicates.
 */
export function ExtensionConflictsBanner({ cwd, className }: ExtensionConflictsBannerProps) {
  const { t } = useTranslation()
  const notable = useExtensionStore((s) => s.notableConflicts)
  const loading = useExtensionStore((s) => s.loading)
  const error = useExtensionStore((s) => s.error)
  const inspect = useExtensionStore((s) => s.inspect)
  const servers = useMcpServers()
  const updateSection = useHipConfigStore((s) => s.updateSection)

  useEffect(() => {
    void inspect(cwd)
  }, [inspect, cwd])

  const refresh = async () => {
    await inspect(cwd)
    try {
      wsClient.send({ type: 'plugin:reload' })
    } catch {
      /* offline */
    }
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

  if (!loading && notable.length === 0 && !error) return null

  return (
    <div
      className={cn(
        'rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100',
        className,
      )}
      role="status"
      data-testid="extension-conflicts-banner"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-medium">
            {t('settings.extensions.conflictsTitle', {
              defaultValue: 'Extension conflicts',
            })}
            {loading ? '…' : ` (${notable.length})`}
          </div>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <ul className="list-inside list-disc space-y-1 text-xs opacity-90">
            {notable.slice(0, 6).map((c, i) => (
              <li key={`${c.kind}-${i}`}>{conflictLabel(c)}</li>
            ))}
            {notable.length > 6 && (
              <li>
                {t('settings.extensions.moreConflicts', {
                  count: notable.length - 6,
                  defaultValue: `+{{count}} more`,
                })}
              </li>
            )}
          </ul>
          <p className="text-xs opacity-80">
            {t('settings.extensions.conflictsHint', {
              defaultValue:
                'By default only one MCP per capability stays active (user config wins). Allow both only if you need isolated sessions.',
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('settings.extensions.refresh', { defaultValue: 'Refresh' })}
            </Button>
            {notable
              .filter((c) => c.kind === 'mcp_capability_duplicate')
              .slice(0, 2)
              .map((c, i) => {
                const winnerId = c.winner.configId
                const loserId = c.loser.configId
                const userId =
                  servers.find((s) => s.id === winnerId)?.id ??
                  servers.find((s) => s.id === loserId)?.id
                if (!userId) return null
                return (
                  <div key={`remediate-${i}`} className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
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
                      onClick={() => void disableUserMcp(userId)}
                    >
                      {t('settings.extensions.preferPlugin', {
                        defaultValue: 'Disable user MCP',
                      })}
                    </Button>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
