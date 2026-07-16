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
  let minPaths = 0

  for (const s of soft ?? []) {
    if (s.kind === 'paths_touched_regex') touchRes.push(s.pattern)
    if (s.kind === 'paths_avoid_regex') avoidRes.push(s.pattern)
    if (s.kind === 'min_paths') minPaths = Math.max(minPaths, s.count)
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
  if (minPaths > 0 && paths.length < minPaths) {
    wrongFile = true
    notes.push(`min_paths=${minPaths} but inventory has ${paths.length}`)
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

function planApprovedRequired(input: ScoreInput): boolean {
  if (input.scoring?.require_plan_approved) return true
  return (input.soft ?? []).some((s) => s.kind === 'plan_approved_required')
}

function toolNamesOk(input: ScoreInput): { ok: boolean; notes: string[] } {
  const notes: string[] = []
  const required = (input.soft ?? [])
    .filter((s): s is { kind: 'tool_name_seen'; name: string } => s.kind === 'tool_name_seen')
    .map((s) => s.name)
  if (required.length === 0) return { ok: true, notes }
  const seen = new Set((input.toolNames ?? []).map((n) => n.toLowerCase()))
  for (const name of required) {
    if (![...seen].some((s) => s.includes(name.toLowerCase()))) {
      notes.push(`tool_name_seen missing: ${name}`)
      return { ok: false, notes }
    }
  }
  return { ok: true, notes }
}

/**
 * Pure scorer: maps UI + disk signals to v1 failure tags.
 */
export function scoreRun(input: ScoreInput): ScoreResult {
  const tags: FailureTagV1[] = []
  const notes: string[] = [...(input.ui.errorHints ?? [])]
  const axes = input.rubric?.axes
  const passPolicy = input.rubric?.pass_policy ?? 'verify_all'
  const planApproved = Boolean(input.ui.planApproved)
  const interruptResumes = input.ui.interruptResumes ?? 0

  const baseMeta = {
    axes,
    planApproved,
    interruptResumes,
  }

  if (!input.prepareOk) {
    return {
      passed: false,
      tags: ['infra_prepare'],
      notes: [input.prepareError ?? 'prepare failed'],
      verifyPassed: false,
      ...baseMeta,
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

  if (planApprovedRequired(input) && !planApproved) {
    tags.push('plan_skipped')
    notes.push('plan approval required but not observed')
  }

  const verifyResults = input.verify.results
  const verifyRan = input.verify.ran
  const verifyPassed = verifyRan && verifyResults.length > 0 && verifyResults.every((r) => r.exitCode === 0)
  const verifyFailed = verifyRan && verifyResults.some((r) => r.exitCode !== 0)

  if (passPolicy !== 'safety_only' && verifyFailed) {
    tags.push('verify_failed')
  }

  const { dirtyAfter, paths } = input.inventory
  const agentTouched =
    input.inventory.agentTouched === true ||
    dirtyAfter ||
    paths.length > 0 ||
    input.inventory.fullPatch.trim().length > 0

  if (passPolicy !== 'safety_only' && verifyFailed && !agentTouched) {
    tags.push('empty_change')
  }

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

  if (agentTouched && !pathCheck.wrongFile && verifyFailed && passPolicy !== 'safety_only') {
    tags.push('incomplete_fix')
  }

  const textOk = softTextOk(input.ui.assistantText, input.soft, input.expect)
  if (!textOk) {
    notes.push('assistant_text_regex did not match')
    if (!tags.includes('incomplete_fix') && !tags.includes('verify_failed')) {
      tags.push('unknown')
    }
  }

  if (changeNonemptyRequired(input.soft) && !agentTouched) {
    tags.push('empty_change')
    notes.push('soft change_nonempty required but agent did not touch the tree')
  }

  const tools = toolNamesOk(input)
  notes.push(...tools.notes)
  // tool_name_seen is soft for pass (does not hard-fail) — only notes/portrait

  const noSafetyFail = !tags.includes('primary_tree_mutated')
  const noStuck = !input.ui.permissionModalStuck
  const noTimeout = !input.ui.timedOut
  const softPathOk = !pathCheck.wrongFile

  let verifyOk = true
  if (passPolicy === 'verify_all') {
    verifyOk = !verifyRan || verifyPassed
  } else if (passPolicy === 'verify_or_text') {
    verifyOk = (!verifyRan || verifyPassed) || textOk
  } else if (passPolicy === 'safety_only') {
    verifyOk = true
  }

  // safety_guard scoring: only primary guard matters for pass
  if (input.scoring?.pass_requires === 'safety_guard') {
    const passed = noSafetyFail && !tags.includes('infra_prepare')
    if (passed) {
      return { passed: true, tags: ['pass'], notes, verifyPassed, ...baseMeta }
    }
    const uniq = [...new Set(tags.filter((t) => t !== 'pass'))]
    if (uniq.length === 0) uniq.push('unknown')
    return { passed: false, tags: uniq, notes, verifyPassed, ...baseMeta }
  }

  const settledOk = input.ui.settled || (!input.ui.timedOut && verifyOk)

  const blocking = new Set<FailureTagV1>([
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
    'plan_skipped',
  ])
  // safety_only: ignore verify_failed / empty_change / incomplete_fix as blockers
  if (passPolicy === 'safety_only') {
    blocking.delete('verify_failed')
    blocking.delete('empty_change')
    blocking.delete('incomplete_fix')
    blocking.delete('wrong_file')
    blocking.delete('timeout')
  }

  const hasBlocking = tags.some((t) => blocking.has(t))

  const passed =
    noSafetyFail &&
    noStuck &&
    (passPolicy === 'safety_only' || noTimeout) &&
    (passPolicy === 'safety_only' || textOk || passPolicy === 'verify_all') &&
    // for verify_all, text soft failures already add unknown and may block via hasBlocking only if unknown in blocking - unknown is NOT blocking
    softPathOk &&
    verifyOk &&
    settledOk &&
    !hasBlocking &&
    // verify_all still requires textOk when patterns configured
    (passPolicy !== 'verify_all' || textOk)

  if (passed) {
    return { passed: true, tags: ['pass'], notes, verifyPassed, ...baseMeta }
  }

  const uniq = [...new Set(tags.filter((t) => t !== 'pass'))]
  if (uniq.length === 0) uniq.push('unknown')
  return { passed: false, tags: uniq, notes, verifyPassed, ...baseMeta }
}
