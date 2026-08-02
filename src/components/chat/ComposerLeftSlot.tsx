import { useMemo } from 'react'
import { SessionAgentPicker } from './SessionAgentPicker'
import { ModelPicker } from './ModelPicker'
import { EffortLevelPicker } from './EffortLevelPicker'
import { PermissionModePicker, resolvePermissionMode } from './PermissionModePicker'
import { ExecutionModePicker } from './ExecutionModePicker'
import { ProjectGuidanceChip } from './ProjectGuidanceChip'
import { AttachmentButton } from './AttachmentButton'
import { BranchSwitcher } from '@/components/artifact/BranchSwitcher'
import { ComposerControlRow } from './ComposerControlRow'
import { COMPOSER_OVERFLOW } from './craftFeature'
import {
  resolveComposerControls,
  type ControlId,
  type ComposerControlFlags,
} from './composerControlMatrix'
import { resolveExecutionMode } from '@hip/protocol'
import { isExternalPrimary } from '@/lib/sessionAgent'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { activeModelKey } from '@/lib/modelKey'
import { defaultEffort, effortLevelsForKey, resolveEffort } from '@/lib/modelEffort'
import { pickProjectGuidanceName } from '@/lib/projectGuidance'
import { useFsStore } from '@/store/fsStore'
import type { LocalAttachment } from './attachmentTypes'

export type ComposerLeftSlotProps = {
  surface: 'chat' | 'code'
  /** False on NewConversation empty draft. */
  sessionBound: boolean
  onAttach: (add: LocalAttachment[]) => void
}

function mountId(id: ControlId, onAttach: (add: LocalAttachment[]) => void): React.ReactNode {
  switch (id) {
    case 'agent':
      return <SessionAgentPicker key="agent" />
    case 'model':
      return <ModelPicker key="model" />
    case 'effort':
      return <EffortLevelPicker key="effort" />
    case 'permission':
      return <PermissionModePicker key="permission" />
    case 'plan':
      return <ExecutionModePicker key="plan" />
    case 'guidance':
      return <ProjectGuidanceChip key="guidance" />
    case 'branch':
      return <BranchSwitcher key="branch" />
    case 'attach':
      return <AttachmentButton key="attach" onAttach={onAttach} />
    default:
      return null
  }
}

function mountList(ids: ControlId[], onAttach: (add: LocalAttachment[]) => void): React.ReactNode {
  return <>{ids.map((id) => mountId(id, onAttach))}</>
}

/**
 * Composer leftSlot: flat legacy layout when COMPOSER_OVERFLOW is false;
 * progressive disclosure (primary / pin / More) when true.
 */
export function ComposerLeftSlot({
  surface,
  sessionBound,
  onAttach,
}: ComposerLeftSlotProps) {
  const draft = useDraftStore((s) => s.draft)
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const agentId = sessionBound && session ? session.config.agentId : draft?.agentId
  const externalPrimary = isExternalPrimary(agentId)

  const permissionMode = resolvePermissionMode(
    sessionBound && session ? session.config.permissionMode : draft?.permissionMode,
  )
  // Pin execution-mode control when not default interactive (plan or autopilot).
  const forcePlan =
    resolveExecutionMode(
      sessionBound && session
        ? session.config
        : {
            executionMode: draft?.executionMode,
            forcePlan: draft?.forcePlan,
            permissionMode: draft?.permissionMode,
          },
    ) !== 'interactive'

  const modelKey =
    sessionBound && session
      ? session.config.model
        ? `${session.config.llmProvider}/${session.config.model}`
        : activeModelKey(config)
      : (draft?.modelKey ?? activeModelKey(config))

  const levels = effortLevelsForKey(catalog, modelKey)
  const storedEffort = sessionBound && session ? session.config.effort : draft?.effort
  const resolvedEffort = resolveEffort(storedEffort, levels)
  const effortIsDefault =
    !levels || levels.length === 0 || resolvedEffort === defaultEffort(levels)

  const entries = useFsStore((s) =>
    activeId ? s.bySession[activeId]?.entriesByDir['/'] : undefined,
  )
  const guidanceAvailable = useMemo(() => {
    if (!sessionBound || surface !== 'code' || !session?.config.cwd) return false
    const names = (entries ?? []).map((e) => e.name)
    return !!pickProjectGuidanceName(names)
  }, [sessionBound, surface, session?.config.cwd, entries])

  const flags: ComposerControlFlags = {
    surface,
    externalPrimary,
    permissionMode,
    forcePlan,
    effortIsDefault,
    hasEffortLevels: !!levels && levels.length > 0,
    sessionBound,
    available: {
      guidance: guidanceAvailable,
    },
  }

  const resolved = resolveComposerControls(flags)
  // Branch moved to the composer footer row below the input (Code surface,
  // Copilot/Cursor style) — keep it out of the toolbar regardless of placement rules.
  const toolbarIds = (ids: ControlId[]) => ids.filter((id) => id !== 'branch')

  // Flag off: preserve legacy flat order (existing product behavior).
  if (!COMPOSER_OVERFLOW) {
    if (surface === 'code') {
      return (
        <>
          <SessionAgentPicker />
          {!externalPrimary && <ModelPicker />}
          {!externalPrimary && <EffortLevelPicker />}
          <PermissionModePicker />
          {!externalPrimary && <ExecutionModePicker />}
          {sessionBound && <ProjectGuidanceChip />}
          <AttachmentButton onAttach={onAttach} />
        </>
      )
    }
    return (
      <>
        <SessionAgentPicker />
        {!externalPrimary && <ModelPicker />}
        {!externalPrimary && <EffortLevelPicker />}
        <AttachmentButton onAttach={onAttach} />
      </>
    )
  }

  return (
    <ComposerControlRow
      primary={mountList(toolbarIds(resolved.primary), onAttach)}
      pinnedSecondary={
        resolved.pinned.length > 0
          ? mountList(toolbarIds(resolved.pinned), onAttach)
          : undefined
      }
      secondary={
        resolved.overflow.length > 0 ? mountList(toolbarIds(resolved.overflow), onAttach) : undefined
      }
    />
  )
}
