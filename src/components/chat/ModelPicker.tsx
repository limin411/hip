import { useTranslation } from 'react-i18next'
import { Cpu, Check } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuGroup } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
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
  const keyConfigured = useProvidersStore((s) => s.keyConfigured)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const groups = groupModelOptions(catalog, config, keyConfigured)

  // Active session: show the session's current model (pinned or global fallback) and allow switching.
  // Draft (no session): show the draft's modelKey (or global fallback).
  const currentKey = activeId && session
    ? (session.config.model ? `${session.config.llmProvider}/${session.config.model}` : activeModelKey(config))
    : (draft?.modelKey ?? activeModelKey(config))
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
              <DropdownMenuItem
                key={m.key}
                onSelect={() => {
                  if (activeId && session) {
                    sessionService.setSessionModel(m.key)
                  } else {
                    setModelKey(m.key)
                  }
                }}
              >
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
