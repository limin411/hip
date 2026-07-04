import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'

export type SessionFilter = 'all' | 'chat' | 'code'

interface SessionFiltersProps {
  value: SessionFilter
  onChange: (value: SessionFilter) => void
}

export function SessionFilters({ value, onChange }: SessionFiltersProps) {
  const { t } = useTranslation()
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as SessionFilter)}>
      <TabsList>
        <TabsTrigger value="all">{t('sidebar.filterAll')}</TabsTrigger>
        <TabsTrigger value="chat">{t('sidebar.filterChat')}</TabsTrigger>
        <TabsTrigger value="code">{t('sidebar.filterCode')}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
