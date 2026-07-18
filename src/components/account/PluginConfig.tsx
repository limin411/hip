import { useTranslation } from 'react-i18next'
import type { PluginMeta } from '@hip/protocol'
import { PluginConfigView, type Translate } from './PluginConfigView'

/**
 * Settings → 插件市场.
 * Built-in catalog only; install / user-added plugins are not supported here.
 * Catalog is empty until marketplace source management is implemented.
 */
export function PluginConfig() {
  const { t } = useTranslation()
  // Placeholder: built-in marketplace entries will be wired in a later phase.
  const plugins: PluginMeta[] = []

  return <PluginConfigView plugins={plugins} t={t as Translate} />
}
