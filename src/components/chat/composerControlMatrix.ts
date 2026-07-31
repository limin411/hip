/**
 * Composer progressive-disclosure control matrix (craft upgrade Phase 1).
 *
 * Pure resolve: primary / pinned / overflow are pairwise disjoint; each ControlId
 * appears in at most one array. Call sites mount each id exactly once.
 *
 * @see docs/design/visual-craft-upgrade-spec.md § Phase 1
 */

export type ControlId =
  | 'agent'
  | 'model'
  | 'effort'
  | 'permission'
  | 'plan'
  | 'guidance'
  | 'worktree'
  | 'branch'
  | 'attach'

export interface ComposerControlFlags {
  surface: 'chat' | 'code'
  externalPrimary: boolean
  permissionMode: 'chat' | 'edit' | 'full'
  forcePlan: boolean
  effortIsDefault: boolean
  hasEffortLevels: boolean
  /** True when worktree control should pin (active non-primary worktree context). */
  pinWorktree: boolean
  /** False on NewConversation empty draft (no guidance / worktree). */
  sessionBound: boolean
  /**
   * Runtime availability after picker self-null rules.
   * Call site computes from the same predicates as components:
   * - effort: hasEffortLevels (also applied structurally below)
   * - guidance: sessionBound && code && cwd && guidance text present
   * - worktree: sessionBound && worktree UI applicable
   * Missing key ⇒ treat as true for always-mounted controls (agent/model/attach/permission/plan)
   * after structural filters.
   */
  available?: Partial<Record<ControlId, boolean>>
}

export interface ResolvedComposerControls {
  primary: ControlId[]
  pinned: ControlId[]
  /** Secondary IDs to mount inside overflow only — disjoint from primary ∪ pinned */
  overflow: ControlId[]
}

function isAvailable(id: ControlId, flags: ComposerControlFlags): boolean {
  if (flags.available?.[id] === false) return false

  // Structural availability from surface / session / model capability.
  switch (id) {
    case 'model':
      return !flags.externalPrimary
    case 'effort':
      return !flags.externalPrimary && flags.hasEffortLevels
    case 'permission':
      return flags.surface === 'code'
    case 'plan':
      return flags.surface === 'code' && !flags.externalPrimary
    case 'guidance':
      return flags.surface === 'code' && flags.sessionBound
    case 'worktree':
      return flags.surface === 'code' && flags.sessionBound
    case 'branch':
      return flags.surface === 'code' && flags.sessionBound
    case 'agent':
    case 'attach':
      return true
    default:
      return true
  }
}

function primaryIds(flags: ComposerControlFlags): ControlId[] {
  if (flags.surface === 'chat') {
    return ['agent', 'model', 'attach']
  }
  // code
  if (flags.externalPrimary) {
    return ['agent', 'branch', 'attach']
  }
  return ['agent', 'model', 'branch', 'attach']
}

function pinIds(flags: ComposerControlFlags): ControlId[] {
  const out: ControlId[] = []
  const isCode = flags.surface === 'code'

  // pinPermission = isCode && mode !== 'edit'
  if (isCode && flags.permissionMode !== 'edit') {
    out.push('permission')
  }
  // pinPlan = isCode && !externalPrimary && forcePlan
  if (isCode && !flags.externalPrimary && flags.forcePlan) {
    out.push('plan')
  }
  // pinEffort = !externalPrimary && hasEffortLevels && !effortIsDefault
  if (!flags.externalPrimary && flags.hasEffortLevels && !flags.effortIsDefault) {
    out.push('effort')
  }
  // pinWorktree = isCode && sessionBound && pinWorktree flag
  if (isCode && flags.sessionBound && flags.pinWorktree) {
    out.push('worktree')
  }
  return out
}

/** Overflow candidate pool (before pin/primary exclusion). */
function overflowPool(flags: ComposerControlFlags): ControlId[] {
  if (flags.surface === 'chat') {
    return ['effort']
  }
  // code
  if (flags.externalPrimary) {
    // NewConversation (sessionBound=false): no guidance/worktree in pool
    if (!flags.sessionBound) {
      return ['permission']
    }
    return ['permission', 'guidance', 'worktree']
  }
  if (!flags.sessionBound) {
    // NewConversation code: effort, permission, plan
    return ['effort', 'permission', 'plan']
  }
  return ['effort', 'permission', 'plan', 'guidance', 'worktree']
}

/**
 * Resolve composer control placement.
 *
 * Contract:
 * 1. primary ∩ pinned = ∅; primary ∩ overflow = ∅; pinned ∩ overflow = ∅
 * 2. Each ControlId appears in at most one of the three arrays
 * 3. Filter out ids where available / structural rules say unavailable
 * 4. UI: render Overflow trigger iff overflow.length > 0
 * 5. React: mount each ControlId exactly once (no pin+overflow duplicate pickers)
 */
export function resolveComposerControls(flags: ComposerControlFlags): ResolvedComposerControls {
  const primaryRaw = primaryIds(flags).filter((id) => isAvailable(id, flags))
  const primarySet = new Set(primaryRaw)

  const pinned = pinIds(flags).filter((id) => {
    if (!isAvailable(id, flags)) return false
    // Never pin something that belongs in primary (attach/agent/model).
    if (primarySet.has(id)) return false
    return true
  })
  const pinnedSet = new Set(pinned)

  const overflow = overflowPool(flags).filter((id) => {
    if (!isAvailable(id, flags)) return false
    if (primarySet.has(id)) return false
    if (pinnedSet.has(id)) return false
    return true
  })

  return {
    primary: primaryRaw,
    pinned,
    overflow,
  }
}

/** Assert pairwise disjoint placement (for tests / debug). */
export function assertDisjointControls(resolved: ResolvedComposerControls): boolean {
  const all = [...resolved.primary, ...resolved.pinned, ...resolved.overflow]
  return new Set(all).size === all.length
}
