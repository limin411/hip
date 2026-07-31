import { useMemo } from 'react'
import { SessionAgentPicker } from './SessionAgentPicker'
import { ModelPicker } from './ModelPicker'
import { EffortLevelPicker } from './EffortLevelPicker'
import { PermissionModePicker, resolvePermissionMode } from './PermissionModePicker'
import { ExecutionModePicker } from './ExecutionModePicker'
import { ProjectGuidanceChip } from './ProjectGuidanceChip'
import { AttachmentButton } from './AttachmentButton'
import { WorktreeControl } from './WorktreeControl/WorktreeControl'
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
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
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
    case 'worktree':
      return <WorktreeControl key="worktree" />
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
  const parallelRuns = useParallelStore((s) => s.runs)
  const worktreeById = useWorktreeStore((s) => s.byId)

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

  const pinWorktree = useMemo(() => {
    if (!sessionBound || !session?.config.cwd) return false
    const cwd = session.config.cwd
    for (const run of parallelRuns) {
      if (run.hostSessionId !== session.id) continue
      for (const slot of run.slots) {
        if (slot.worktreePath && (cwd === slot.worktreePath || cwd.startsWith(`${slot.worktreePath}/`))) {
          return true
        }
      }
    }
    for (const wt of Object.values(worktreeById)) {
      if (wt.isPrimary) continue
      if (wt.path && (cwd === wt.path || cwd.startsWith(`${wt.path}/`))) return true
    }
    return false
  }, [sessionBound, session?.id, session?.config.cwd, parallelRuns, worktreeById])

  const entries = useFsStore((s) =>
    activeId ? s.bySession[activeId]?.entriesByDir['/'] : undefined,
  )
  const guidanceAvailable = useMemo(() => {
    if (!sessionBound || surface !== 'code' || !session?.config.cwd) return false
    const names = (entries ?? []).map((e) => e.name)
    return !!pickProjectGuidanceName(names)
  }, [sessionBound, surface, session?.config.cwd, entries])

  const worktreeAvailable = sessionBound && surface === 'code'

  const flags: ComposerControlFlags = {
    surface,
    externalPrimary,
    permissionMode,
    forcePlan,
    effortIsDefault,
    hasEffortLevels: !!levels && levels.length > 0,
    pinWorktree,
    sessionBound,
    available: {
      guidance: guidanceAvailable,
      worktree: worktreeAvailable,
    },
  }

  const resolved = resolveComposerControls(flags)
  // Worktree + branch moved to the composer footer row below the input (Code surface,
  // Copilot/Cursor style) — keep them out of the toolbar regardless of placement rules.
  const toolbarIds = (ids: ControlId[]) => ids.filter((id) => id !== 'worktree' && id !== 'branch')

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
