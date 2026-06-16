import { useTranslation } from 'react-i18next'
import { Cpu, Lock, Check } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuGroup } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { groupModelOptions } from '@/lib/agentModelOptions'
import { parseModelKey, activeModelKey } from '@/lib/modelKey'
import { cn } from '@/lib/utils'

/** Pure: groups for the dropdown. */
export const modelPickerItems = groupModelOptions
/** Pure: label for a model key. */
export function currentModelLabel(key: string): string {
  return key ? parseModelKey(key).modelID : ''
}

export function ModelPicker() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const setModelKey = useDraftStore((s) => s.setModelKey)
  // Separate selectors (matching AgentPicker) avoid a new object each render / useShallow.
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  // Committed session: locked read-only model badge. Legacy sessions may have no stored model.
  if (activeId && session) {
    const model = session.config.model
    return (
      <ComposerChip disabled active={!!model} title={t('chat.modelLocked')} data-testid="model-chip-locked">
        <Cpu size={13} className="shrink-0" aria-hidden />
        <span className="max-w-[140px] truncate">{model || t('chat.modelUnknown')}</span>
        <Lock size={11} className="shrink-0 opacity-60" aria-hidden />
      </ComposerChip>
    )
  }

  // Draft: interactive model picker.
  const groups = groupModelOptions(catalog, config)
  const currentKey = draft?.modelKey ?? activeModelKey(config)
  const label = currentModelLabel(currentKey) || t('chat.noModelSelected')
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip title={t('chat.modelHint')} data-testid="model-chip">
          <Cpu size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[140px] truncate">{label}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {groups.map((g) => (
          <DropdownMenuGroup key={g.providerID}>
            <DropdownMenuLabel>{g.providerName}</DropdownMenuLabel>
            {g.models.map((m) => (
              <DropdownMenuItem key={m.key} onSelect={() => setModelKey(m.key)}>
                <Check size={14} className={cn('shrink-0', currentKey === m.key ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{m.modelID}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
