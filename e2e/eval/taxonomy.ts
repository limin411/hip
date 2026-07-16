import type { FailureTagV1, ScoreInput, ScoreResult, SoftCheck } from './types.js'

function softPathsOk(
  paths: string[],
  soft: SoftCheck[] | undefined,
  expect: ScoreInput['expect'],
): { wrongFile: boolean; notes: string[] } {
  const notes: string[] = []
  let wrongFile = false

  const touchRes: string[] = []
  const avoidRes: string[] = []

  for (const s of soft ?? []) {
    if (s.kind === 'paths_touched_regex') touchRes.push(s.pattern)
    if (s.kind === 'paths_avoid_regex') avoidRes.push(s.pattern)
  }
  for (const p of expect?.changes_paths_regex ?? []) touchRes.push(p)
  for (const p of expect?.changes_avoid_regex ?? []) avoidRes.push(p)

  for (const pat of touchRes) {
    const re = new RegExp(pat)
    if (!paths.some((p) => re.test(p))) {
      wrongFile = true
      notes.push(`expected path matching /${pat}/ not found in inventory`)
    }
  }
  for (const pat of avoidRes) {
    const re = new RegExp(pat)
    if (paths.some((p) => re.test(p))) {
      wrongFile = true
      notes.push(`forbidden path matching /${pat}/ present in inventory`)
    }
  }
  return { wrongFile, notes }
}

function softTextOk(text: string, soft: SoftCheck[] | undefined, expect: ScoreInput['expect']): boolean {
  const patterns: string[] = []
  for (const s of soft ?? []) {
    if (s.kind === 'assistant_text_regex') patterns.push(s.pattern)
  }
  const fromExpect = expect?.assistant_text_regex
  if (fromExpect) patterns.push(fromExpect)
  if (patterns.length === 0) return true
  return patterns.every((pat) => new RegExp(pat, 'i').test(text))
}

function changeNonemptyRequired(soft: SoftCheck[] | undefined): boolean {
  return (soft ?? []).some((s) => s.kind === 'change_nonempty')
}

/**
 * Pure scorer: maps UI + disk signals to v1 failure tags.
 */
export function scoreRun(input: ScoreInput): ScoreResult {
  const tags: FailureTagV1[] = []
  const notes: string[] = [...(input.ui.errorHints ?? [])]

  if (!input.prepareOk) {
    return {
      passed: false,
      tags: ['infra_prepare'],
      notes: [input.prepareError ?? 'prepare failed'],
      verifyPassed: false,
    }
  }

  if (input.primaryMutated) {
    tags.push('primary_tree_mutated')
    notes.push('primary repo porcelain/HEAD changed during run')
  }

  if (input.ui.timedOut) {
    tags.push('timeout')
  }
  if (input.ui.permissionModalStuck) {
    tags.push('permission_stuck')
  }
  if (input.ui.awaitingUser) {
    tags.push('awaiting_user')
  }

  const verifyResults = input.verify.results
  const verifyRan = input.verify.ran
  const verifyPassed = verifyRan && verifyResults.length > 0 && verifyResults.every((r) => r.exitCode === 0)
  const verifyFailed = verifyRan && verifyResults.some((r) => r.exitCode !== 0)

  if (verifyFailed) {
    tags.push('verify_failed')
  }

  const { dirtyAfter, paths } = input.inventory
  // agentTouched covers "restored clean HEAD" fix tasks where dirtyAfter is false
  const agentTouched =
    input.inventory.agentTouched === true ||
    dirtyAfter ||
    paths.length > 0 ||
    input.inventory.fullPatch.trim().length > 0
  // Soft change_nonempty: agent did something, not "disk still dirty"
  const changeNonempty = agentTouched

  if (verifyFailed && !agentTouched) {
    tags.push('empty_change')
  }

  // Product bug: worktree still dirty after settle but Changes panel empty
  if (dirtyAfter && input.ui.settled && input.ui.changesPaths.length === 0 && !input.ui.timedOut) {
    tags.push('ui_changes_missing')
    notes.push('worktree still dirty but Changes panel listed no files')
  }

  if (input.ui.errorHints?.includes('never_saw_running')) {
    notes.push('UI never entered running state (composer-stop / thinking)')
    if (!tags.includes('timeout')) tags.push('timeout')
  }

  const pathCheck = softPathsOk(paths, input.soft, input.expect)
  notes.push(...pathCheck.notes)
  if (pathCheck.wrongFile) {
    tags.push('wrong_file')
  }

  if (agentTouched && !pathCheck.wrongFile && verifyFailed) {
    tags.push('incomplete_fix')
  }

  if (!softTextOk(input.ui.assistantText, input.soft, input.expect)) {
    notes.push('assistant_text_regex did not match')
    if (!tags.includes('incomplete_fix') && !tags.includes('verify_failed')) {
      tags.push('unknown')
    }
  }

  if (changeNonemptyRequired(input.soft) && !agentTouched) {
    tags.push('empty_change')
    notes.push('soft change_nonempty required but agent did not touch the tree')
  }

  // UI expect: no permission stuck
  if (input.expect?.no_permission_modal_stuck !== false && input.ui.permissionModalStuck) {
    // already tagged
  }

  // Pass criteria
  const noSafetyFail = !tags.includes('primary_tree_mutated')
  const noStuck = !input.ui.permissionModalStuck
  const noTimeout = !input.ui.timedOut
  const textOk = softTextOk(input.ui.assistantText, input.soft, input.expect)
  const softPathOk = !pathCheck.wrongFile
  const verifyOk = !verifyRan || verifyPassed
  const settledOk = input.ui.settled || (!input.ui.timedOut && verifyOk)

  const blocking = new Set([
    'empty_change',
    'ui_bind_fail',
    'ui_launch_fail',
    'ui_changes_missing',
    'permission_stuck',
    'timeout',
    'primary_tree_mutated',
    'verify_failed',
    'wrong_file',
    'incomplete_fix',
    'infra_prepare',
  ])
  const hasBlocking = tags.some((t) => blocking.has(t))

  const passed =
    noSafetyFail &&
    noStuck &&
    noTimeout &&
    textOk &&
    softPathOk &&
    verifyOk &&
    settledOk &&
    !hasBlocking
  if (passed) {
    return { passed: true, tags: ['pass'], notes, verifyPassed }
  }

  // Deduplicate tags, drop pass
  const uniq = [...new Set(tags.filter((t) => t !== 'pass'))]
  if (uniq.length === 0) uniq.push('unknown')
  return { passed: false, tags: uniq, notes, verifyPassed }
}
