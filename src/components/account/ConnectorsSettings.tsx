import { useTranslation } from 'react-i18next'
import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Settings → Connectors placeholder. Feature is not implemented yet.
 */
export function ConnectorsSettings() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="settings-connectors-page">
      <EmptyState
        icon={Construction}
        tier="professional"
        title={t('settings.connectorsLabel')}
        description={t('placeholder.comingSoon')}
        className="flex-1"
        data-testid="settings-connectors-empty"
      />
    </div>
  )
}
