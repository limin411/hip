import { useTranslation } from 'react-i18next'
import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Settings → Key Management placeholder. Feature is not implemented yet.
 */
export function KeyManagementSettings() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="settings-key-management-page">
      <EmptyState
        icon={Construction}
        tier="professional"
        title={t('settings.keyManagementLabel')}
        description={t('placeholder.comingSoon')}
        className="flex-1"
        data-testid="settings-key-management-empty"
      />
    </div>
  )
}
