import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcpHostConfig } from '@hip/protocol'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { Switch } from '@/components/ui/Switch'

/**
 * ACP host policy block for Settings → Agent Management.
 * Writes `[acp]` in hip.toml via hipConfigStore (must survive Rust set_hip_config rewrites).
 */
export function AcpHostPolicySection() {
  const { t } = useTranslation()
  const acp = useHipConfigStore((s) => s.config.acp)
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const loadHipConfig = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)
  const error = useHipConfigStore((s) => s.error)

  useEffect(() => {
    if (!hipLoaded) void loadHipConfig()
  }, [hipLoaded, loadHipConfig])

  const forwardMcp = acp?.forwardMcp === true
  // Resolved default true when unset (matches sidecar resolveAcpHostConfig).
  const fsBridge = acp?.fsBridge !== false

  const patchAcp = (patch: Partial<AcpHostConfig>) => {
    void updateSection('acp', (prev) => ({ ...(prev ?? {}), ...patch }))
  }

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4"
      data-testid="acp-settings"
    >
      <div className="mb-3">
        <h3 className="text-caption font-medium text-ink-tertiary">
          {t('settings.acp.sectionTitle')}
        </h3>
        <p className="mt-1 text-meta text-ink-tertiary">{t('settings.acp.intro')}</p>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
          {error}
        </div>
      ) : null}

      <div
        className="flex items-center justify-between gap-4 py-3"
        data-testid="acp-settings-forward-mcp"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.acp.forwardMcp')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">
            {t('settings.acp.forwardMcpHint')}
          </div>
          {forwardMcp ? (
            <p className="mt-1.5 text-caption text-warning" data-testid="acp-forward-mcp-warning">
              {t('settings.acp.forwardMcpWarning')}
            </p>
          ) : null}
        </div>
        <Switch
          checked={forwardMcp}
          disabled={!hipLoaded}
          ariaLabel={t('settings.acp.forwardMcp')}
          data-testid="acp-switch-forward-mcp"
          onCheckedChange={(v) => patchAcp({ forwardMcp: v })}
        />
      </div>

      <div
        className="flex items-center justify-between gap-4 border-t border-border py-3"
        data-testid="acp-settings-fs-bridge"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.acp.fsBridge')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.acp.fsBridgeHint')}</div>
        </div>
        <Switch
          checked={fsBridge}
          disabled={!hipLoaded}
          ariaLabel={t('settings.acp.fsBridge')}
          data-testid="acp-switch-fs-bridge"
          onCheckedChange={(v) => patchAcp({ fsBridge: v })}
        />
      </div>
    </section>
  )
}
