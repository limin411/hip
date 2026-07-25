import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { ExtensionPreflightSummary } from '@/store/extensionStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface PreflightEnableModalProps {
  open: boolean
  summary: ExtensionPreflightSummary | null
  pluginName?: string
  busy?: boolean
  onCancel: () => void
  /** Enable anyway despite conflicts. */
  onConfirm: () => void
}

/**
 * Confirm dialog when enabling a plugin would introduce skill/MCP conflicts.
 * Default resolution still applies (project/user win); this explains the outcome.
 */
export function PreflightEnableModal({
  open,
  summary,
  pluginName,
  busy,
  onCancel,
  onConfirm,
}: PreflightEnableModalProps) {
  const { t } = useTranslation()
  if (!summary) return null

  const title = t('settings.extensions.preflightTitle', {
    defaultValue: 'Plugin conflicts detected',
  })

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onCancel()
      }}
      title={title}
      closeDisabled={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={busy} onClick={onConfirm}>
            {t('settings.extensions.enableAnyway', { defaultValue: 'Enable anyway' })}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-ink">
        <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {t('settings.extensions.preflightBody', {
              name: pluginName || summary.pluginId,
              defaultValue:
                'Enabling “{{name}}” overlaps existing skills or MCP servers. hip keeps project/user skills and user MCP over plugin duplicates unless you change settings.',
            })}
          </p>
        </div>
        <ul className="list-inside list-disc space-y-1 text-xs text-ink-secondary">
          {summary.skillConflictCount > 0 && (
            <li>
              {t('settings.extensions.preflightSkills', {
                count: summary.skillConflictCount,
                defaultValue: '{{count}} skill id conflict(s)',
              })}
              {summary.skillConflicts.length > 0 && (
                <span className="ml-1 opacity-80">
                  ({summary.skillConflicts.map((c) => c.skillId).join(', ')})
                </span>
              )}
            </li>
          )}
          {summary.mcpIdConflictCount > 0 && (
            <li>
              {t('settings.extensions.preflightMcpId', {
                count: summary.mcpIdConflictCount,
                defaultValue: '{{count}} MCP id conflict(s)',
              })}
              {summary.mcpIdConflicts.length > 0 && (
                <span className="ml-1 opacity-80">
                  ({summary.mcpIdConflicts.map((c) => c.id).join(', ')})
                </span>
              )}
            </li>
          )}
          {summary.capabilityConflictCount > 0 && (
            <li>
              {t('settings.extensions.preflightCapability', {
                count: summary.capabilityConflictCount,
                defaultValue: '{{count}} MCP capability conflict(s)',
              })}
              {summary.capabilityConflicts.length > 0 && (
                <span className="ml-1 opacity-80">
                  (
                  {summary.capabilityConflicts
                    .map((c) => `${c.existingId}↔${c.incomingId}`)
                    .join('; ')}
                  )
                </span>
              )}
            </li>
          )}
        </ul>
        <p className="text-xs text-ink-secondary">
          {t('settings.extensions.preflightFooter', {
            defaultValue:
              'After enable, open External tool services for Allow both / Disable user MCP remediations.',
          })}
        </p>
      </div>
    </Modal>
  )
}
