import type { ArtifactTab, ChatTab } from '@/store/uiStore'

export type PanelTabValue = ArtifactTab | ChatTab

export type VisibleTabDef = {
  value: PanelTabValue
  labelKey:
    | 'artifact.files'
    | 'artifact.agents'
    | 'artifact.outline'
    | 'artifact.timeline'
    | 'artifact.changes'
    | 'artifact.terminal'
  gated?: boolean
}

/**
 * Shared tab set for ArtifactPanel in-panel chrome and PanelToggle.
 * @see docs/design/visual-craft-upgrade-spec.md Phase 5
 */
export function visibleArtifactTabs(args: {
  surface: 'code' | 'chat'
  isGitRepo: boolean
  codeTerminal: boolean
}): VisibleTabDef[] {
  if (args.surface === 'chat') {
    return [
      { value: 'outline', labelKey: 'artifact.outline' },
      { value: 'files', labelKey: 'artifact.files' },
      { value: 'agents', labelKey: 'artifact.agents' },
    ]
  }
  const tabs: VisibleTabDef[] = [
    { value: 'outline', labelKey: 'artifact.outline' },
    { value: 'files', labelKey: 'artifact.files' },
    { value: 'agents', labelKey: 'artifact.agents' },
  ]
  if (args.isGitRepo) {
    tabs.push(
      { value: 'timeline', labelKey: 'artifact.timeline' },
      { value: 'changes', labelKey: 'artifact.changes' },
    )
  } else {
    tabs.push(
      { value: 'timeline', labelKey: 'artifact.timeline', gated: true },
      { value: 'changes', labelKey: 'artifact.changes', gated: true },
    )
  }
  if (args.codeTerminal) {
    tabs.push({ value: 'terminal', labelKey: 'artifact.terminal' })
  }
  return tabs
}
